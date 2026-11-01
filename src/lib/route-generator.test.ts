import { describe, expect, it } from 'vitest'
import { generateRouteCandidates, type NetworkEdge } from './route-generator'

const edges: NetworkEdge[] = [
  { from: 'NCE', to: 'JFK', durationMinutes: 555, reliability: 0.96 },
  { from: 'NCE', to: 'CDG', durationMinutes: 95, reliability: 0.94 },
  { from: 'CDG', to: 'JFK', durationMinutes: 470, reliability: 0.96 },
  { from: 'NCE', to: 'BIO', durationMinutes: 95, reliability: 0.9 },
  { from: 'BIO', to: 'CDG', durationMinutes: 100, reliability: 0.91 },
  { from: 'BIO', to: 'NCE', durationMinutes: 95, reliability: 0.9 },
]

describe('generateRouteCandidates', () => {
  it('finds direct, standard and opportunistic paths without cycles', () => {
    const routes = generateRouteCandidates('NCE', 'JFK', edges, { maxStops: 2, maxDurationMinutes: 24 * 60 })
    expect(routes.map((route) => route.airports.join('-'))).toEqual([
      'NCE-JFK',
      'NCE-CDG-JFK',
      'NCE-BIO-CDG-JFK',
    ])
  })

  it('prunes routes outside the stop budget', () => {
    const routes = generateRouteCandidates('NCE', 'JFK', edges, { maxStops: 0, maxDurationMinutes: 24 * 60 })
    expect(routes.map((route) => route.airports.join('-'))).toEqual(['NCE-JFK'])
  })
})
