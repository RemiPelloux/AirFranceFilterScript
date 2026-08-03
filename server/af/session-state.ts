const WARM_TTL_MS = 60_000
let lastWarmOkAt = 0

export const markSessionWarm = (): void => {
  lastWarmOkAt = Date.now()
}

export const isSessionWarm = (): boolean => Date.now() - lastWarmOkAt < WARM_TTL_MS
