import { randomUUID } from 'node:crypto'
import type { Page } from 'patchright'
import type { SearchRequest } from '../../src/types.js'
import { navigateAirFrance, refreshCollectorPage } from './browser.js'
import {
  CLIENT_REVISION,
  COLLECTOR_PAGE,
  CONTEXT_PASSENGERS_HASH,
  CREATE_SEARCH_CONTEXT_HASH,
  SEARCH_CUSTOMER_HASH,
} from './hashes.js'
import { FlyingBlueAuthError } from './hashcash.js'
import { postGraphQlWithRetry } from './transport.js'
import type {
  CreateSearchContextPayload,
  RewardSession,
  SearchCustomerPayload,
  TravelCompanion,
} from './types.js'
import { contextPassengersVariables } from './variables.js'

export const rewardTransportOptions = {
  withHashcash: true,
  queryBookingFlow: 'LEISURE' as const,
  useRewardHeaders: true,
  revision: CLIENT_REVISION,
}

const normalizeTravelers = (raw: unknown): Array<{ travelerKey?: number; travelerSource?: string }> => {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return []
  const record = raw as Record<string, unknown>
  if (Array.isArray(record.nodes)) return record.nodes as Array<{ travelerKey?: number; travelerSource?: string }>
  if (Array.isArray(record.edges)) {
    return record.edges.flatMap((edge) => {
      const node = (edge as { node?: { travelerKey?: number; travelerSource?: string } })?.node
      return node ? [node] : []
    })
  }
  if ('travelerKey' in record) return [record as { travelerKey?: number; travelerSource?: string }]
  return []
}

const companionsFromContext = (travelers: unknown, adults: number): TravelCompanion[] => {
  const usable = normalizeTravelers(travelers).filter((traveler) => traveler.travelerKey != null)
  if (!usable.length) {
    throw new FlyingBlueAuthError(
      'Aucun voyageur Flying Blue dans le profil. Ouvrez une recherche Miles sur airfrance.fr une fois, puis réessayez.',
    )
  }
  return usable.slice(0, adults).map((traveler, index) => ({
    passengerId: index + 1,
    travelerKey: Number(traveler.travelerKey),
    travelerSource: traveler.travelerSource ?? 'PROFILE',
  }))
}

const ensureCollectorPage = async (page: Page): Promise<void> => {
  if (page.url().includes('/search/')) return
  await navigateAirFrance(page, COLLECTOR_PAGE, 1_500)
}

/** Auth + CreateSearchContext traveler keys + ContextPassengers. */
export const prepareRewardSession = async (
  page: Page,
  request: SearchRequest,
): Promise<RewardSession> => {
  const searchStateUuid = randomUUID()
  await ensureCollectorPage(page)
  try {
    const payload = await postGraphQlWithRetry<SearchCustomerPayload>(
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

  let context: CreateSearchContextPayload
  try {
    context = await postGraphQlWithRetry<CreateSearchContextPayload>(
      page,
      'SharedSearchCreateSearchContextForSearchQuery',
      CREATE_SEARCH_CONTEXT_HASH,
      { searchStateUuid },
      { withHashcash: false, useRewardHeaders: true, revision: CLIENT_REVISION },
    )
  } catch {
    await refreshCollectorPage(page)
    context = await postGraphQlWithRetry<CreateSearchContextPayload>(
      page,
      'SharedSearchCreateSearchContextForSearchQuery',
      CREATE_SEARCH_CONTEXT_HASH,
      { searchStateUuid },
      rewardTransportOptions,
    )
  }
  const companions = companionsFromContext(
    context.data?.createSearchContext?.possibleTravelersFromProfile,
    request.adults,
  )

  await postGraphQlWithRetry(
    page,
    'SharedSearchContextPassengersForSearchQuery',
    CONTEXT_PASSENGERS_HASH,
    contextPassengersVariables(request, searchStateUuid, 'REWARD', companions),
    rewardTransportOptions,
  )
  return { searchStateUuid, companions }
}
