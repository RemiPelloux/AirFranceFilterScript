import { randomUUID } from 'node:crypto'
import type { Page } from 'patchright'
import type { SearchRequest } from '../../src/types.js'
import { CLIENT_REVISION, CONTEXT_PASSENGERS_HASH, SEARCH_CUSTOMER_HASH } from './hashes.js'
import { FlyingBlueAuthError } from './hashcash.js'
import { postGraphQl, postGraphQlWithRetry } from './transport.js'
import type { SearchCustomerPayload } from './types.js'
import { contextPassengersVariables } from './variables.js'

export const rewardTransportOptions = {
  withHashcash: true,
  queryBookingFlow: 'LEISURE' as const,
  useRewardHeaders: true,
  revision: CLIENT_REVISION,
}

export const prepareRewardSession = async (page: Page, request: SearchRequest): Promise<string> => {
  const searchStateUuid = randomUUID()
  try {
    const payload = await postGraphQl<SearchCustomerPayload>(
      page,
      'SearchCustomerForSearchQuery',
      SEARCH_CUSTOMER_HASH,
      { expand: 'memberships_flyingblue' },
      { withHashcash: false, useRewardHeaders: true, revision: CLIENT_REVISION },
    )
    if (!payload.data || Object.values(payload.data).every((value) => value == null)) {
      throw new FlyingBlueAuthError()
    }
  } catch (error) {
    if (error instanceof FlyingBlueAuthError) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (/401|not authenticated|Flying Blue|CustomerAPI/i.test(message)) {
      throw new FlyingBlueAuthError(message)
    }
    throw error
  }
  await postGraphQlWithRetry(
    page,
    'SharedSearchContextPassengersForSearchQuery',
    CONTEXT_PASSENGERS_HASH,
    contextPassengersVariables(request, searchStateUuid, 'REWARD'),
    rewardTransportOptions,
  )
  return searchStateUuid
}
