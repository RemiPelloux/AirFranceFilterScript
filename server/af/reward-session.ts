import { randomUUID } from 'node:crypto'
import type { Page } from 'patchright'
import type { SearchRequest } from '../../src/types.js'
import { openFlyingBlueLoginOnPage } from './auth-login.js'
import { CLIENT_REVISION, CONTEXT_PASSENGERS_HASH, SEARCH_CUSTOMER_HASH } from './hashes.js'
import { FlyingBlueAuthError } from './hashcash.js'
import { postGraphQl, postGraphQlWithRetry } from './transport.js'
import type { SearchCustomerPayload } from './types.js'
import { contextPassengersVariables } from './variables.js'

const requireFlyingBlue = async (page: Page, cause?: string): Promise<never> => {
  await openFlyingBlueLoginOnPage(page).catch(() => undefined)
  throw new FlyingBlueAuthError(cause)
}

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
      await requireFlyingBlue(page)
    }
  } catch (error) {
    if (error instanceof FlyingBlueAuthError) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (/401|not authenticated|Flying Blue|CustomerAPI/i.test(message)) {
      await requireFlyingBlue(page, message)
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
