import { describe, expect, it } from 'vitest'
import { matchStationQuery, stationLabel } from './stations'
import type { Station } from '../types'

const station = (code: string, cityName: string, stationType: 'AIRPORT' | 'CITY' = 'AIRPORT'): Station => ({
  code,
  cityCode: code,
  cityName,
  countryName: 'France',
  displayText: `${cityName}, ${code}`,
  stationType,
  isOrigin: true,
  isDestination: true,
})

describe('station selection', () => {
  const options = [
    station('NCE', 'Nice'),
    station('RUN', 'Saint-Denis'),
    station('NYC', 'New York', 'CITY'),
    station('JFK', 'New York'),
  ]

  it('resolves a typed IATA code instead of retaining the previous destination', () => {
    expect(matchStationQuery('RUN', options)?.code).toBe('RUN')
    expect(matchStationQuery('New York (JFK)', options)?.code).toBe('JFK')
  })

  it('does not guess when a city label matches several Air France stations', () => {
    expect(matchStationQuery('New York', options)).toBeUndefined()
    expect(stationLabel(options[0])).toBe('Nice (NCE)')
  })
})
