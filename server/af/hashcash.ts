import { createHash } from 'node:crypto'

export const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value as Record<string, unknown>)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]))
}

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')

export const solveHashcash = (variables: unknown, timestamp = new Date().toISOString()) => {
  const challenge = JSON.stringify({ ...(canonicalize(variables) as Record<string, unknown>), timestamp })
  const initialHash = sha256(challenge)
  let nonce = 0
  while (!sha256(`${initialHash}-${nonce}`).startsWith('000')) nonce += 1
  return { version: 2 as const, timestamp, hash: `${initialHash}-${nonce}` }
}

export const graphQlErrorMessage = (
  errors: Array<{ message?: string; extensions?: { code?: string } }>,
): string => errors
  .map((error) => [error.extensions?.code, error.message].filter(Boolean).join(': '))
  .join('; ')

export class FlyingBlueAuthError extends Error {
  constructor(message = 'Session Flying Blue requise ou expirée') {
    super(message)
    this.name = 'FlyingBlueAuthError'
  }
}
