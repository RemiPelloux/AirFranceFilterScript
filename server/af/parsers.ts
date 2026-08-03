import type { Cabin, CabinPrice, ExploreFare, MonthlyFareItem, RawOffer, SearchRequest } from '../../src/types.js'
import { MAX_EXACT_DATE_PAIRS } from './hashes.js'
import { graphQlErrorMessage } from './hashcash.js'
import type { AvailableOffersPayload, BookingFlow, LowestFareOffer } from './types.js'

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100

const cabinFromApi = (value?: string): Cabin | undefined => {
  if (value === 'ECONOMY' || value === 'PREMIUM' || value === 'BUSINESS') return value
  return undefined
}

/** Prefer round-trip Open Dates floor (`totalPriceItinerary`); fall back to outbound. */
const roundTripFloor = (fare: LowestFareOffer): number | undefined => (
  fare.totalPriceItinerary ?? fare.totalPrice
)

export const parseMonthlyFares = (
  lowestFares: LowestFareOffer[],
  bookingFlow: BookingFlow,
): MonthlyFareItem[] => {
  const formatter = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  const byMonth = new Map<string, MonthlyFareItem>()
  for (const fare of lowestFares) {
    if (!fare.flightDate || fare.noFlight) continue
    const value = roundTripFloor(fare)
    if (value == null) continue
    const month = fare.flightDate.slice(0, 7)
    const current = byMonth.get(month)
    const currentValue = current
      ? (bookingFlow === 'REWARD' ? current.miles : current.cash) ?? Infinity
      : Infinity
    if (value >= currentValue) continue
    byMonth.set(month, {
      month,
      label: formatter.format(new Date(`${month}-01T00:00:00Z`)),
      ...(bookingFlow === 'REWARD'
        ? {
          miles: value,
          milesFlightDate: fare.flightDate,
          itineraryMiles: fare.totalPriceItinerary ?? value,
          taxes: fare.totalTaxDetails?.totalPrice,
        }
        : {
          cash: value,
          cashFlightDate: fare.flightDate,
          itineraryCash: fare.totalPriceItinerary ?? value,
        }),
    })
  }
  return [...byMonth.values()].sort((left, right) => left.month.localeCompare(right.month))
}

export const parseDailyTopFares = (
  lowestFares: LowestFareOffer[],
  minimumDate: string,
  limit = 3,
): ExploreFare[] => {
  const byDate = new Map<string, ExploreFare>()
  for (const fare of lowestFares) {
    if (!fare.flightDate || fare.flightDate < minimumDate || fare.noFlight) continue
    const price = roundTripFloor(fare)
    if (price == null) continue
    const current = byDate.get(fare.flightDate)
    if (current && current.price <= price) continue
    byDate.set(fare.flightDate, {
      date: fare.flightDate,
      price,
      ...(fare.totalTaxDetails?.totalPrice != null ? { taxes: fare.totalTaxDetails.totalPrice } : {}),
    })
  }
  return [...byDate.values()]
    .sort((left, right) => left.price - right.price || left.date.localeCompare(right.date))
    .slice(0, limit)
}

export const selectExactCandidates = (
  request: SearchRequest,
  candidates: SearchRequest[],
  lowestFares: LowestFareOffer[],
): SearchRequest[] => {
  if (candidates.length <= MAX_EXACT_DATE_PAIRS) return candidates
  const fareByDate = new Map(lowestFares
    .filter((fare) => fare.flightDate && !fare.noFlight)
    .map((fare) => [fare.flightDate!, fare.totalPriceItinerary ?? fare.totalPrice ?? Infinity]))
  const base = candidates.find((candidate) => candidate.departureDate === request.departureDate)
  const selected = candidates
    .filter((candidate) => candidate !== base)
    .sort((left, right) => (fareByDate.get(left.departureDate) ?? Infinity) - (fareByDate.get(right.departureDate) ?? Infinity))
    .slice(0, MAX_EXACT_DATE_PAIRS - (base ? 1 : 0))
  return [...(base ? [base] : []), ...selected]
    .sort((left, right) => left.departureDate.localeCompare(right.departureDate))
}

export const parseAvailableOffers = (
  payload: AvailableOffersPayload,
  verifiedAt = new Date().toISOString(),
  dates?: Pick<SearchRequest, 'departureDate' | 'returnDate'>,
): RawOffer[] => {
  if (payload.errors?.length) throw new Error(graphQlErrorMessage(payload.errors))
  if (payload.data?.availableOffers?.code) {
    throw new Error([
      payload.data.availableOffers.code,
      payload.data.availableOffers.message,
      payload.data.availableOffers.description,
    ].filter(Boolean).join(': '))
  }
  const itineraries = payload.data?.availableOffers?.offerItineraries ?? []
  return itineraries.flatMap((itinerary, offerIndex): RawOffer[] => {
    const apiSegments = itinerary.activeConnection?.segments ?? []
    if (!apiSegments.length) return []

    const pricesByCabin = new Map<Cabin, CabinPrice>()
    let promo = false
    for (const product of itinerary.upsellCabinProducts ?? []) {
      for (const connection of product.connections ?? []) {
        const cabin = cabinFromApi(connection.cabinClass)
        const currency = connection.price?.currencyCode
        if (!cabin || connection.price?.amount == null || (currency !== 'EUR' && currency !== 'MILES')) continue
        const completeProduct = itinerary.flightProducts?.find((candidate) => {
          const active = candidate.connections?.[0]
          return active?._id === connection._id
            || (active?.price?.amount === connection.price?.amount && active?.price?.currencyCode === currency)
        })
        const completeConnections = completeProduct?.connections?.length ? completeProduct.connections : [connection]
        const rawAmount = completeConnections.reduce((sum, item) => (
          item.price?.currencyCode === currency ? sum + (item.price.amount ?? 0) : sum
        ), 0)
        const rawTaxes = completeConnections.reduce((sum, item) => (
          item.tax?.currencyCode === 'EUR' ? sum + (item.tax.amount ?? 0) : sum
        ), 0)
        const amount = currency === 'EUR' ? roundMoney(rawAmount) : rawAmount
        const taxes = roundMoney(rawTaxes)
        const current = pricesByCabin.get(cabin) ?? { cabin }
        if (currency === 'EUR' && (current.cash == null || amount < current.cash)) {
          current.cash = amount
          current.seatsAvailable = connection.numberOfSeatsAvailable
          current.fareFamily = connection.fareFamily?.code
        }
        if (currency === 'MILES' && (current.miles == null || amount < current.miles)) {
          current.miles = amount
          current.taxes = taxes
          current.seatsAvailable = connection.numberOfSeatsAvailable
          current.fareFamily = connection.fareFamily?.code
        }
        pricesByCabin.set(cabin, current)
        promo ||= Boolean(connection.isPromo)
      }
    }
    const prices = [...pricesByCabin.values()]
    if (!prices.length) return []

    const segments = apiSegments.flatMap((segment) => {
      const from = segment.origin?.code
      const to = segment.destination?.code
      if (!from || !to) return []
      const carrier = segment.marketingFlight?.carrier?.name
        ?? segment.marketingFlight?.operatingFlight?.carrier?.name
        ?? segment.marketingFlight?.carrier?.code
        ?? 'Air France'
      const operatingCarrier = segment.marketingFlight?.operatingFlight?.carrier?.name
        ?? segment.marketingFlight?.operatingFlight?.carrier?.code
      const operatingCarrierCode = segment.marketingFlight?.operatingFlight?.carrier?.code
      const operatingNumber = segment.marketingFlight?.operatingFlight?.number
      return [{
        from,
        to,
        departure: segment.departureDateTime ?? '',
        arrival: segment.arrivalDateTime ?? '',
        durationMinutes: segment.duration,
        carrier,
        flightNumber: [segment.marketingFlight?.carrier?.code, segment.marketingFlight?.number].filter(Boolean).join(''),
        operatingCarrier,
        operatingFlightNumber: [operatingCarrierCode, operatingNumber].filter(Boolean).join(''),
        aircraft: segment.equipmentName ?? segment.marketingFlight?.operatingFlight?.equipmentType?.name,
        originName: segment.origin?.name ?? segment.origin?.city?.name,
        destinationName: segment.destination?.name ?? segment.destination?.city?.name,
        layoverAfterMinutes: segment.transferDuration ?? undefined,
        seatMapEligible: segment.seatMapEligible,
      }]
    })
    if (!segments.length) return []

    return [{
      id: [
        itinerary._id ?? `airfrance-${offerIndex}-${segments.map((segment) => `${segment.from}-${segment.to}`).join('-')}`,
        dates?.departureDate,
        dates?.returnDate,
      ].filter(Boolean).join(':'),
      source: 'live',
      verifiedAt,
      singleTicket: true,
      bagsIncluded: null,
      totalDurationMinutes: itinerary.activeConnection?.duration,
      fareLabel: promo ? 'Promo' : undefined,
      departureDate: dates?.departureDate,
      returnDate: dates?.returnDate,
      segments,
      prices,
    }]
  })
}
