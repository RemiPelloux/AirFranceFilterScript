export interface NetworkEdge {
  from: string
  to: string
  durationMinutes: number
  reliability: number
}

export interface RouteCandidate {
  airports: string[]
  durationMinutes: number
  stops: number
  reliability: number
  priority: number
}

interface QueueState extends RouteCandidate {
  current: string
}

class MinHeap<T> {
  private readonly values: T[] = []
  constructor(private readonly score: (value: T) => number) {}

  push(value: T) {
    this.values.push(value)
    let index = this.values.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.score(this.values[parent]) <= this.score(value)) break
      this.values[index] = this.values[parent]
      index = parent
    }
    this.values[index] = value
  }

  pop(): T | undefined {
    const root = this.values[0]
    const tail = this.values.pop()
    if (!tail || this.values.length === 0) return root
    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      if (left >= this.values.length) break
      const child = right < this.values.length && this.score(this.values[right]) < this.score(this.values[left]) ? right : left
      if (this.score(tail) <= this.score(this.values[child])) break
      this.values[index] = this.values[child]
      index = child
    }
    this.values[index] = tail
    return root
  }

  get size() { return this.values.length }
}

export function generateRouteCandidates(
  origin: string,
  destination: string,
  edges: NetworkEdge[],
  options: { maxStops: number; maxDurationMinutes: number; limit?: number },
): RouteCandidate[] {
  const adjacency = new Map<string, NetworkEdge[]>()
  for (const edge of edges) adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge])

  const queue = new MinHeap<QueueState>((state) => state.priority)
  queue.push({ current: origin, airports: [origin], durationMinutes: 0, stops: 0, reliability: 1, priority: 0 })
  const best = new Map<string, number>()
  const results: RouteCandidate[] = []
  const limit = options.limit ?? 24

  while (queue.size && results.length < limit) {
    const state = queue.pop()!
    if (state.current === destination) {
      results.push(state)
      continue
    }
    const legsUsed = state.airports.length - 1
    if (legsUsed > options.maxStops) continue

    for (const edge of adjacency.get(state.current) ?? []) {
      if (state.airports.includes(edge.to)) continue
      const durationMinutes = state.durationMinutes + edge.durationMinutes + (legsUsed ? 90 : 0)
      if (durationMinutes > options.maxDurationMinutes) continue
      const stops = state.airports.length - 1
      const reliability = state.reliability * edge.reliability
      const priority = durationMinutes + stops * 75 + (1 - reliability) * 240
      const key = `${edge.to}:${stops}`
      if ((best.get(key) ?? Infinity) <= priority) continue
      best.set(key, priority)
      queue.push({ current: edge.to, airports: [...state.airports, edge.to], durationMinutes, stops, reliability, priority })
    }
  }

  return results
}
