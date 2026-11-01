import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Station } from '../src/types.js'

const REFERENCE_HASH = 'c11344fdd1be05827219b57614c2a6a9dfc88a3da3b8c0fd11cbf48443ff6acb'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
const STATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const execFileAsync = promisify(execFile)

interface ReferenceResponse {
  data?: {
    flatStations?: Station[]
  }
}

let stationCache: { stations: Station[]; expiresAt: number } | undefined

const getJsonViaCurl = async <T>(url: string): Promise<T> => {
  const { stdout } = await execFileAsync('curl', [
    '--http2', '--compressed', '--fail', '--silent', '--show-error', '--max-time', '25',
    '--user-agent', USER_AGENT,
    '--header', 'Accept: application/json',
    '--header', 'Referer: https://wwws.airfrance.fr/',
    url,
  ], { maxBuffer: 4 * 1024 * 1024 })
  return JSON.parse(stdout) as T
}

export async function getAirFranceStations(): Promise<Station[]> {
  if (stationCache && stationCache.expiresAt > Date.now()) return stationCache.stations

  const encodeGraphqlParam = (value: unknown) => encodeURIComponent(JSON.stringify(value))
    .replaceAll('%3A', ':')
    .replaceAll('%2C', ',')
  const variables = encodeGraphqlParam({ bookingFlow: 'LEISURE' })
  const extensions = encodeGraphqlParam({ persistedQuery: { version: 1, sha256Hash: REFERENCE_HASH } })
  const query = `bookingFlow=LEISURE&brand=AF&country=FR&language=fr&operationName=SharedSearchBoxReferenceDataForSearchQuery&variables=${variables}&extensions=${extensions}`

  const payload = await getJsonViaCurl<ReferenceResponse>(`https://wwws.airfrance.fr/gql/v1?${query}`)
  const stations = payload.data?.flatStations
  if (!stations?.length) throw new Error('Le référentiel Air France est vide')

  stationCache = { stations, expiresAt: Date.now() + STATION_CACHE_TTL_MS }
  return stations
}
