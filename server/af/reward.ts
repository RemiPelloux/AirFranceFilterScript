import type { FareCalendarItem, RawOffer, SearchRequest } from '../../src/types.js'
import { withRecoveredCollector, withTransportLock } from './browser.js'
import { warmAkamaiSession } from './session-warm.js'
import {
  CACHE_TTL_MS,
  CLIENT_REVISION,
  RATLINE_AVAILABLE_OFFERS_HASH,
  RATLINE_LOWEST_FARE_HASH,
} from './hashes.js'
import { FlyingBlueAuthError } from './hashcash.js'
import { parseAvailableOffers, parseMonthlyFares, selectExactCandidates } from './parsers.js'
import { prepareRewardSession, rewardTransportOptions } from './reward-session.js'
import { buildGraphQlBody, postGraphQlBatch, postGraphQlWithRetry } from './transport.js'
import type { AvailableOffersPayload, LowestFarePayload, SearchCapture } from './types.js'
import {
  availableOfferVariables,
  candidateRequests,
  datePairLabel,
  lowestFareVariables,
  monthlyInterval,
} from './variables.js'

const cache = new Map<string, { capture: SearchCapture; expiresAt: number }>()
const inFlight = new Map<string, Promise<SearchCapture>>()

const requestKey = (request: SearchRequest): string => [
  'REWARD',
  request.origin.code, request.destination.code, request.departureDate, request.returnDate,
  request.flexibleDays, request.tripLengthDays, request.adults, [...request.cabins].sort().join(','),
].join('|')

const executeRewardSearch = async (request: SearchRequest): Promise<SearchCapture> => (
  withTransportLock(() => withRecoveredCollector(async (page) => {
    await warmAkamaiSession(page)
    const operations = [
      'SearchCustomerForSearchQuery',
      'SharedSearchCreateSearchContextForSearchQuery',
      'SharedSearchContextPassengersForSearchQuery',
      'SharedSearchLowestFareOffersForSearchQuery:MONTH',
      ...(request.flexibleDays ? ['SharedSearchLowestFareOffersForSearchQuery:DAY'] : []),
      'SearchResultAvailableOffersQuery',
    ]
    const { searchStateUuid, companions } = await prepareRewardSession(page, request)
    const [firstMonthDate, lastMonthDate] = monthlyInterval(request.departureDate)
    const monthlyPayload = await postGraphQlWithRetry<LowestFarePayload>(
      page,
      'SharedSearchLowestFareOffersForSearchQuery',
      RATLINE_LOWEST_FARE_HASH,
      lowestFareVariables(
        request, searchStateUuid, 'REWARD', firstMonthDate, lastMonthDate, 'MONTH', companions,
      ),
      rewardTransportOptions,
    )
    const monthlyCalendar = parseMonthlyFares(
      monthlyPayload.data?.lowestFareOffers?.lowestOffers ?? [],
      'REWARD',
    )

    let candidates = candidateRequests(request)
    if (request.flexibleDays) {
      const preliminary = await postGraphQlWithRetry<LowestFarePayload>(
        page,
        'SharedSearchLowestFareOffersForSearchQuery',
        RATLINE_LOWEST_FARE_HASH,
        lowestFareVariables(
          request,
          searchStateUuid,
          'REWARD',
          candidates[0].departureDate,
          candidates.at(-1)!.departureDate,
          'DAY',
          companions,
        ),
        rewardTransportOptions,
      )
      candidates = selectExactCandidates(
        request,
        candidates,
        preliminary.data?.lowestFareOffers?.lowestOffers ?? [],
      )
    }

    const offerBodies = candidates.map((candidate) => buildGraphQlBody(
      'SearchResultAvailableOffersQuery',
      RATLINE_AVAILABLE_OFFERS_HASH,
      availableOfferVariables(candidate, searchStateUuid, 'REWARD', companions),
      true,
    ))
    const batch = await postGraphQlBatch<AvailableOffersPayload>(page, offerBodies, {
      useRewardHeaders: true,
      revision: CLIENT_REVISION,
    })

    const offers: RawOffer[] = []
    const fareCalendar: FareCalendarItem[] = []
    const warnings: string[] = []
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]
      const result = batch[index]
      if (!result?.ok || !result.data) {
        if (candidates.length === 1) throw new FlyingBlueAuthError(result?.error)
        if (result?.error) warnings.push(result.error.slice(0, 160))
        continue
      }
      try {
        const parsed = parseAvailableOffers(result.data, new Date().toISOString(), candidate)
        offers.push(...parsed)
        const prices = parsed.flatMap((offer) => offer.prices)
          .filter((price) => request.cabins.includes(price.cabin) && price.miles != null)
        const best = prices.sort((left, right) => (left.miles ?? Infinity) - (right.miles ?? Infinity))[0]
        if (best) {
          fareCalendar.push({
            departureDate: candidate.departureDate,
            returnDate: candidate.returnDate,
            label: datePairLabel(candidate.departureDate, candidate.returnDate),
            miles: best.miles,
            taxes: best.taxes,
            selected: candidate.departureDate === request.departureDate,
          })
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message.slice(0, 160) : 'erreur Miles'
        warnings.push(`${candidate.departureDate}: ${detail}`)
        if (candidates.length === 1) {
          throw new FlyingBlueAuthError(error instanceof Error ? error.message : undefined)
        }
      }
    }
    if (!offers.length && warnings.length) {
      warnings.unshift('Air France n’a renvoyé aucune offre Miles exploitable.')
    }

    return {
      offers,
      fareCalendar,
      monthlyCalendar,
      operations,
      candidatePairs: candidates.length,
      warnings: [...new Set(warnings)].slice(0, 4),
    }
  }))
)

export const searchRewardOffers = async (
  request: SearchRequest,
): Promise<SearchCapture & { cacheHit: boolean }> => {
  const key = requestKey(request)
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return { ...cached.capture, cacheHit: true }
  if (cached) cache.delete(key)
  const active = inFlight.get(key)
  if (active) return { ...await active, cacheHit: true }
  const search = executeRewardSearch(request)
  inFlight.set(key, search)
  try {
    const capture = await search
    cache.set(key, { capture, expiresAt: Date.now() + CACHE_TTL_MS })
    return { ...capture, cacheHit: false }
  } finally {
    inFlight.delete(key)
  }
}
