import { describe, expect, it } from 'vitest'
import { FLYING_BLUE_LOGIN_URL } from './auth-login.js'

describe('Flying Blue login helpers', () => {
  it('points the login window at the Air France identification gateway', () => {
    expect(FLYING_BLUE_LOGIN_URL).toBe('https://wwws.airfrance.fr/identification')
  })
})
