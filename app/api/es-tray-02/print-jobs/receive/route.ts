import { NextRequest } from 'next/server'
import { authenticateRelayAgent } from '@/lib/es-tray-relay/auth'
import { readRelayTimingConfig } from '@/lib/es-tray-relay/config'
import { relayError, relayJson, withRelayApiError } from '@/lib/es-tray-relay/http'
import { claimNextRelayPrintJob, readNetworkQueueState } from '@/lib/es-tray-relay/service'
import { NETWORK_MODE_GUARD_CLIENT_VERSION, parseNetworkMode } from '@/e-shop-tray/src/networkContract'

export const runtime = 'nodejs'

/** Atomically claims at most one store-scoped print job for this binding. */
export async function POST(req: NextRequest) {
  return withRelayApiError(async () => {
    const auth = await authenticateRelayAgent(req)
    if (!auth.ok) return relayError(auth.error, auth.status)
    const { binding, tenantId, storeId, storeCode, schemaVersion } = auth.context
    const requestedMode = req.headers.get('x-es-network-mode')
    if (req.headers.get('x-es-tray-version') === NETWORK_MODE_GUARD_CLIENT_VERSION && requestedMode === null) {
      return relayError('NETWORK_EXPECTED_MODE_REQUIRED', 400)
    }
    let expectedMode: ReturnType<typeof parseNetworkMode> | undefined
    if (requestedMode !== null) {
      if (schemaVersion !== 2) return relayError('NETWORK_MODE_GUARD_REQUIRES_V2', 400)
      try { expectedMode = parseNetworkMode(requestedMode) }
      catch { return relayError('NETWORK_INVALID_MODE', 400) }
    }
    const job = await claimNextRelayPrintJob({
      tenantId,
      storeId,
      computerBindingId: binding.id,
      schemaVersion,
      ...(expectedMode ? { expectedMode } : {}),
    }, readRelayTimingConfig())
    return relayJson({
      productionContract: true,
      schemaVersion,
      ...(schemaVersion === 2 ? { bindingId: binding.id, storeCode } : {}),
      ...(expectedMode ? { modeGuard: expectedMode } : {}),
      job,
    })
  })
}

/** Same bound-agent authentication; deliberately does not call POST/recovery.
 * Counts are a fresh observation, not a promise that no sale can arrive later. */
export async function GET(req: NextRequest) {
  return withRelayApiError(async () => {
    const auth = await authenticateRelayAgent(req)
    if (!auth.ok) return relayError(auth.error, auth.status)
    const { binding, tenantId, storeId, storeCode, schemaVersion } = auth.context
    if (schemaVersion !== 2) return relayError('NETWORK_MODE_GUARD_REQUIRES_V2', 400)
    if (req.nextUrl.search || req.headers.has('x-es-network-mode')) return relayError('NETWORK_INVALID_QUEUE_QUERY', 400)
    return relayJson({ productionContract: true, schemaVersion: 2, bindingId: binding.id, storeCode,
      observedAt: new Date().toISOString(), queue: await readNetworkQueueState({ tenantId, storeId }) })
  })
}
