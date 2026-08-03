import type {
  ExploreMonthItem,
  FareCalendarItem,
  MonthlyFareItem,
  RawOffer,
  SearchRequest,
} from '../../src/types.js'

export type BookingFlow = 'LEISURE' | 'REWARD'

export interface Money {
  amount?: number
  currencyCode?: string
}

export interface ApiSegment {
  origin?: { code?: string; name?: string; city?: { name?: string } }
  destination?: { code?: string; name?: string; city?: { name?: string } }
  departureDateTime?: string
  arrivalDateTime?: string
  duration?: number
  equipmentName?: string
  equipmentType?: string
  transferDuration?: number | null
  seatMapEligible?: boolean
  stopsAt?: Array<{ code?: string; name?: string }> | null
  marketingFlight?: {
    number?: string
    carrier?: { code?: string; name?: string }
    operatingFlight?: {
      carrier?: { code?: string; name?: string }
      number?: string
      equipmentType?: { name?: string }
    }
  }
}

export interface ApiProductConnection {
  _id?: string
  cabinClass?: string
  cabinClassTitle?: string
  price?: Money
  tax?: Money | null
  isPromo?: boolean
  promoTitle?: string | null
  numberOfSeatsAvailable?: number
  fareFamily?: { code?: string }
}

export interface ApiOfferItinerary {
  _id?: string
  activeConnection?: {
    duration?: number
    segments?: ApiSegment[]
  }
  flightProducts?: Array<{ connections?: ApiProductConnection[] }>
  upsellCabinProducts?: Array<{ connections?: ApiProductConnection[] }>
}

export interface AvailableOffersPayload {
  data?: {
    availableOffers?: {
      offerItineraries?: ApiOfferItinerary[]
      warnings?: Array<{ code?: string; description?: string }> | null
      code?: string
      description?: string
      message?: string
    }
  }
  errors?: Array<{ message?: string; extensions?: { code?: string } }>
}

export interface LowestFareOffer {
  flightDate?: string
  currency?: string
  totalPrice?: number
  totalPriceItinerary?: number
  totalTaxDetails?: { currency?: string; totalPrice?: number }
  noFlight?: boolean
}

export interface LowestFarePayload {
  data?: { lowestFareOffers?: { lowestOffers?: LowestFareOffer[]; warning?: { description?: string } | null } }
  errors?: Array<{ message?: string; extensions?: { code?: string } }>
}

export interface SearchCustomerPayload {
  data?: Record<string, unknown> | null
  errors?: Array<{ message?: string; extensions?: { code?: string } }>
}

export interface SearchCapture {
  offers: RawOffer[]
  fareCalendar: FareCalendarItem[]
  monthlyCalendar: MonthlyFareItem[]
  operations: string[]
  candidatePairs: number
}

export interface ExploreCapture {
  months: ExploreMonthItem[]
  operations: string[]
}

export type { SearchRequest }
