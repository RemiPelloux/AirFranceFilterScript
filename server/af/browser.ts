import { access, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'patchright'
import { BROWSER_TIMEOUT_MS, COLLECTOR_PAGE } from './hashes.js'

const CDP_ENDPOINT = process.env.AF_CDP_ENDPOINT
const PROFILE_DIR = resolve(process.env.AF_BROWSER_PROFILE ?? '.airfrance-browser-profile')

let browserPromise: Promise<Browser> | undefined
let contextPromise: Promise<BrowserContext> | undefined
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

const cdpIsReady = async (): Promise<boolean> => {
  if (!CDP_ENDPOINT) return false
  try {
    const response = await fetch(`${CDP_ENDPOINT}/json/version`, { signal: AbortSignal.timeout(1_000) })
    return response.ok
  } catch {
    return false
  }
}

/** Visible Chrome + persistent profile (Akamai cookies + Flying Blue session). */
const startBrowserContext = async (): Promise<BrowserContext> => {
  await mkdir(PROFILE_DIR, { recursive: true })
  const configured = process.env.AF_BROWSER_EXECUTABLE
  const shared = {
    headless: false,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    viewport: { width: 1280, height: 800 },
    args: ['--no-first-run', '--no-default-browser-check'],
  }

  let context: BrowserContext
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      ...shared,
      ...(configured ? { executablePath: configured } : { channel: 'chrome' }),
    })
  } catch {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      ...shared,
      executablePath: await findBrowserExecutable(),
    })
  }
  context.on('close', () => { contextPromise = undefined })
  return context
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

const openCollectorPage = async (context: BrowserContext): Promise<Page> => {
  const page = await context.newPage()
  await page.setViewportSize({ width: 1280, height: 800 })
  try {
    await page.goto(COLLECTOR_PAGE, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT_MS })
  } catch (error) {
    if (!page.url().startsWith('https://wwws.airfrance.fr/')) throw error
  }
  await page.waitForTimeout(2_500)
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
  return /Target crashed|Target page, context or browser has been closed|Session closed|Browser has been closed/i.test(message)
}

const replaceCollectorPage = async (failedPage: Page): Promise<Page> => {
  await failedPage.close().catch(() => undefined)
  const context = await getBrowserContext()
  await Promise.all(context.pages()
    .filter((page) => page.url().startsWith('https://wwws.airfrance.fr/'))
    .map((page) => page.close().catch(() => undefined)))
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
  await page.waitForTimeout(3_000)
}

export const closeAirFranceTransport = async (): Promise<void> => {
  const context = await contextPromise?.catch(() => undefined)
  contextPromise = undefined
  if (context) await context.close().catch(() => undefined)
  const browser = await browserPromise?.catch(() => undefined)
  browserPromise = undefined
  if (browser) await browser.close().catch(() => undefined)
}
