import { spawn } from 'node:child_process'
import { access, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'patchright'
import { BROWSER_TIMEOUT_MS, COLLECTOR_PAGE } from './hashes.js'
import { describeAirFranceTransportError, isAirFranceNetworkError } from './transport-errors.js'

const CDP_ENDPOINT = process.env.AF_CDP_ENDPOINT
const PROFILE_DIR = resolve(process.env.AF_BROWSER_PROFILE ?? '.airfrance-browser-profile')

let browserPromise: Promise<Browser> | undefined
let contextPromise: Promise<BrowserContext> | undefined
let ownedBrowser: Browser | undefined
let transportTail = Promise.resolve()

const browserCandidates = (): string[] => {
  const configured = process.env.AF_BROWSER_EXECUTABLE ? [process.env.AF_BROWSER_EXECUTABLE] : []
  if (process.platform === 'darwin') {
    return [
      ...configured,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ]
  }
  if (process.platform === 'win32') {
    return [
      ...configured,
      `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    ]
  }
  return [...configured, '/usr/bin/google-chrome', '/usr/bin/brave-browser', '/usr/bin/chromium']
}

const findBrowserExecutable = async (): Promise<string> => {
  for (const candidate of browserCandidates()) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Try next candidate.
    }
  }
  throw new Error('Google Chrome ou Brave est requis pour interroger Air France')
}

const clearProfileLocks = async (): Promise<void> => {
  await Promise.all([
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
  ].map((name) => rm(resolve(PROFILE_DIR, name), { force: true }).catch(() => undefined)))
}

/** Kill orphan Chrome processes that still hold our dedicated profile. */
const releaseProfileBrowsers = async (): Promise<void> => {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    await new Promise<void>((resolveDone) => {
      const killer = spawn('pkill', ['-f', PROFILE_DIR], { stdio: 'ignore' })
      killer.once('error', () => resolveDone())
      killer.once('exit', () => resolveDone())
    })
    await new Promise((resolveWait) => setTimeout(resolveWait, 400))
  }
  await clearProfileLocks()
}

const cdpIsReady = async (): Promise<boolean> => {
  if (!CDP_ENDPOINT) return false
  try {
    const response = await fetch(`${CDP_ENDPOINT}/json/version`, { signal: AbortSignal.timeout(1_000) })
    return response.ok
  } catch {
    return false
  }
}

const launchOptions = () => ({
  headless: false,
  locale: 'fr-FR',
  timezoneId: 'Europe/Paris',
  viewport: { width: 1280, height: 800 },
  // Keep HTTP/2: when Akamai blocks this IP, HTTP/1.1 black-holes until timeout
  // while HTTP/2 fails fast with ERR_HTTP2_PROTOCOL_ERROR.
  args: ['--no-first-run', '--no-default-browser-check'],
})

/** FilterScript-style ephemeral Chrome — most reliable against Akamai. */
const startEphemeralContext = async (): Promise<BrowserContext> => {
  const configured = process.env.AF_BROWSER_EXECUTABLE
  let browser: Browser
  try {
    browser = await chromium.launch({
      headless: false,
      ...(configured ? { executablePath: configured } : { channel: 'chrome' }),
      args: launchOptions().args,
    })
  } catch {
    browser = await chromium.launch({
      headless: false,
      executablePath: await findBrowserExecutable(),
      args: launchOptions().args,
    })
  }
  ownedBrowser = browser
  browserPromise = Promise.resolve(browser)
  browser.on('disconnected', () => {
    browserPromise = undefined
    ownedBrowser = undefined
    contextPromise = undefined
  })
  const context = await browser.newContext({
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    viewport: { width: 1280, height: 800 },
  })
  context.on('close', () => { contextPromise = undefined })
  return context
}

/** Persistent profile when exclusive lock is available (Flying Blue cookies). */
const startPersistentContext = async (): Promise<BrowserContext> => {
  await mkdir(PROFILE_DIR, { recursive: true })
  await releaseProfileBrowsers()
  const configured = process.env.AF_BROWSER_EXECUTABLE
  const shared = launchOptions()
  try {
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      ...shared,
      ...(configured ? { executablePath: configured } : { channel: 'chrome' }),
    })
    context.on('close', () => { contextPromise = undefined })
    return context
  } catch {
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      ...shared,
      executablePath: await findBrowserExecutable(),
    })
    context.on('close', () => { contextPromise = undefined })
    return context
  }
}

const startBrowserContext = async (): Promise<BrowserContext> => {
  // Prefer persistent for FB cookies; fall back to FilterScript ephemeral if locked.
  try {
    return await startPersistentContext()
  } catch {
    return startEphemeralContext()
  }
}

const getCdpBrowser = (): Promise<Browser> => {
  browserPromise ??= (async () => {
    if (!CDP_ENDPOINT || !await cdpIsReady()) {
      throw new Error(`Le navigateur CDP configuré ne répond pas sur ${CDP_ENDPOINT}`)
    }
    const browser = await chromium.connectOverCDP(CDP_ENDPOINT)
    browser.on('disconnected', () => { browserPromise = undefined })
    return browser
  })().catch((error) => {
    browserPromise = undefined
    throw error
  })
  return browserPromise
}

export const getBrowserContext = async (): Promise<BrowserContext> => {
  if (CDP_ENDPOINT) {
    const browser = await getCdpBrowser()
    const context = browser.contexts()[0]
    if (!context) throw new Error('Le profil navigateur Air France est indisponible')
    return context
  }
  contextPromise ??= startBrowserContext().catch((error) => {
    contextPromise = undefined
    throw error
  })
  return contextPromise
}

export const withTransportLock = async <T>(work: () => Promise<T>): Promise<T> => {
  const previous = transportTail
  let release: () => void = () => {}
  const current = new Promise<void>((resolveRelease) => { release = resolveRelease })
  transportTail = previous.then(() => current)
  await previous
  try {
    return await work()
  } finally {
    release()
  }
}

const onAirFrance = (page: Page): boolean => (
  page.url().includes('airfrance.fr') || page.url().includes('airfranceklm')
)

/** Robust AF navigation — one retry, then fail with a clear network message. */
export const navigateAirFrance = async (
  page: Page,
  url: string,
  settleMs = 2_000,
): Promise<void> => {
  let lastError: unknown
  for (const waitUntil of ['domcontentloaded', 'commit'] as const) {
    try {
      await page.goto(url, { waitUntil, timeout: BROWSER_TIMEOUT_MS })
      await page.waitForTimeout(settleMs)
      if (onAirFrance(page)) return
    } catch (error) {
      lastError = error
      if (onAirFrance(page)) {
        await page.waitForTimeout(settleMs)
        return
      }
      // Hard edge block (HTTP/2 RST) won't recover by retrying on the same IP.
      if (isAirFranceNetworkError(error) && /ERR_HTTP2_PROTOCOL_ERROR/i.test(
        error instanceof Error ? error.message : String(error),
      )) {
        break
      }
      await page.waitForTimeout(800)
    }
  }
  if (onAirFrance(page)) return
  throw new Error(describeAirFranceTransportError(
    lastError instanceof Error ? lastError : new Error(`Navigation Air France impossible vers ${url}`),
  ))
}

const openCollectorPage = async (context: BrowserContext): Promise<Page> => {
  const page = await context.newPage()
  await page.setViewportSize({ width: 1280, height: 800 })
  await navigateAirFrance(page, COLLECTOR_PAGE, 3_000)
  await page.mouse.move(220, 320)
  return page
}

const pageIsResponsive = async (page: Page): Promise<boolean> => {
  if (page.isClosed()) return false
  try {
    await page.waitForFunction(() => document.readyState !== 'loading', undefined, { timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

const getCollectorPage = async (): Promise<Page> => {
  const context = await getBrowserContext()
  const airFrancePages = context.pages().filter((page) => page.url().startsWith('https://wwws.airfrance.fr/'))
  let page: Page | undefined
  for (const candidate of airFrancePages) {
    if (await pageIsResponsive(candidate)) {
      page = candidate
      break
    }
    await candidate.close().catch(() => undefined)
  }
  page ??= await openCollectorPage(context)
  await Promise.all(airFrancePages.filter((duplicate) => duplicate !== page)
    .map((duplicate) => duplicate.close().catch(() => undefined)))
  return page
}

const targetFailed = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return /Target crashed|Target page, context or browser has been closed|Session closed|Browser has been closed|Ouverture dans une session/i.test(message)
}

export const closeAirFranceTransport = async (): Promise<void> => {
  const context = await contextPromise?.catch(() => undefined)
  contextPromise = undefined
  if (context) await context.close().catch(() => undefined)
  const browser = ownedBrowser ?? await browserPromise?.catch(() => undefined)
  browserPromise = undefined
  ownedBrowser = undefined
  if (browser) await browser.close().catch(() => undefined)
}

const replaceCollectorPage = async (failedPage: Page): Promise<Page> => {
  await failedPage.close().catch(() => undefined)
  await closeAirFranceTransport()
  const context = await getBrowserContext()
  return openCollectorPage(context)
}

export const withRecoveredCollector = async <T>(work: (page: Page) => Promise<T>): Promise<T> => {
  let page = await getCollectorPage()
  try {
    return await work(page)
  } catch (error) {
    if (!targetFailed(error)) throw error
    page = await replaceCollectorPage(page)
    return work(page)
  }
}

export const refreshCollectorPage = async (page: Page): Promise<void> => {
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT_MS })
  } catch {
    // Keep going; Akamai cookies may still refresh partially.
  }
  await page.waitForTimeout(2_500)
}
