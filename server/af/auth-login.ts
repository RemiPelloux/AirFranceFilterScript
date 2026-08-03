import type { Page } from 'patchright'
import { withRecoveredCollector, withTransportLock } from './browser.js'
import {
  BROWSER_TIMEOUT_MS,
  CLIENT_REVISION,
  COLLECTOR_PAGE,
  SEARCH_CUSTOMER_HASH,
} from './hashes.js'
import { FlyingBlueAuthError } from './hashcash.js'
import { postGraphQl } from './transport.js'
import type { SearchCustomerPayload } from './types.js'

/** Air France account gateway — redirects to KLM IdP / OTP when needed. */
export const FLYING_BLUE_LOGIN_URL = 'https://wwws.airfrance.fr/identification'

export const openFlyingBlueLoginOnPage = async (page: Page): Promise<string> => {
  await page.bringToFront().catch(() => undefined)
  try {
    await page.goto(FLYING_BLUE_LOGIN_URL, {
      waitUntil: 'domcontentloaded',
      timeout: BROWSER_TIMEOUT_MS,
    })
  } catch (error) {
    const url = page.url()
    if (!/airfrance|airfranceklm|identity\./i.test(url)) throw error
  }
  await page.waitForTimeout(1_200)
  await page.bringToFront().catch(() => undefined)
  return page.url()
}

/** Open (or focus) Chrome on the Air France login page for Flying Blue. */
export const openFlyingBlueLogin = async (): Promise<{ url: string }> => withTransportLock(async () => (
  withRecoveredCollector(async (page) => ({ url: await openFlyingBlueLoginOnPage(page) }))
))

export const isFlyingBlueAuthenticated = async (): Promise<boolean> => withTransportLock(async () => (
  withRecoveredCollector(async (page) => {
    try {
      if (!page.url().includes('/search/')) {
        await page.goto(COLLECTOR_PAGE, {
          waitUntil: 'domcontentloaded',
          timeout: BROWSER_TIMEOUT_MS,
        }).catch(() => undefined)
        await page.waitForTimeout(1_000)
      }
      const payload = await postGraphQl<SearchCustomerPayload>(
        page,
        'SearchCustomerForSearchQuery',
        SEARCH_CUSTOMER_HASH,
        { expand: 'memberships_flyingblue' },
        { withHashcash: false, useRewardHeaders: true, revision: CLIENT_REVISION },
      )
      return Boolean(payload.data && !Object.values(payload.data).every((value) => value == null))
    } catch (error) {
      if (error instanceof FlyingBlueAuthError) return false
      const message = error instanceof Error ? error.message : String(error)
      if (/401|not authenticated|Flying Blue|CustomerAPI/i.test(message)) return false
      throw error
    }
  })
))
