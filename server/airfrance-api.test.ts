import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalize, parseAvailableOffers, parseDailyTopFares, parseMonthlyFares, solveHashcash } from './airfrance-api.js'

describe('Air France GraphQL protocol', () => {
  it('canonicalizes variables recursively and solves the v2 challenge', () => {
    const variables = { z: 1, a: { y: 2, x: 3 }, list: [{ b: 2, a: 1 }] }
    expect(canonicalize(variables)).toEqual({ a: { x: 3, y: 2 }, list: [{ a: 1, b: 2 }], z: 1 })

    const timestamp = '2026-08-02T14:41:16.692Z'
    const solution = solveHashcash(variables, timestamp)
    const expectedChallenge = JSON.stringify({
      a: { x: 3, y: 2 },
      list: [{ a: 1, b: 2 }],
      z: 1,
      timestamp,
    })
    const expectedInitialHash = createHash('sha256').update(expectedChallenge).digest('hex')
    expect(solution.hash.startsWith(`${expectedInitialHash}-`)).toBe(true)
    expect(createHash('sha256').update(solution.hash).digest('hex').startsWith('000')).toBe(true)
  })

  it('maps segments and joins the outbound upsell to the complete round-trip product', () => {
    const offers = parseAvailableOffers({
      data: {
        availableOffers: {
          offerItineraries: [{
            _id: 'OfferItinerary:test',
            activeConnection: {
              duration: 825,
              segments: [{
                origin: { code: 'NCE' },
                destination: { code: 'CDG' },
                departureDateTime: '2026-10-02T20:35:00',
                arrivalDateTime: '2026-10-02T22:10:00',
                duration: 95,
                marketingFlight: { number: '7319', carrier: { code: 'AF', name: 'Air France' } },
              }],
            },
            flightProducts: [
              { connections: [
                { _id: 'economy-out', price: { amount: 730.46, currencyCode: 'EUR' } },
                { _id: 'economy-back', price: { amount: 471.45, currencyCode: 'EUR' } },
              ] },
              { connections: [
                { _id: 'business-out', price: { amount: 3585.76, currencyCode: 'EUR' } },
                { _id: 'business-back', price: { amount: 772.75, currencyCode: 'EUR' } },
              ] },
            ],
            upsellCabinProducts: [{ connections: [
              { _id: 'economy-out', cabinClass: 'ECONOMY', price: { amount: 730.46, currencyCode: 'EUR' } },
              { _id: 'business-out', cabinClass: 'BUSINESS', price: { amount: 3585.76, currencyCode: 'EUR' }, isPromo: true },
            ] }],
          }],
        },
      },
    }, '2026-08-02T15:11:58.731Z')

    expect(offers).toHaveLength(1)
    expect(offers[0]).toMatchObject({
      id: 'OfferItinerary:test',
      totalDurationMinutes: 825,
      fareLabel: 'Promo',
      prices: [
        { cabin: 'ECONOMY', cash: 1201.91 },
        { cabin: 'BUSINESS', cash: 4358.51 },
      ],
      segments: [{ from: 'NCE', to: 'CDG', carrier: 'Air France', flightNumber: 'AF7319' }],
    })
  })

  it('keeps the lowest round-trip open-date fare for each reward month', () => {
    expect(parseMonthlyFares([
      { flightDate: '2026-12-19', totalPrice: 50000, totalPriceItinerary: 115000 },
      { flightDate: '2026-12-07', totalPrice: 30000, totalPriceItinerary: 95000, totalTaxDetails: { totalPrice: 319.66 } },
      { flightDate: '2026-12-20', totalPrice: 28000, totalPriceItinerary: 99000 },
      { flightDate: '2027-01-12', totalPrice: 50000, totalPriceItinerary: 100000 },
      { flightDate: '2027-02-01', totalPrice: 25000, noFlight: true },
    ], 'REWARD')).toEqual([
      expect.objectContaining({ month: '2026-12', milesFlightDate: '2026-12-07', miles: 95000, itineraryMiles: 95000, taxes: 319.66 }),
      expect.objectContaining({ month: '2027-01', milesFlightDate: '2027-01-12', miles: 100000, itineraryMiles: 100000 }),
    ])
  })

  it('selects the three cheapest distinct round-trip days and ignores invalid calendar rows', () => {
    expect(parseDailyTopFares([
      { flightDate: '2026-12-01', totalPrice: 42000, totalPriceItinerary: 90000, totalTaxDetails: { totalPrice: 73.2 } },
      { flightDate: '2026-12-07', totalPrice: 30000, totalPriceItinerary: 70000, totalTaxDetails: { totalPrice: 91.4 } },
      { flightDate: '2026-12-07', totalPrice: 35000, totalPriceItinerary: 80000, totalTaxDetails: { totalPrice: 80 } },
      { flightDate: '2026-12-12', totalPrice: 50000, totalPriceItinerary: 61000 },
      { flightDate: '2026-12-19', totalPrice: 30000, totalPriceItinerary: 72000 },
      { flightDate: '2026-12-25', totalPrice: 25000, totalPriceItinerary: 40000, noFlight: true },
      { flightDate: '2026-11-29', totalPrice: 12000, totalPriceItinerary: 20000 },
      { flightDate: '2026-12-31' },
    ], '2026-12-01')).toEqual([
      { date: '2026-12-12', price: 61000 },
      { date: '2026-12-07', price: 70000, taxes: 91.4 },
      { date: '2026-12-19', price: 72000 },
    ])
  })
})
