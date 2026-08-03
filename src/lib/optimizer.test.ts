import { describe, expect, it } from 'vitest'
import { rankOffers } from './optimizer'
import type { RawOffer, SearchRequest, Station } from '../types'

const station = (code: string, cityName: string): Station => ({
  code, cityCode: code, cityName, countryName: 'Test', displayText: cityName,
  stationType: 'AIRPORT', isOrigin: true, isDestination: true,
})

const request: SearchRequest = {
  origin: station('AAA', 'Départ'),
  destination: station('DDD', 'Arrivée'),
  departureDate: '2026-09-15',
  returnDate: '2026-09-22',
  flexibleDays: 0,
  tripLengthDays: 7,
  cabins: ['ECONOMY'],
  paymentMode: 'cash',
  adults: 1,
  maxStops: 2,
  maxDurationHours: 24,
  nearbyAirports: true,
  separateTickets: false,
  longLayover: false,
  mileValueCents: 1.2,
}

const offers: RawOffer[] = [
  {
    id: 'direct', source: 'live', verifiedAt: '2026-08-02T10:00:00Z', singleTicket: true,
    bagsIncluded: null, totalDurationMinutes: 540,
    segments: [{ from: 'AAA', to: 'DDD', departure: '10:00', arrival: '19:00', carrier: 'AF' }],
    prices: [{ cabin: 'ECONOMY', cash: 420, miles: 20_000, taxes: 80 }],
  },
  {
    id: 'fast-connection', source: 'live', verifiedAt: '2026-08-02T10:00:00Z', singleTicket: true,
    bagsIncluded: null, totalDurationMinutes: 620,
    segments: [
      { from: 'AAA', to: 'BBB', departure: '08:00', arrival: '09:30', carrier: 'AF' },
      { from: 'BBB', to: 'DDD', departure: '11:00', arrival: '18:20', carrier: 'AF' },
    ],
    prices: [{ cabin: 'ECONOMY', cash: 300, miles: 18_000, taxes: 75 }],
  },
  {
    id: 'slow-connection', source: 'live', verifiedAt: '2026-08-02T10:00:00Z', singleTicket: true,
    bagsIncluded: null, totalDurationMinutes: 760,
    segments: [
      { from: 'AAA', to: 'CCC', departure: '07:00', arrival: '09:00', carrier: 'AF' },
      { from: 'CCC', to: 'DDD', departure: '13:00', arrival: '19:40', carrier: 'AF' },
    ],
    prices: [{ cabin: 'ECONOMY', cash: 350, miles: 17_000, taxes: 70 }],
  },
]

describe('rankOffers', () => {
  it('keeps only routes allowed by constraints', () => {
    const ranked = rankOffers(offers, { ...request, maxStops: 0 })
    expect(ranked).toHaveLength(1)
    expect(ranked[0].stops).toBe(0)
  })

  it('computes the Pareto front without promoting dominated offers', () => {
    const ranked = rankOffers(offers, request)
    expect(ranked.filter((offer) => offer.paretoOptimal).map((offer) => offer.id).sort()).toEqual(['direct', 'fast-connection'])
    expect(ranked.find((offer) => offer.id === 'slow-connection')?.paretoOptimal).toBe(false)
  })

  it('ranks Miles with a configurable valuation', () => {
    const ranked = rankOffers(offers, { ...request, paymentMode: 'miles' })
    expect(ranked[0].selectedPrice.miles).toBeDefined()
  })
})
