import type { Page } from 'patchright'
import type { ExploreFare, ExploreMonthItem } from '../../src/types.js'
import { refreshCollectorPage } from './browser.js'
import {
  BATCH_CONCURRENCY,
  BATCH_SPACING_MS,
  EXPLORE_CHUNK_DELAY_MS,
  EXPLORE_CHUNK_SIZE,
} from './hashes.js'
import { parseDailyTopFares, parseDailyTopFaresByMonth } from './parsers.js'
import type { LowestFareOffer } from './types.js'

type MonthSeed = { month: string; label: string }

const toExploreMonth = (
  seed: MonthSeed,
  top3: ExploreFare[],
  side: 'cash' | 'miles',
): ExploreMonthItem | undefined => {
  if (!top3.length) return undefined
  return side === 'cash'
    ? { month: seed.month, label: seed.label, cashTop3: top3, milesTop3: [] }
    : { month: seed.month, label: seed.label, cashTop3: [], milesTop3: top3 }
}

/** One wide DAY query → Top 3 per month; fill gaps with per-month DAY only if needed. */
export const loadExploreMonthsFromHorizon = async (
  page: Page,
  seeds: MonthSeed[],
  side: 'cash' | 'miles',
  minimumDate: string,
  loadHorizonDay: () => Promise<LowestFareOffer[]>,
  loadMonthDay: (seed: MonthSeed) => Promise<LowestFareOffer[]>,
): Promise<ExploreMonthItem[]> => {
  if (!seeds.length) return []

  const horizonFares = await loadHorizonDay()
  const byMonth = parseDailyTopFaresByMonth(
    horizonFares,
    minimumDate,
    seeds.map((seed) => seed.month),
  )
  const months = seeds.flatMap((seed) => {
    const item = toExploreMonth(seed, byMonth.get(seed.month) ?? [], side)
    return item ? [item] : []
  })
  if (months.length >= seeds.length) return months

  const covered = new Set(months.map((month) => month.month))
  const missing = seeds.filter((seed) => !covered.has(seed.month))
  const filled = await loadExploreMonths(page, missing, async (seed) => {
    const fares = await loadMonthDay(seed)
    const top3 = parseDailyTopFares(
      fares,
      minimumDate > `${seed.month}-01` ? minimumDate : `${seed.month}-01`,
    ).filter((fare) => fare.date.startsWith(seed.month))
    return toExploreMonth(seed, top3, side)
  })
  return [...months, ...filled].sort((left, right) => left.month.localeCompare(right.month))
}

/** FilterScript-style chunked DAY loads with refresh retry (gap-fill only). */
export const loadExploreMonths = async (
  page: Page,
  seeds: MonthSeed[],
  loadMonth: (seed: MonthSeed) => Promise<ExploreMonthItem | undefined>,
): Promise<ExploreMonthItem[]> => {
  const monthResults = new Array<ExploreMonthItem | undefined>(seeds.length)

  for (let chunkStart = 0; chunkStart < seeds.length; chunkStart += EXPLORE_CHUNK_SIZE) {
    const chunk = seeds.slice(chunkStart, chunkStart + EXPLORE_CHUNK_SIZE)
    const failedIndexes: number[] = []
    let nextOffset = 0
    const worker = async () => {
      while (nextOffset < chunk.length) {
        const offset = nextOffset
        nextOffset += 1
        const index = chunkStart + offset
        if (offset > 0) await page.waitForTimeout(BATCH_SPACING_MS)
        try {
          monthResults[index] = await loadMonth(chunk[offset])
        } catch {
          failedIndexes.push(index)
        }
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(BATCH_CONCURRENCY, chunk.length) },
      () => worker(),
    ))

    if (failedIndexes.length) {
      await refreshCollectorPage(page)
      await Promise.all(failedIndexes.map(async (index, retryOffset) => {
        if (retryOffset > 0) await page.waitForTimeout(BATCH_SPACING_MS)
        monthResults[index] = await loadMonth(seeds[index])
      }))
    }
    if (chunkStart + chunk.length < seeds.length) {
      await page.waitForTimeout(EXPLORE_CHUNK_DELAY_MS)
    }
  }

  return monthResults.filter((month): month is ExploreMonthItem => month != null)
}
