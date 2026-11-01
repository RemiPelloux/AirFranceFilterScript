import type { Cabin, CabinPrice, RankedOffer, RawOffer, SearchRequest } from '../types'

interface ScoringWeights {
  minuteValue: number
  stopPenalty: number
  separateTicketPenalty: number
  longLayoverPenalty: number
  airportChangePenalty: number
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  minuteValue: 0.15,
  stopPenalty: 34,
  separateTicketPenalty: 210,
  longLayoverPenalty: 70,
  airportChangePenalty: 95,
}

const totalDuration = (offer: RawOffer): number => {
  if (offer.totalDurationMinutes != null) return offer.totalDurationMinutes
  if (offer.segments.length === 0) return 0
  const segmentTime = offer.segments.reduce((sum, segment) => sum + (segment.durationMinutes ?? 0), 0)
  return segmentTime + Math.max(0, offer.segments.length - 1) * 105
}

const getComparableCash = (price: CabinPrice, mode: SearchRequest['paymentMode'], mileValueCents: number): number => {
  const cash = price.cash ?? Infinity
  const award = price.miles == null ? Infinity : price.miles * (mileValueCents / 100) + (price.taxes ?? 0)
  if (mode === 'cash') return cash
  if (mode === 'miles') return award
  return Math.min(cash, award)
}

const pickPrice = (offer: RawOffer, cabins: Cabin[], mode: SearchRequest['paymentMode'], mileValueCents: number): CabinPrice | undefined => {
  const available = offer.prices.filter((price) => cabins.includes(price.cabin))
  return available
    .filter((price) => Number.isFinite(getComparableCash(price, mode, mileValueCents)))
    .sort((a, b) => getComparableCash(a, mode, mileValueCents) - getComparableCash(b, mode, mileValueCents))[0]
}

const riskFor = (offer: RawOffer, stops: number): RankedOffer['risk'] => {
  if (!offer.singleTicket || stops > 1) return 'high'
  if (stops === 1) return 'medium'
  return 'low'
}

const markParetoFront = (offers: RankedOffer[]): void => {
  const ordered = [...offers].sort((a, b) => a.generalizedCost - b.generalizedCost)
  const bestDurationByStops = [Infinity, Infinity, Infinity]

  for (let start = 0; start < ordered.length;) {
    let end = start + 1
    while (end < ordered.length && ordered[end].generalizedCost === ordered[start].generalizedCost) end += 1
    const group = ordered.slice(start, end)
    const groupBestByStops = [Infinity, Infinity, Infinity]
    for (const offer of group) groupBestByStops[offer.stops] = Math.min(groupBestByStops[offer.stops], offer.totalDurationMinutes)

    for (const offer of group) {
      const lowerCostDominates = bestDurationByStops
        .slice(0, offer.stops + 1)
        .some((duration) => duration <= offer.totalDurationMinutes)
      const equalCostLowerStops = groupBestByStops
        .slice(0, offer.stops)
        .some((duration) => duration <= offer.totalDurationMinutes)
      const equalCostFaster = groupBestByStops[offer.stops] < offer.totalDurationMinutes
      offer.paretoOptimal = !(lowerCostDominates || equalCostLowerStops || equalCostFaster)
    }

    for (let stops = 0; stops < bestDurationByStops.length; stops += 1) {
      bestDurationByStops[stops] = Math.min(bestDurationByStops[stops], groupBestByStops[stops])
    }
    start = end
  }
}

export function rankOffers(
  offers: RawOffer[],
  request: SearchRequest,
  weights: Partial<ScoringWeights> = {},
): RankedOffer[] {
  const scoring = { ...DEFAULT_WEIGHTS, ...weights }

  const eligible: RankedOffer[] = offers.flatMap((offer): RankedOffer[] => {
    const selectedPrice = pickPrice(offer, request.cabins, request.paymentMode, request.mileValueCents)
    if (!selectedPrice) return []

    const stops = Math.max(0, offer.segments.length - 1)
    const duration = totalDuration(offer)
    if (stops > request.maxStops || duration > request.maxDurationHours * 60) return []
    if (!request.separateTickets && !offer.singleTicket) return []

    const cashEquivalent = getComparableCash(selectedPrice, request.paymentMode, request.mileValueCents)
    const generalizedCost = cashEquivalent
      + duration * scoring.minuteValue
      + stops * scoring.stopPenalty
      + (!offer.singleTicket ? scoring.separateTicketPenalty : 0)

    const comparableCash = selectedPrice.cash ?? 0
    const milesValue = selectedPrice.miles && comparableCash
      ? ((comparableCash - (selectedPrice.taxes ?? 0)) / selectedPrice.miles) * 100
      : undefined

    const route = [offer.segments[0]?.from, ...offer.segments.map((segment) => segment.to)].filter(Boolean)
    const badges = [offer.fareLabel].filter((badge): badge is string => Boolean(badge))
    if (stops === 0) badges.push('Direct')
    if (offer.source === 'live') badges.push('Prix live')
    if (!offer.singleTicket) badges.push('Billets séparés')

    const rankedOffer: RankedOffer = {
      ...offer,
      selectedPrice,
      totalDurationMinutes: duration,
      stops,
      route,
      generalizedCost,
      dealScore: 0,
      mileValueCents: milesValue,
      savings: 0,
      risk: riskFor(offer, stops),
      paretoOptimal: false,
      badges,
    }
    return [rankedOffer]
  })

  if (eligible.length === 0) return []
  const directPrices = eligible.filter((offer) => offer.stops === 0).map((offer) => offer.selectedPrice.cash).filter((price): price is number => price != null)
  const baseline = directPrices.length
    ? Math.min(...directPrices)
    : Math.min(...eligible.map((offer) => offer.selectedPrice.cash ?? offer.generalizedCost))
  const maxCost = Math.max(...eligible.map((offer) => offer.generalizedCost))
  const minCost = Math.min(...eligible.map((offer) => offer.generalizedCost))
  const spread = Math.max(1, maxCost - minCost)

  for (const offer of eligible) {
    offer.savings = Math.max(0, baseline - (offer.selectedPrice.cash ?? offer.generalizedCost))
    offer.dealScore = Math.round(100 - ((offer.generalizedCost - minCost) / spread) * 42 - offer.stops * 4)
  }
  markParetoFront(eligible)

  return eligible.sort((a, b) => {
    if (a.paretoOptimal !== b.paretoOptimal) return a.paretoOptimal ? -1 : 1
    return a.generalizedCost - b.generalizedCost
  })
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return `${hours}h${remainder.toString().padStart(2, '0')}`
}
