import { chromium, type Browser, type BrowserContext, type Page } from 'patchright'
import {
  releaseProfileBrowsers,
  rotateBrokenProfile,
  startEphemeralContext,
  startPersistentContext,
} from './browser-launch.js'
import { BROWSER_TIMEOUT_MS, COLLECTOR_PAGE } from './hashes.js'
import { describeAirFranceTransportError, isAirFranceNetworkError } from './transport-errors.js'

const CDP_ENDPOINT = process.env.AF_CDP_ENDPOINT

let browserPromise: Promise<Browser> | undefined
let contextPromise: Promise<BrowserContext> | undefined
let ownedBrowser: Browser | undefined
let transportTail = Promise.resolve()
let profileRotatedForHttp2 = false

const cdpIsReady = async (): Promise<boolean> => {
  if (!CDP_ENDPOINT) return false
  try {
    const response = await fetch(`${CDP_ENDPOINT}/json/version`, { signal: AbortSignal.timeout(1_000) })
    return response.ok
  } catch {
    return false
  }
}

const startBrowserContext = async (): Promise<BrowserContext> => {
  try {
    const context = await startPersistentContext()
    context.on('close', () => { contextPromise = undefined })
    return context
  } catch {
    const { context, browser } = await startEphemeralContext()
    ownedBrowser = browser
    browserPromise = Promise.resolve(browser)
    browser.on('disconnected', () => {
      browserPromise = undefined
      ownedBrowser = undefined
      contextPromise = undefined
    })
    context.on('close', () => { contextPromise = undefined })
    return context
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

const isHttp2ProtocolError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return /ERR_HTTP2_PROTOCOL_ERROR/i.test(message)
}

/** Robust AF navigation — fail fast on HTTP/2 edge/profile poison. */
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
      if (isAirFranceNetworkError(error) && isHttp2ProtocolError(error)) break
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

export const closeAirFranceTransport = async (): Promise<void> => {
  const context = await contextPromise?.catch(() => undefined)
  contextPromise = undefined
  if (context) await context.close().catch(() => undefined)
  const browser = ownedBrowser ?? await browserPromise?.catch(() => undefined)
  browserPromise = undefined
  ownedBrowser = undefined
  if (browser) await browser.close().catch(() => undefined)
}

const recoverPoisonedProfile = async (): Promise<void> => {
  if (CDP_ENDPOINT || profileRotatedForHttp2) return
  profileRotatedForHttp2 = true
  await closeAirFranceTransport()
  await rotateBrokenProfile()
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
  try {
    page ??= await openCollectorPage(context)
  } catch (error) {
    if (!isHttp2ProtocolError(error) || CDP_ENDPOINT) throw error
    await recoverPoisonedProfile()
    page = await openCollectorPage(await getBrowserContext())
  }
  await Promise.all(airFrancePages.filter((duplicate) => duplicate !== page)
    .map((duplicate) => duplicate.close().catch(() => undefined)))
  return page
}

const targetFailed = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return /Target crashed|Target page, context or browser has been closed|Session closed|Browser has been closed|Ouverture dans une session/i.test(message)
}

const replaceCollectorPage = async (failedPage: Page): Promise<Page> => {
  await failedPage.close().catch(() => undefined)
  await closeAirFranceTransport()
  return openCollectorPage(await getBrowserContext())
}

export const withRecoveredCollector = async <T>(work: (page: Page) => Promise<T>): Promise<T> => {
  let page = await getCollectorPage()
  try {
    return await work(page)
  } catch (error) {
    if (isHttp2ProtocolError(error) && !CDP_ENDPOINT) {
      await recoverPoisonedProfile()
      page = await openCollectorPage(await getBrowserContext())
      return work(page)
    }
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

// Re-export for session cleanup scripts.
export { releaseProfileBrowsers, rotateBrokenProfile }
