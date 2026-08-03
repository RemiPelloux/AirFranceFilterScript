import type { Page } from 'patchright'
import { navigateAirFrance, withRecoveredCollector, withTransportLock } from './browser.js'
import {
  CLIENT_REVISION,
  COLLECTOR_PAGE,
  SEARCH_CUSTOMER_HASH,
} from './hashes.js'
import { FlyingBlueAuthError } from './hashcash.js'
import { postGraphQl } from './transport.js'
import type { SearchCustomerPayload } from './types.js'

/** Air France account gateway — redirects to KLM IdP / OTP when needed. */
export const FLYING_BLUE_LOGIN_URL = 'https://wwws.airfrance.fr/identification'

const probeCustomer = async (page: Page): Promise<boolean> => {
  const payload = await postGraphQl<SearchCustomerPayload>(
    page,
    'SearchCustomerForSearchQuery',
    SEARCH_CUSTOMER_HASH,
    { expand: 'memberships_flyingblue' },
    { withHashcash: false, useRewardHeaders: true, revision: CLIENT_REVISION },
  )
  return Boolean(payload.data && !Object.values(payload.data).every((value) => value == null))
}

const restoreCollectorPage = async (page: Page): Promise<void> => {
  if (page.url().includes('/search/')) return
  await navigateAirFrance(page, COLLECTOR_PAGE, 1_200)
}

export const openFlyingBlueLoginOnPage = async (page: Page): Promise<string> => {
  await page.bringToFront().catch(() => undefined)
  await navigateAirFrance(page, FLYING_BLUE_LOGIN_URL, 1_200)
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
      await restoreCollectorPage(page)
      return await probeCustomer(page)
    } catch (error) {
      if (error instanceof FlyingBlueAuthError) return false
      const message = error instanceof Error ? error.message : String(error)
      if (/401|not authenticated|Flying Blue|CustomerAPI/i.test(message)) return false
      throw error
    }
  })
))

/**
 * After the user signs in inside Chrome, verify SearchCustomer and keep the
 * session cookies already stored on the collector browser context/profile.
 */
export const confirmFlyingBlueSession = async (): Promise<{
  authenticated: boolean
  cookieCount: number
  url: string
}> => withTransportLock(async () => (
  withRecoveredCollector(async (page) => {
    await page.bringToFront().catch(() => undefined)
    await restoreCollectorPage(page)
    const cookies = await page.context().cookies('https://wwws.airfrance.fr')
    const cookieCount = cookies.filter((cookie) => /airfrance/i.test(cookie.domain)).length
    try {
      const authenticated = await probeCustomer(page)
      return { authenticated, cookieCount, url: page.url() }
    } catch (error) {
      if (error instanceof FlyingBlueAuthError) {
        return { authenticated: false, cookieCount, url: page.url() }
      }
      const message = error instanceof Error ? error.message : String(error)
      if (/401|not authenticated|Flying Blue|CustomerAPI/i.test(message)) {
        return { authenticated: false, cookieCount, url: page.url() }
      }
      throw error
    }
  })
))
