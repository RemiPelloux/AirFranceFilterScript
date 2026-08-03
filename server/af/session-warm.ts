import { randomUUID } from 'node:crypto'
import type { Page } from 'patchright'
import { refreshCollectorPage } from './browser.js'
import { LOWEST_FARE_HASH } from './hashes.js'
import { buildGraphQlBody, evaluateFetch } from './transport.js'

/** Probe Akamai until GraphQL accepts a POST. Throws if the session stays blocked. */
export const warmAkamaiSession = async (page: Page): Promise<void> => {
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

  let lastError = 'Akamai session warm-up failed'
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await evaluateFetch(page, probe)
    if (result.ok && result.status != null && result.status < 400) {
      await page.waitForTimeout(800)
      return
    }
    lastError = result.error ?? `HTTP ${result.status ?? '?'}`
    await page.mouse.move(120 + attempt * 35, 180 + attempt * 25)
    await page.mouse.click(200, 280).catch(() => undefined)
    await refreshCollectorPage(page)
    await page.waitForTimeout(3_000 + attempt * 2_000)
  }
  throw new Error(`Session Akamai bloquée après warm-up: ${lastError}`)
}
