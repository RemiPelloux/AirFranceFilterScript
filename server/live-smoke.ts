import type { SearchRequest, Station } from '../src/types.js'
import { closeAirFranceTransport, searchCashOffers } from './airfrance-api.js'

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
  paymentMode: 'cash',
  adults: 1,
  maxStops: 2,
  maxDurationHours: 72,
  nearbyAirports: false,
  separateTickets: false,
  longLayover: false,
  mileValueCents: 1.2,
}

try {
  const result = await searchCashOffers(request)
  if (!result.offers.length) throw new Error('Air France returned no live offers')
  const lowestCash = Math.min(...result.offers.flatMap((offer) => offer.prices.flatMap((price) => price.cash ?? [])))
  console.log(JSON.stringify({
    offers: result.offers.length,
    lowestCash,
    monthlyCalendar: result.monthlyCalendar,
    candidatePairs: result.candidatePairs,
    operations: result.operations,
  }))
} finally {
  await closeAirFranceTransport()
}
