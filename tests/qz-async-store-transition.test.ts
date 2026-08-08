import assert from 'node:assert/strict'
import { invalidateQzRequests, startQzRequest, type MutableRef } from '../lib/qzRequestGuard'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type QzUiState = {
  qzStatus: 'idle' | 'checking' | 'online' | 'offline'
  qzPrinters: string[]
  qzSelectedPrinter: string | null
  qzChecking: boolean
}

/**
 * Reimplements the same control flow as handleRefreshQzStatus in
 * app/cashier/page.tsx, using the real qzRequestGuard module and fake
 * React-state / localStorage sinks so the async lifecycle race can be
 * driven with deferred promises. Rendering the actual component isn't
 * practical in this test setup (no React Testing Library here), so this
 * harness exercises the guard exactly as the component does.
 */
function makeHarness() {
  const state: QzUiState = { qzStatus: 'idle', qzPrinters: [], qzSelectedPrinter: null, qzChecking: false }
  const versionRef: MutableRef<number> = { current: 0 }
  const activeStoreCodeRef: MutableRef<string | null> = { current: null }
  const storageWrites: { storeCode: string; printer: string | null }[] = []
  let activeStoreCode: string | null = null

  function setActiveStore(storeCode: string | null) {
    activeStoreCode = storeCode
    invalidateQzRequests(versionRef, activeStoreCodeRef, storeCode)
    // Mirrors the reset in the storeCode-change effect.
    state.qzStatus = 'idle'
    state.qzPrinters = []
    state.qzSelectedPrinter = null
    state.qzChecking = false
  }

  async function refresh(deps: { listQzPrinters: () => Promise<string[]> }) {
    if (state.qzChecking) return
    const requestStoreCode = activeStoreCode
    const request = startQzRequest(versionRef, activeStoreCodeRef, requestStoreCode)
    if (!requestStoreCode || !request.isCurrent()) return

    state.qzChecking = true
    state.qzStatus = 'checking'
    try {
      const printers = await deps.listQzPrinters()
      if (!request.isCurrent()) return
      state.qzPrinters = printers
      state.qzStatus = 'online'
      if (state.qzSelectedPrinter && !printers.includes(state.qzSelectedPrinter)) {
        state.qzSelectedPrinter = null
        storageWrites.push({ storeCode: requestStoreCode, printer: null })
      }
    } catch {
      if (!request.isCurrent()) return
      state.qzStatus = 'offline'
      state.qzPrinters = []
    } finally {
      if (request.isCurrent()) state.qzChecking = false
    }
  }

  return { state, storageWrites, setActiveStore, refresh }
}

async function testEnumerationPendingThenStoreSwitchesToB() {
  const h = makeHarness()
  h.setActiveStore('STORE-A')
  const listDeferred = deferred<string[]>()

  const refreshPromise = h.refresh({
    listQzPrinters: () => listDeferred.promise,
  })

  assert.equal(h.state.qzChecking, true, 'refresh must mark checking while enumeration is pending')

  h.setActiveStore('STORE-B')
  listDeferred.resolve(['SHOULD_NOT_BE_APPLIED'])
  await refreshPromise

  assert.equal(h.state.qzStatus, 'idle', 'the stale Store A enumeration must not overwrite Store B state')
  assert.deepEqual(h.state.qzPrinters, [])
  assert.equal(h.state.qzChecking, false, 'the reset for Store B must not be clobbered by the stale request')
}

async function testEnumerationDoesNotReachNewStore() {
  const h = makeHarness()
  h.setActiveStore('STORE-A')
  const listDeferred = deferred<string[]>()

  const refreshPromise = h.refresh({
    listQzPrinters: () => listDeferred.promise,
  })

  await Promise.resolve()
  await Promise.resolve()

  h.setActiveStore('STORE-B')
  listDeferred.resolve(['Printer POS-80'])
  await refreshPromise

  assert.equal(h.state.qzStatus, 'idle', 'a stale Store A printer list must not overwrite Store B state')
  assert.deepEqual(h.state.qzPrinters, [], 'the stale printer list must never reach Store B state')
}

async function testStoreCodeBecomesNullMidRefresh() {
  const h = makeHarness()
  h.setActiveStore('STORE-A')
  const listDeferred = deferred<string[]>()

  const refreshPromise = h.refresh({
    listQzPrinters: () => listDeferred.promise,
  })

  h.setActiveStore(null)
  listDeferred.resolve(['POS-80'])
  await refreshPromise

  assert.equal(h.state.qzStatus, 'idle', 'a request whose store became null must not write any status')
  assert.equal(h.state.qzChecking, false)
}

async function testOnlyNewestOfTwoRefreshesForSameStoreWrites() {
  const h = makeHarness()
  h.setActiveStore('STORE-A')
  const firstList = deferred<string[]>()
  const secondList = deferred<string[]>()

  // Bypass the qzChecking guard the same way overlapping calls could in
  // the real component (e.g. two rapid triggers before state flushes).
  const first = h.refresh({ listQzPrinters: () => firstList.promise })
  h.state.qzChecking = false
  const second = h.refresh({ listQzPrinters: () => secondList.promise })

  secondList.resolve(['second'])
  await second
  assert.equal(h.state.qzStatus, 'online')
  assert.deepEqual(h.state.qzPrinters, ['second'], 'the newest request must be the one that writes printers')

  firstList.resolve(['first'])
  await first
  assert.deepEqual(h.state.qzPrinters, ['second'], 'the stale first request must not overwrite the newest result')
}

async function testStaleRequestNeverClearsPrinterConfigAfterSwitch() {
  const h = makeHarness()
  h.setActiveStore('STORE-A')
  h.state.qzSelectedPrinter = 'Printer A'
  const listDeferred = deferred<string[]>()

  const refreshPromise = h.refresh({
    listQzPrinters: () => listDeferred.promise,
  })
  await Promise.resolve()
  await Promise.resolve()

  h.setActiveStore('STORE-B')
  h.state.qzSelectedPrinter = 'Printer B'
  // Store A's printer list resolves without "Printer A" in it — this must
  // not be interpreted as Store B's printer having disappeared.
  listDeferred.resolve(['Printer X'])
  await refreshPromise

  assert.equal(h.state.qzSelectedPrinter, 'Printer B', 'the stale Store A result must not clear Store B\'s selected printer')
  assert.deepEqual(h.storageWrites, [], 'no storage write may happen for a stale cross-store request')
}

async function testCurrentValidRequestStillSucceeds() {
  const h = makeHarness()
  h.setActiveStore('STORE-A')
  await h.refresh({
    listQzPrinters: async () => ['Printer POS-80'],
  })

  assert.equal(h.state.qzStatus, 'online')
  assert.deepEqual(h.state.qzPrinters, ['Printer POS-80'])
  assert.equal(h.state.qzChecking, false)
}

async function testQzCheckingNotResetByStaleRequestWhileNewerActive() {
  const h = makeHarness()
  h.setActiveStore('STORE-A')
  const staleList = deferred<string[]>()

  const stale = h.refresh({ listQzPrinters: () => staleList.promise })

  h.setActiveStore('STORE-A') // re-invalidate without changing store, simulating a fresh newer request window
  const newerListDeferred = deferred<string[]>()
  const newer = h.refresh({ listQzPrinters: () => newerListDeferred.promise })

  assert.equal(h.state.qzChecking, true, 'the newer request must be marked checking')

  staleList.resolve(['stale'])
  await stale
  assert.equal(h.state.qzChecking, true, 'a stale request finishing must not clear qzChecking while the newer one is still in flight')

  newerListDeferred.resolve(['Printer POS-80'])
  await newer
  assert.equal(h.state.qzChecking, false, 'the newer request must be the one that clears qzChecking')
  assert.deepEqual(h.state.qzPrinters, ['Printer POS-80'])
}

async function run() {
  await testEnumerationPendingThenStoreSwitchesToB()
  await testEnumerationDoesNotReachNewStore()
  await testStoreCodeBecomesNullMidRefresh()
  await testOnlyNewestOfTwoRefreshesForSameStoreWrites()
  await testStaleRequestNeverClearsPrinterConfigAfterSwitch()
  await testCurrentValidRequestStillSucceeds()
  await testQzCheckingNotResetByStaleRequestWhileNewerActive()
  console.log('qz async store transition tests passed')
}

void run().catch((error) => {
  setTimeout(() => { throw error }, 0)
})
