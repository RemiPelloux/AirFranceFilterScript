import { randomUUID } from 'node:crypto'
import type { Page } from 'patchright'
import { refreshCollectorPage, withRecoveredCollector, withTransportLock } from './browser.js'
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

/** Open browser + warm Akamai at API boot so the first UI search is faster. */
export const prewarmCollector = async (): Promise<void> => withTransportLock(async () => {
  const ok = await withRecoveredCollector(async (page) => warmAkamaiSession(page))
  if (!ok) throw new Error('Warm-up Akamai non confirmé (la recherche retentera)')
})
