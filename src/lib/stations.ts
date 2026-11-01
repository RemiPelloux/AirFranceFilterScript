import type { Station } from '../types'

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\([^)]*\)/g, '')
  .trim()
  .toLowerCase()

export const stationLabel = (station: Station): string => station.code
  ? `${station.cityName || station.displayText || station.code} (${station.code})`
  : ''

export const matchStationQuery = (query: string, stations: Station[]): Station | undefined => {
  const parenthesizedCode = query.match(/\(([a-z0-9]{3})\)\s*$/i)?.[1]?.toLowerCase()
  if (parenthesizedCode) {
    const codeMatch = stations.find((station) => station.code.toLowerCase() === parenthesizedCode)
    if (codeMatch) return codeMatch
  }
  const needle = normalize(query)
  if (!needle) return undefined
  const codeMatch = stations.find((station) => station.code.toLowerCase() === needle)
  if (codeMatch) return codeMatch
  const exactMatches = stations.filter((station) => (
    normalize(station.cityName) === needle
    || normalize(station.displayText) === needle
    || normalize(stationLabel(station)) === needle
  ))
  return exactMatches.length === 1 ? exactMatches[0] : undefined
}
