import type { Cabin, CabinPrice, RawOffer } from '../../src/types.js'

const offerFingerprint = (offer: RawOffer): string => [
  offer.departureDate,
  offer.returnDate,
  ...offer.segments.map((segment) => `${segment.flightNumber}:${segment.from}:${segment.to}:${segment.departure}`),
].join('|')

const mergePrices = (cashPrices: CabinPrice[], rewardPrices: CabinPrice[]): CabinPrice[] => {
  const byCabin = new Map<Cabin, CabinPrice>()
  for (const price of [...cashPrices, ...rewardPrices]) {
    byCabin.set(price.cabin, { ...byCabin.get(price.cabin), ...price, cabin: price.cabin })
  }
  return [...byCabin.values()]
}

export const mergeCashAndRewardOffers = (cashOffers: RawOffer[], rewardOffers: RawOffer[]): RawOffer[] => {
  const merged = new Map<string, RawOffer>()
  const fingerprints = new Map<string, string>()
  for (const offer of cashOffers) {
    merged.set(offer.id, {
      ...offer,
      segments: offer.segments.map((segment) => ({ ...segment })),
      prices: offer.prices.map((price) => ({ ...price })),
    })
    fingerprints.set(offerFingerprint(offer), offer.id)
  }
  for (const rewardOffer of rewardOffers) {
    const existingId = merged.has(rewardOffer.id) ? rewardOffer.id : fingerprints.get(offerFingerprint(rewardOffer))
    const existing = existingId ? merged.get(existingId) : undefined
    if (!existing) {
      merged.set(rewardOffer.id, {
        ...rewardOffer,
        segments: rewardOffer.segments.map((segment) => ({ ...segment })),
        prices: rewardOffer.prices.map((price) => ({ ...price })),
      })
      continue
    }
    existing.prices = mergePrices(existing.prices, rewardOffer.prices)
    existing.verifiedAt = rewardOffer.verifiedAt > existing.verifiedAt ? rewardOffer.verifiedAt : existing.verifiedAt
  }
  return [...merged.values()]
}
