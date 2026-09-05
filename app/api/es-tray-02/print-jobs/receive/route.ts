import { NextRequest } from 'next/server'
import { authenticateRelayAgent } from '@/lib/es-tray-relay/auth'
import { readRelayTimingConfig } from '@/lib/es-tray-relay/config'
import { relayError, relayJson, withRelayApiError } from '@/lib/es-tray-relay/http'
import { claimNextRelayPrintJob } from '@/lib/es-tray-relay/service'

export const runtime = 'nodejs'

/** Atomically claims at most one store-scoped print job for this binding. */
export async function POST(req: NextRequest) {
  return withRelayApiError(async () => {
    const auth = await authenticateRelayAgent(req)
    if (!auth.ok) return relayError(auth.error, auth.status)
    const { binding, tenantId, storeId } = auth.context
    const job = await claimNextRelayPrintJob({
      tenantId,
      storeId,
      computerBindingId: binding.id,
    }, readRelayTimingConfig())
    return relayJson({
      productionContract: true,
      schemaVersion: 1,
      job,
    })
  })
}
