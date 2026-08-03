/** Relative path — same-origin page fetch (FilterScript). */
export const ENDPOINT_PATH = '/gql/v1'
/** Absolute URL — iframe-native fetch from about:blank. */
export const ENDPOINT = 'https://wwws.airfrance.fr/gql/v1'
export const COLLECTOR_PAGE = 'https://wwws.airfrance.fr/search/advanced'
export const SAFE_OPERATION = 'SharedSearchLowestFareOffersForSearchQuery'

export const CLIENT_REVISION = process.env.AF_CLIENT_REVISION
  ?? 'dde95d6e7f7007d3044fb2037a564eba31e0792f'

export const SEARCH_CUSTOMER_HASH = process.env.AF_SEARCH_CUSTOMER_HASH
  ?? '53889e4674809bd79531db2e36e74fbad491c7d6c001f6936b2b13329f625013'

export const CONTEXT_PASSENGERS_HASH = process.env.AF_CONTEXT_PASSENGERS_HASH
  ?? 'f8426ca72294a62b4cd5bb000233f07917ebbc0eb5a7b9703a4fadeeef7b934f'

/** Proven FilterScript hashes used for cash by default. */
export const FILTERSCRIPT_LOWEST_FARE_HASH =
  '3129e42881c15d2897fe99c294497f2cfa8f2133109dd93ed6cad720633b0243'
export const FILTERSCRIPT_AVAILABLE_OFFERS_HASH =
  '6c2316d35d088fdd0d346203ec93cec7eea953752ff2fc18a759f9f2ba7b690a'

/** Ratline Aug 2026 hashes — fallback / Reward default. */
export const RATLINE_LOWEST_FARE_HASH =
  'da21c63708940f578da4e9fb30c1fdf41ae6e7bf4fe8851257c351d66b5dff80'
export const RATLINE_AVAILABLE_OFFERS_HASH =
  '6fc9f9d92bb3fe738cd47068a41ed2170d207876084cc71e21b8e72bbeb7712f'

export const LOWEST_FARE_HASH = process.env.AF_LOWEST_FARE_HASH
  ?? FILTERSCRIPT_LOWEST_FARE_HASH
export const AVAILABLE_OFFERS_HASH = process.env.AF_AVAILABLE_OFFERS_HASH
  ?? FILTERSCRIPT_AVAILABLE_OFFERS_HASH

export const CACHE_TTL_MS = 120_000
export const BROWSER_TIMEOUT_MS = 60_000
export const MAX_EXACT_DATE_PAIRS = 7
export const BATCH_CONCURRENCY = 3
export const BATCH_SPACING_MS = 280
export const EXPLORE_CHUNK_SIZE = 5
export const EXPLORE_CHUNK_DELAY_MS = 1_200
export const RETRY_BACKOFF_MS = 600
export const MAX_FETCH_RETRIES = 3
