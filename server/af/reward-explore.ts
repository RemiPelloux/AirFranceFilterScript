import type { SearchRequest } from '../../src/types.js'
import { withRecoveredCollector, withTransportLock } from './browser.js'
import { loadExploreMonthsFromHorizon } from './explore-chunks.js'
import { CACHE_TTL_MS, LOWEST_FARE_HASH } from './hashes.js'
import { parseMonthlyFares } from './parsers.js'
import { prepareRewardSession, rewardTransportOptions } from './reward-session.js'
import { warmAkamaiSession } from './session-warm.js'
import { postGraphQlWithRetry } from './transport.js'
import type { ExploreCapture, LowestFarePayload } from './types.js'
import { lowestFareVariables, monthBounds, monthlyInterval } from './variables.js'

const exploreCache = new Map<string, { capture: ExploreCapture; expiresAt: number }>()
const exploreInFlight = new Map<string, Promise<ExploreCapture>>()

const exploreKey = (request: SearchRequest): string => [
  'explore', 'REWARD', request.origin.code, request.destination.code,
  request.adults, [...request.cabins].sort().join(','),
].join('|')

const executeRewardExplore = async (request: SearchRequest): Promise<ExploreCapture> => (
  withTransportLock(() => withRecoveredCollector(async (page) => {
    await warmAkamaiSession(page)
    const operations = [
      'SearchCustomerForSearchQuery',
      'SharedSearchContextPassengersForSearchQuery',
      'SharedSearchLowestFareOffersForSearchQuery:MONTH',
      'SharedSearchLowestFareOffersForSearchQuery:DAY',
    ]
    const searchStateUuid = await prepareRewardSession(page, request)
    const [firstMonthDate, lastMonthDate] = monthlyInterval(request.departureDate)
    const monthlyPayload = await postGraphQlWithRetry<LowestFarePayload>(
      page,
      'SharedSearchLowestFareOffersForSearchQuery',
      LOWEST_FARE_HASH,
      lowestFareVariables(request, searchStateUuid, 'REWARD', firstMonthDate, lastMonthDate, 'MONTH'),
      rewardTransportOptions,
    )
    const monthlySeeds = parseMonthlyFares(
      monthlyPayload.data?.lowestFareOffers?.lowestOffers ?? [],
      'REWARD',
    )
    const months = await loadExploreMonthsFromHorizon(
      page,
      monthlySeeds,
      'miles',
      request.departureDate,
      async () => {
        const dailyPayload = await postGraphQlWithRetry<LowestFarePayload>(
          page,
          'SharedSearchLowestFareOffersForSearchQuery',
          LOWEST_FARE_HASH,
          lowestFareVariables(
            request, searchStateUuid, 'REWARD', firstMonthDate, lastMonthDate, 'DAY',
          ),
          rewardTransportOptions,
        )
        return dailyPayload.data?.lowestFareOffers?.lowestOffers ?? []
      },
      async (seed) => {
        const [firstDate, lastDate] = monthBounds(seed.month)
        const dailyPayload = await postGraphQlWithRetry<LowestFarePayload>(
          page,
          'SharedSearchLowestFareOffersForSearchQuery',
          LOWEST_FARE_HASH,
          lowestFareVariables(request, searchStateUuid, 'REWARD', firstDate, lastDate, 'DAY'),
          rewardTransportOptions,
        )
        return dailyPayload.data?.lowestFareOffers?.lowestOffers ?? []
      },
    )

    return { months, operations }
  }))
)

export const exploreRewardFares = async (
  request: SearchRequest,
): Promise<ExploreCapture & { cacheHit: boolean }> => {
  const key = exploreKey(request)
  const cached = exploreCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return { ...cached.capture, cacheHit: true }
  if (cached) exploreCache.delete(key)
  const active = exploreInFlight.get(key)
  if (active) return { ...await active, cacheHit: true }
  const exploration = executeRewardExplore(request)
  exploreInFlight.set(key, exploration)
  try {
    const capture = await exploration
    exploreCache.set(key, { capture, expiresAt: Date.now() + CACHE_TTL_MS })
    return { ...capture, cacheHit: false }
  } finally {
    exploreInFlight.delete(key)
  }
}
