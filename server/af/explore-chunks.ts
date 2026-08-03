import type { Page } from 'patchright'
import type { ExploreMonthItem } from '../../src/types.js'
import { refreshCollectorPage } from './browser.js'
import {
  BATCH_CONCURRENCY,
  BATCH_SPACING_MS,
  EXPLORE_CHUNK_DELAY_MS,
  EXPLORE_CHUNK_SIZE,
} from './hashes.js'

type MonthSeed = { month: string; label: string }

/** FilterScript-style chunked DAY loads with refresh retry. */
export const loadExploreMonths = async (
  page: Page,
  seeds: MonthSeed[],
  loadMonth: (seed: MonthSeed) => Promise<ExploreMonthItem | undefined>,
): Promise<ExploreMonthItem[]> => {
  const monthResults = new Array<ExploreMonthItem | undefined>(seeds.length)

  for (let chunkStart = 0; chunkStart < seeds.length; chunkStart += EXPLORE_CHUNK_SIZE) {
    const chunk = seeds.slice(chunkStart, chunkStart + EXPLORE_CHUNK_SIZE)
    const failedIndexes: number[] = []
    try {
      monthResults[chunkStart] = await loadMonth(chunk[0])
    } catch {
      failedIndexes.push(chunkStart)
    }

    let nextOffset = 1
    const worker = async () => {
      while (nextOffset < chunk.length) {
        const offset = nextOffset
        nextOffset += 1
        const index = chunkStart + offset
        await page.waitForTimeout(BATCH_SPACING_MS)
        try {
          monthResults[index] = await loadMonth(chunk[offset])
        } catch {
          failedIndexes.push(index)
        }
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(BATCH_CONCURRENCY, Math.max(0, chunk.length - 1)) },
      () => worker(),
    ))

    if (failedIndexes.length) {
      await refreshCollectorPage(page)
      for (const index of failedIndexes) {
        monthResults[index] = await loadMonth(seeds[index])
      }
    }
    if (chunkStart + chunk.length < seeds.length) {
      await page.waitForTimeout(EXPLORE_CHUNK_DELAY_MS)
    }
  }

  return monthResults.filter((month): month is ExploreMonthItem => month != null)
}
