import {
  AVAILABLE_OFFERS_HASH,
  FILTERSCRIPT_AVAILABLE_OFFERS_HASH,
  FILTERSCRIPT_LOWEST_FARE_HASH,
  LOWEST_FARE_HASH,
  RATLINE_AVAILABLE_OFFERS_HASH,
  RATLINE_LOWEST_FARE_HASH,
} from './hashes.js'

export interface ActiveHashes {
  lowestFare: string
  availableOffers: string
}

export const createActiveHashes = (): ActiveHashes => ({
  lowestFare: LOWEST_FARE_HASH,
  availableOffers: AVAILABLE_OFFERS_HASH,
})

const isPersistedQueryMiss = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return /PersistedQueryNotFound|PersistedQueryNotSupported/i.test(message)
}

/** Retry once with Ratline Aug 2026 hashes if FilterScript persisted queries are gone. */
export const withHashFallback = async <T>(
  hashes: ActiveHashes,
  work: () => Promise<T>,
): Promise<T> => {
  try {
    return await work()
  } catch (error) {
    if (!isPersistedQueryMiss(error)) throw error
    if (hashes.lowestFare === RATLINE_LOWEST_FARE_HASH) throw error
    hashes.lowestFare = RATLINE_LOWEST_FARE_HASH
    hashes.availableOffers = RATLINE_AVAILABLE_OFFERS_HASH
    return work()
  }
}

export const resetHashesToFilterScript = (hashes: ActiveHashes): void => {
  hashes.lowestFare = FILTERSCRIPT_LOWEST_FARE_HASH
  hashes.availableOffers = FILTERSCRIPT_AVAILABLE_OFFERS_HASH
}
