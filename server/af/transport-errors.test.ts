import { describe, expect, it } from 'vitest'
import {
  describeAirFranceTransportError,
  isAirFranceNetworkError,
} from './transport-errors.js'

describe('transport-errors', () => {
  it('detects HTTP/2 protocol failures', () => {
    const error = new Error('page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://wwws.airfrance.fr/')
    expect(isAirFranceNetworkError(error)).toBe(true)
    expect(describeAirFranceTransportError(error)).toMatch(/Akamai/)
    expect(describeAirFranceTransportError(error)).toMatch(/VPN/)
  })

  it('detects navigation timeouts', () => {
    expect(isAirFranceNetworkError(new Error('page.waitForURL: Timeout 45000ms exceeded'))).toBe(true)
  })

  it('passes through unrelated errors', () => {
    const error = new Error('Flying Blue session expired')
    expect(isAirFranceNetworkError(error)).toBe(false)
    expect(describeAirFranceTransportError(error)).toBe('Flying Blue session expired')
  })
})
