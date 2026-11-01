import { spawn } from 'node:child_process'
import { access, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Browser, type BrowserContext } from 'patchright'

export const PROFILE_DIR = resolve(process.env.AF_BROWSER_PROFILE ?? '.airfrance-browser-profile')

const browserCandidates = (): string[] => {
  const configured = process.env.AF_BROWSER_EXECUTABLE ? [process.env.AF_BROWSER_EXECUTABLE] : []
  if (process.platform === 'darwin') {
    return [
      ...configured,
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ]
  }
  if (process.platform === 'win32') {
    return [
      ...configured,
      `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
      `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
    ]
  }
  return [...configured, '/usr/bin/brave-browser', '/usr/bin/google-chrome', '/usr/bin/chromium']
}

export const findBrowserExecutable = async (): Promise<string> => {
  for (const candidate of browserCandidates()) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Try next candidate.
    }
  }
  throw new Error('Brave ou Google Chrome est requis pour interroger Air France')
}

const clearProfileLocks = async (): Promise<void> => {
  await Promise.all([
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
  ].map((name) => rm(resolve(PROFILE_DIR, name), { force: true }).catch(() => undefined)))
}

/** Kill orphan browsers that still hold our dedicated profile. */
export const releaseProfileBrowsers = async (): Promise<void> => {
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

/** Drop a corrupted profile (HTTP/2 poison). Flying Blue login must be redone. */
export const rotateBrokenProfile = async (): Promise<void> => {
  await releaseProfileBrowsers()
  await rm(PROFILE_DIR, { recursive: true, force: true })
  await mkdir(PROFILE_DIR, { recursive: true })
}

const launchArgs = ['--no-first-run', '--no-default-browser-check']

const sharedLaunch = async () => ({
  headless: false,
  locale: 'fr-FR',
  timezoneId: 'Europe/Paris',
  viewport: { width: 1280, height: 800 } as const,
  args: launchArgs,
  executablePath: await findBrowserExecutable(),
})

/** FilterScript-style ephemeral browser — most reliable against Akamai. */
export const startEphemeralContext = async (): Promise<{
  context: BrowserContext
  browser: Browser
}> => {
  const shared = await sharedLaunch()
  const browser = await chromium.launch({
    headless: shared.headless,
    executablePath: shared.executablePath,
    args: shared.args,
  })
  const context = await browser.newContext({
    locale: shared.locale,
    timezoneId: shared.timezoneId,
    viewport: shared.viewport,
  })
  return { context, browser }
}

/** Persistent profile when exclusive lock is available (Flying Blue cookies). */
export const startPersistentContext = async (): Promise<BrowserContext> => {
  await mkdir(PROFILE_DIR, { recursive: true })
  await releaseProfileBrowsers()
  const shared = await sharedLaunch()
  return chromium.launchPersistentContext(PROFILE_DIR, shared)
}
