/** Map Chromium / network failures to actionable French messages. */

const NETWORK_PATTERN = /ERR_HTTP2_PROTOCOL_ERROR|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_REFUSED|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_CHANGED|ERR_SSL_|net::ERR_|Navigation Air France impossible|Timeout|timed out/i

export const isAirFranceNetworkError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return NETWORK_PATTERN.test(message)
}

export const describeAirFranceTransportError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  if (isAirFranceNetworkError(error)) {
    return [
      'Air France (Akamai) est injoignable depuis ce réseau',
      '(ERR_HTTP2 / timeout).',
      'Ouvrez https://wwws.airfrance.fr dans Chrome : si la page échoue aussi,',
      'changez de réseau (4G / VPN) puis relancez Ratline.',
    ].join(' ')
  }
  return message.slice(0, 240)
}
