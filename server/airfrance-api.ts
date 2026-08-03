/** Compatibility facade — implementation lives in `server/af/`. */
export {
  canonicalize,
  closeAirFranceTransport,
  exploreCashFares,
  exploreRewardFares,
  FlyingBlueAuthError,
  importFlyingBlueSession,
  isFlyingBlueAuthenticated,
  mergeCashAndRewardOffers,
  openFlyingBlueLogin,
  parseAvailableOffers,
  parseDailyTopFares,
  parseMonthlyFares,
  prewarmCollector,
  searchCashOffers,
  searchRewardOffers,
  solveHashcash,
} from './af/index.js'
