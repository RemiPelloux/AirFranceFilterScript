import { randomUUID } from 'node:crypto'
import type { Page } from 'patchright'
import { getBrowserContext, refreshCollectorPage, withTransportLock } from './browser.js'
import { LOWEST_FARE_HASH } from './hashes.js'
import { isSessionWarm, markSessionWarm } from './session-state.js'
import { buildGraphQlBody, evaluateFetch } from './transport.js'

export { isSessionWarm, markSessionWarm } from './session-state.js'

/**
 * Best-effort Akamai warm-up. Never throws — a failed warm must not block pricing;
 * postGraphQlWithRetry handles 403s with page refresh.
 */
export const warmAkamaiSession = async (page: Page): Promise<boolean> => {
  if (isSessionWarm()) return true

  const probe = buildGraphQlBody(
    'SharedSearchLowestFareOffersForSearchQuery',
    LOWEST_FARE_HASH,
    {
      lowestFareOffersRequest: {
        bookingFlow: 'LEISURE',
        withUpsellCabins: true,
        passengers: [{ id: 1, type: 'ADT' }],
        commercialCabins: ['ECONOMY'],
        type: 'MONTH',
        requestedConnections: [
          {
            departureDate: '2026-10-02',
            dateInterval: '2026-10-01/2027-09-30',
            origin: { type: 'AIRPORT', code: 'NCE' },
            destination: { type: 'AIRPORT', code: 'RUN' },
          },
          {
            dateInterval: null,
            origin: { type: 'AIRPORT', code: 'RUN' },
            destination: { type: 'AIRPORT', code: 'NCE' },
          },
        ],
      },
      activeConnection: 0,
      searchStateUuid: randomUUID(),
      bookingFlow: 'LEISURE',
    },
    false,
  )

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await evaluateFetch(page, probe)
    if (result.ok && result.status != null && result.status < 400) {
      markSessionWarm()
      return true
    }
    await page.mouse.move(120 + attempt * 35, 180 + attempt * 25)
    await refreshCollectorPage(page)
    await page.waitForTimeout(1_500 + attempt * 1_000)
  }
  return false
}

/** Open Chrome + warm Akamai at API boot so the first UI search is faster. */
export const prewarmCollector = async (): Promise<void> => withTransportLock(async () => {
  const context = await getBrowserContext()
  let page = context.pages().find((candidate) => candidate.url().startsWith('https://wwws.airfrance.fr/'))
  if (!page || page.isClosed()) {
    page = await context.newPage()
    await page.setViewportSize({ width: 1280, height: 800 })
    try {
      await page.goto('https://wwws.airfrance.fr/search/advanced', {
        waitUntil: 'domcontentloaded',
        timeout: 75_000,
      })
    } catch (error) {
      if (!page.url().startsWith('https://wwws.airfrance.fr/')) throw error
    }
    await page.waitForTimeout(3_000)
  }
  const ok = await warmAkamaiSession(page)
  if (!ok) throw new Error('Warm-up Akamai non confirmé (la recherche retentera)')
})
