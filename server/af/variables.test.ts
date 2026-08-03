import { describe, expect, it } from 'vitest'
import {
  availableOfferVariables,
  contextPassengersVariables,
  contextStation,
  requestCommercialCabins,
} from './variables.js'
import type { SearchRequest } from '../../src/types.js'

const sampleRequest = (cabins: SearchRequest['cabins']): SearchRequest => ({
  origin: {
    code: 'NCE', cityCode: 'NCE', cityName: 'Nice', countryName: 'France',
    displayText: 'Nice', stationType: 'AIRPORT', isOrigin: true, isDestination: true,
  },
  destination: {
    code: 'NYC', cityCode: 'NYC', cityName: 'New York', countryName: 'US',
    displayText: 'NYC', stationType: 'CITY', isOrigin: true, isDestination: true,
  },
  departureDate: '2026-09-01',
  returnDate: '2026-09-11',
  flexibleDays: 0,
  tripLengthDays: 10,
  cabins,
  paymentMode: 'cash',
  adults: 1,
  maxStops: 2,
  maxDurationHours: 48,
  nearbyAirports: true,
  separateTickets: false,
  longLayover: false,
  mileValueCents: 1.2,
})

describe('requestCommercialCabins', () => {
  it('collapses multi-cabin UI selection to a single AF request cabin', () => {
    expect(requestCommercialCabins(['ECONOMY', 'PREMIUM', 'BUSINESS'])).toEqual(['ECONOMY'])
    expect(requestCommercialCabins(['PREMIUM', 'BUSINESS'])).toEqual(['PREMIUM'])
    expect(requestCommercialCabins(['BUSINESS'])).toEqual(['BUSINESS'])
  })

  it('sends only one commercial cabin in AvailableOffers variables', () => {
    const variables = availableOfferVariables(
      sampleRequest(['ECONOMY', 'PREMIUM', 'BUSINESS']),
      'uuid',
      'LEISURE',
    )
    expect(variables.availableOfferRequestBody.commercialCabins).toEqual(['ECONOMY'])
  })

  it('uses CreateSearchContext traveler keys for Reward companions', () => {
    const variables = availableOfferVariables(
      sampleRequest(['ECONOMY']),
      'uuid',
      'REWARD',
      [{ passengerId: 1, travelerKey: 42, travelerSource: 'PROFILE' }],
    )
    expect(variables.availableOfferRequestBody.customer).toEqual({
      selectedTravelCompanions: [
        { passengerId: 1, travelerKey: 42, travelerSource: 'PROFILE' },
      ],
    })
  })
})

describe('contextStation / ContextPassengers', () => {
  it('nests CITY codes under city and AIRPORT under airport', () => {
    expect(contextStation({ code: 'NYC', stationType: 'CITY' })).toEqual({ city: { code: 'NYC' } })
    expect(contextStation({ code: 'NCE', stationType: 'AIRPORT' })).toEqual({ airport: { code: 'NCE' } })
  })

  it('builds Reward ContextPassengers with city/airport nesting', () => {
    const variables = contextPassengersVariables(
      sampleRequest(['ECONOMY']),
      'uuid',
      'REWARD',
      [{ passengerId: 1, travelerKey: 0, travelerSource: 'PROFILE' }],
    )
    expect(variables.searchContextPassengersRequest.requestedConnections).toEqual([
      {
        origin: { airport: { code: 'NCE' } },
        destination: { city: { code: 'NYC' } },
        departureDate: '2026-09-01',
      },
      {
        origin: { city: { code: 'NYC' } },
        destination: { airport: { code: 'NCE' } },
        departureDate: '2026-09-11',
      },
    ])
  })
})

