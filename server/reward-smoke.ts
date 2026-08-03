import type { SearchRequest, Station } from '../src/types.js'
import { closeAirFranceTransport, searchRewardOffers } from './airfrance-api.js'

const station = (code: string, cityName: string): Station => ({
  code,
  cityCode: code,
  cityName,
  countryName: 'France',
  displayText: `${cityName} (${code})`,
  stationType: 'AIRPORT',
  isOrigin: true,
  isDestination: true,
})

const request: SearchRequest = {
  origin: station('NCE', 'Nice'),
  destination: station('RUN', 'Saint-Denis de la Réunion'),
  departureDate: '2026-10-02',
  returnDate: '2026-10-12',
  flexibleDays: Number(process.env.AF_SMOKE_FLEX_DAYS ?? 0),
  tripLengthDays: 10,
  cabins: ['ECONOMY'],
  paymentMode: 'miles',
  adults: 1,
  maxStops: 2,
  maxDurationHours: 72,
  nearbyAirports: false,
  separateTickets: false,
  longLayover: false,
  mileValueCents: 1.2,
}

try {
  const result = await searchRewardOffers(request)
  const rewardPrices = result.offers.flatMap((offer) => offer.prices.filter((price) => price.miles != null))
  if (!rewardPrices.length) throw new Error('Air France returned no Flying Blue reward prices')
  const lowest = rewardPrices.reduce((best, price) => price.miles! < best.miles! ? price : best)
  console.log(JSON.stringify({
    offers: result.offers.length,
    lowestMiles: lowest.miles,
    taxes: lowest.taxes,
    aircraft: result.offers[0]?.segments.map((segment) => segment.aircraft),
    monthlyCalendar: result.monthlyCalendar,
    candidatePairs: result.candidatePairs,
    operations: result.operations,
  }))
} finally {
  await closeAirFranceTransport()
}
