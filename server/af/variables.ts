import type { Cabin, SearchRequest } from '../../src/types.js'
import type { BookingFlow } from './types.js'

export const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const stationType = (value: string): 'CITY' | 'AIRPORT' => value === 'CITY' ? 'CITY' : 'AIRPORT'

/**
 * Air France rejects multi-cabin `commercialCabins` with code 9000.
 * Request the cheapest selected cabin; `withUpsellCabins` still returns the ladder.
 */
export const requestCommercialCabins = (cabins: Cabin[]): Cabin[] => {
  if (cabins.includes('ECONOMY')) return ['ECONOMY']
  if (cabins.includes('PREMIUM')) return ['PREMIUM']
  if (cabins.includes('BUSINESS')) return ['BUSINESS']
  return ['ECONOMY']
}

export const passengers = (request: SearchRequest) => Array.from(
  { length: request.adults },
  (_, index) => ({ id: index + 1, type: 'ADT' }),
)

export const selectedTravelCompanions = (request: SearchRequest) => Array.from(
  { length: request.adults },
  (_, index) => ({ passengerId: index + 1, travelerKey: index, travelerSource: 'PROFILE' }),
)

export const availableOfferVariables = (
  request: SearchRequest,
  searchStateUuid: string,
  bookingFlow: BookingFlow,
) => ({
  activeConnectionIndex: 0,
  bookingFlow,
  availableOfferRequestBody: {
    commercialCabins: requestCommercialCabins(request.cabins),
    passengers: passengers(request),
    requestedConnections: [
      {
        origin: { code: request.origin.code, type: stationType(request.origin.stationType) },
        destination: { code: request.destination.code, type: stationType(request.destination.stationType) },
        departureDate: request.departureDate,
      },
      {
        origin: { code: request.destination.code, type: stationType(request.destination.stationType) },
        destination: { code: request.origin.code, type: stationType(request.origin.stationType) },
        departureDate: request.returnDate,
        dateInterval: `${addDays(request.returnDate, -3)}/${addDays(request.returnDate, 3)}`,
      },
    ],
    bookingFlow,
    ...(bookingFlow === 'REWARD' ? {
      customer: { selectedTravelCompanions: selectedTravelCompanions(request) },
    } : {}),
    withUpsellCabins: true,
  },
  searchStateUuid,
})

export const contextPassengersVariables = (
  request: SearchRequest,
  searchStateUuid: string,
  bookingFlow: BookingFlow,
) => ({
  searchContextPassengersRequest: {
    requestedConnections: [
      {
        origin: { airport: { code: request.origin.code } },
        destination: { airport: { code: request.destination.code } },
        departureDate: request.departureDate,
      },
      {
        origin: { airport: { code: request.destination.code } },
        destination: { airport: { code: request.origin.code } },
        departureDate: request.returnDate,
      },
    ],
    bookingFlow,
    commercialCabins: requestCommercialCabins(request.cabins),
    passengers: passengers(request),
    ...(bookingFlow === 'REWARD' ? { customer: { selectedTravelCompanions: selectedTravelCompanions(request) } } : {}),
  },
  searchStateUuid,
})

export const lowestFareVariables = (
  request: SearchRequest,
  searchStateUuid: string,
  bookingFlow: BookingFlow,
  firstDate: string,
  lastDate: string,
  type: 'DAY' | 'MONTH' = 'DAY',
) => ({
  lowestFareOffersRequest: {
    bookingFlow,
    withUpsellCabins: true,
    passengers: passengers(request),
    commercialCabins: requestCommercialCabins(request.cabins),
    ...(bookingFlow === 'REWARD' ? { customer: { selectedTravelCompanions: selectedTravelCompanions(request) } } : {}),
    type,
    requestedConnections: [
      {
        departureDate: request.departureDate,
        dateInterval: `${firstDate}/${lastDate}`,
        origin: { type: stationType(request.origin.stationType), code: request.origin.code },
        destination: { type: stationType(request.destination.stationType), code: request.destination.code },
      },
      {
        dateInterval: null,
        origin: { type: stationType(request.destination.stationType), code: request.destination.code },
        destination: { type: stationType(request.origin.stationType), code: request.origin.code },
      },
    ],
  },
  activeConnection: 0,
  searchStateUuid,
  bookingFlow,
})

export const datePairLabel = (departureDate: string, returnDate: string): string => {
  const formatter = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', timeZone: 'UTC' })
  return `${formatter.format(new Date(`${departureDate}T00:00:00Z`))} → ${formatter.format(new Date(`${returnDate}T00:00:00Z`))}`
}

export const monthlyInterval = (departureDate: string): [string, string] => {
  const start = new Date(`${departureDate.slice(0, 7)}-01T00:00:00Z`)
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 12)
  end.setUTCDate(0)
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]
}

export const monthBounds = (month: string): [string, string] => {
  const start = new Date(`${month}-01T00:00:00Z`)
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 1)
  end.setUTCDate(0)
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]
}

export const candidateRequests = (request: SearchRequest): SearchRequest[] => {
  if (!request.flexibleDays) return [request]
  return Array.from({ length: request.flexibleDays * 2 + 1 }, (_, index) => {
    const departureDate = addDays(request.departureDate, index - request.flexibleDays)
    return { ...request, departureDate, returnDate: addDays(departureDate, request.tripLengthDays) }
  })
}
