export type Cabin = 'ECONOMY' | 'PREMIUM' | 'BUSINESS'
export type PaymentMode = 'cash' | 'miles' | 'both'
export type DataSource = 'live'
export type SearchStatus = 'complete' | 'empty' | 'blocked' | 'auth-required'

export interface Station {
  code: string
  cityCode: string
  cityName: string
  countryName: string
  displayText: string
  stationType: 'AIRPORT' | 'CITY' | 'RAIL' | string
  isOrigin: boolean
  isDestination: boolean
}

export interface SearchRequest {
  origin: Station
  destination: Station
  departureDate: string
  returnDate: string
  flexibleDays: number
  tripLengthDays: number
  cabins: Cabin[]
  paymentMode: PaymentMode
  adults: number
  maxStops: 0 | 1 | 2
  maxDurationHours: number
  nearbyAirports: boolean
  separateTickets: boolean
  longLayover: boolean
  mileValueCents: number
}

export interface Segment {
  from: string
  to: string
  departure: string
  arrival: string
  durationMinutes?: number
  carrier: string
  flightNumber?: string
  operatingCarrier?: string
  operatingFlightNumber?: string
  aircraft?: string
  originName?: string
  destinationName?: string
  layoverAfterMinutes?: number
  seatMapEligible?: boolean
}

export interface CabinPrice {
  cabin: Cabin
  cash?: number
  miles?: number
  taxes?: number
  seatsAvailable?: number
  fareFamily?: string
}

export interface RawOffer {
  id: string
  segments: Segment[]
  prices: CabinPrice[]
  source: DataSource
  verifiedAt: string
  singleTicket: boolean
  bagsIncluded: boolean | null
  totalDurationMinutes?: number
  fareLabel?: string
  departureDate?: string
  returnDate?: string
}

export interface FareCalendarItem {
  departureDate: string
  returnDate: string
  label: string
  cash?: number
  miles?: number
  taxes?: number
  selected: boolean
}

export interface MonthlyFareItem {
  month: string
  label: string
  cash?: number
  cashFlightDate?: string
  miles?: number
  milesFlightDate?: string
  taxes?: number
  itineraryCash?: number
  itineraryMiles?: number
}

export interface ExploreFare {
  date: string
  price: number
  taxes?: number
}

export interface ExploreMonthItem {
  month: string
  label: string
  cashTop3: ExploreFare[]
  milesTop3: ExploreFare[]
}

export interface ExploreResponse {
  requestId: string
  source: DataSource
  months: ExploreMonthItem[]
  warnings: string[]
  searchedAt: string
  durationMs: number
  status: SearchStatus
  /** True when Miles were requested but Flying Blue session is missing. */
  authRequired?: boolean
  trace: {
    operations: string[]
    cacheHit: boolean
  }
}

export interface RankedOffer extends RawOffer {
  selectedPrice: CabinPrice
  totalDurationMinutes: number
  stops: number
  route: string[]
  generalizedCost: number
  dealScore: number
  mileValueCents?: number
  savings: number
  risk: 'low' | 'medium' | 'high'
  paretoOptimal: boolean
  badges: string[]
}

export interface SearchResponse {
  requestId: string
  source: DataSource
  offers: RawOffer[]
  warnings: string[]
  searchedAt: string
  durationMs: number
  status: SearchStatus
  fareCalendar: FareCalendarItem[]
  monthlyCalendar: MonthlyFareItem[]
  /** True when Miles were requested but Flying Blue session is missing. */
  authRequired?: boolean
  trace: {
    catalog: 'airfrance-gql'
    collector: 'airfrance-gql'
    cacheHit: boolean
    operations: string[]
    candidatePairs: number
  }
}
