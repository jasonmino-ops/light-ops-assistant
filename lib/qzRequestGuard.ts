// Minimal async-lifecycle guard for QZ Tray refresh requests. A refresh
// (detect online -> list printers) spans multiple awaits; the active
// store can change while one is in flight. This guard lets a request
// check, after every await, whether it is still the latest request for
// the store it was started for — if not, it must exit without writing
// any React state or localStorage.

export type MutableRef<T> = { current: T }

export type QzRequestToken = {
  token: number
  /** True only if no newer request has started and the active store hasn't changed since this request began. */
  isCurrent: () => boolean
}

/**
 * Starts a new QZ request for `requestStoreCode`, invalidating any
 * previously started request — including an earlier one for the same
 * store, so only the newest request may ever write.
 */
export function startQzRequest(
  versionRef: MutableRef<number>,
  activeStoreCodeRef: MutableRef<string | null>,
  requestStoreCode: string | null,
): QzRequestToken {
  versionRef.current += 1
  const token = versionRef.current
  return {
    token,
    isCurrent: () => versionRef.current === token && activeStoreCodeRef.current === requestStoreCode,
  }
}

/**
 * Call synchronously whenever the active store changes (including to
 * null), before any other store-transition handling. Invalidates every
 * in-flight QZ request, whichever store it was started for.
 */
export function invalidateQzRequests(
  versionRef: MutableRef<number>,
  activeStoreCodeRef: MutableRef<string | null>,
  nextStoreCode: string | null,
) {
  versionRef.current += 1
  activeStoreCodeRef.current = nextStoreCode
}
