import { randomUUID } from 'node:crypto'
import type { Page } from 'patchright'
import type { FareCalendarItem, RawOffer, SearchRequest } from '../../src/types.js'
import { withRecoveredCollector, withTransportLock } from './browser.js'
import { createActiveHashes, withHashFallback } from './hash-fallback.js'
import { CACHE_TTL_MS } from './hashes.js'
import { parseAvailableOffers, parseMonthlyFares, selectExactCandidates } from './parsers.js'
import { warmAkamaiSession } from './session-warm.js'
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
const hashes = createActiveHashes()

const requestKey = (request: SearchRequest): string => [
  'LEISURE',
  request.origin.code, request.destination.code, request.departureDate, request.returnDate,
  request.flexibleDays, request.tripLengthDays, request.adults, [...request.cabins].sort().join(','),
].join('|')

const priceCandidate = async (
  page: Page,
  candidate: SearchRequest,
  searchStateUuid: string,
): Promise<{ offers: RawOffer[]; fare?: FareCalendarItem }> => {
  const bodies = [buildGraphQlBody(
    'SearchResultAvailableOffersQuery',
    hashes.availableOffers,
    availableOfferVariables(candidate, searchStateUuid, 'LEISURE'),
    false,
  )]
  const [result] = await postGraphQlBatch<AvailableOffersPayload>(page, bodies)
  if (!result.ok || !result.data) throw new Error(result.error ?? 'AvailableOffers failed')
  const parsed = parseAvailableOffers(result.data, new Date().toISOString(), candidate)
  const prices = parsed.flatMap((offer) => offer.prices).filter((price) => candidate.cabins.includes(price.cabin))
  const best = prices.sort((left, right) => (left.cash ?? Infinity) - (right.cash ?? Infinity))[0]
  const fare = best ? {
    departureDate: candidate.departureDate,
    returnDate: candidate.returnDate,
    label: datePairLabel(candidate.departureDate, candidate.returnDate),
    ...(best.cash != null ? { cash: best.cash } : {}),
    selected: false,
  } : undefined
  return { offers: parsed, fare }
}

const executeCashSearch = async (request: SearchRequest): Promise<SearchCapture> => (
  withTransportLock(() => withRecoveredCollector(async (page) => withHashFallback(hashes, async () => {
    await warmAkamaiSession(page)
    const operations = [
      'SharedSearchLowestFareOffersForSearchQuery:MONTH',
      ...(request.flexibleDays ? ['SharedSearchLowestFareOffersForSearchQuery:DAY'] : []),
      'SearchResultAvailableOffersQuery',
    ]
    const searchStateUuid = randomUUID()
    const [firstMonthDate, lastMonthDate] = monthlyInterval(request.departureDate)
    const monthlyPayload = await postGraphQlWithRetry<LowestFarePayload>(
      page,
      'SharedSearchLowestFareOffersForSearchQuery',
      hashes.lowestFare,
      lowestFareVariables(request, searchStateUuid, 'LEISURE', firstMonthDate, lastMonthDate, 'MONTH'),
    )
    const monthlyCalendar = parseMonthlyFares(
      monthlyPayload.data?.lowestFareOffers?.lowestOffers ?? [],
      'LEISURE',
    )

    let candidates = candidateRequests(request)
    if (request.flexibleDays) {
      const preliminary = await postGraphQlWithRetry<LowestFarePayload>(
        page,
        'SharedSearchLowestFareOffersForSearchQuery',
        hashes.lowestFare,
        lowestFareVariables(
          request,
          searchStateUuid,
          'LEISURE',
          candidates[0].departureDate,
          candidates.at(-1)!.departureDate,
        ),
      )
      candidates = selectExactCandidates(
        request,
        candidates,
        preliminary.data?.lowestFareOffers?.lowestOffers ?? [],
      )
    }

    const offerBodies = candidates.map((candidate) => buildGraphQlBody(
      'SearchResultAvailableOffersQuery',
      hashes.availableOffers,
      availableOfferVariables(candidate, searchStateUuid, 'LEISURE'),
      false,
    ))
    const batch = await postGraphQlBatch<AvailableOffersPayload>(page, offerBodies)
    const offers: RawOffer[] = []
    const fareCalendar: FareCalendarItem[] = []
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]
      const result = batch[index]
      if (!result?.ok || !result.data) continue
      try {
        const parsed = parseAvailableOffers(result.data, new Date().toISOString(), candidate)
        offers.push(...parsed)
        const prices = parsed.flatMap((offer) => offer.prices)
          .filter((price) => request.cabins.includes(price.cabin))
        const best = prices.sort((left, right) => (left.cash ?? Infinity) - (right.cash ?? Infinity))[0]
        if (best) {
          fareCalendar.push({
            departureDate: candidate.departureDate,
            returnDate: candidate.returnDate,
            label: datePairLabel(candidate.departureDate, candidate.returnDate),
            ...(best.cash != null ? { cash: best.cash } : {}),
            selected: candidate.departureDate === request.departureDate,
          })
        }
      } catch {
        if (candidates.length === 1) {
          const fallback = await priceCandidate(page, candidate, searchStateUuid)
          offers.push(...fallback.offers)
          if (fallback.fare) fareCalendar.push({ ...fallback.fare, selected: true })
        }
      }
    }

    return { offers, fareCalendar, monthlyCalendar, operations, candidatePairs: candidates.length }
  })))
)

export const searchCashOffers = async (
  request: SearchRequest,
): Promise<SearchCapture & { cacheHit: boolean }> => {
  const key = requestKey(request)
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return { ...cached.capture, cacheHit: true }
  if (cached) cache.delete(key)
  const active = inFlight.get(key)
  if (active) return { ...await active, cacheHit: true }
  const search = executeCashSearch(request)
  inFlight.set(key, search)
  try {
    const capture = await search
    cache.set(key, { capture, expiresAt: Date.now() + CACHE_TTL_MS })
    return { ...capture, cacheHit: false }
  } finally {
    inFlight.delete(key)
  }
}
