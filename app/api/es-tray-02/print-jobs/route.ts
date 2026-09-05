import { NextRequest } from 'next/server'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'
import { parsePrintRequest } from '@/lib/es-tray-relay/contract'
import { readRelayTimingConfig } from '@/lib/es-tray-relay/config'
import { relayError, relayJson, withRelayApiError } from '@/lib/es-tray-relay/http'
import { enqueueRelayPrintJob } from '@/lib/es-tray-relay/service'

export const runtime = 'nodejs'

/** OWNER-scoped idempotent enqueue for the Tray Production Relay. */
export async function POST(req: NextRequest) {
  return withRelayApiError(async () => {
    const ctx = await getContext(req)
    if (!ctx) return relayError('LOGIN_REQUIRED', 401)
    if (ctx.role !== 'OWNER') return relayError('OWNER_REQUIRED', 403)

    const store = await prisma.store.findFirst({
      where: {
        id: ctx.storeId,
        tenantId: ctx.tenantId,
        status: 'ACTIVE',
        tenant: { status: 'ACTIVE' },
      },
      select: { id: true, tenantId: true },
    })
    if (!store) return relayError('STORE_UNAVAILABLE', 403)

    const request = parsePrintRequest(await req.json())
    const result = await enqueueRelayPrintJob({
      tenantId: store.tenantId,
      storeId: store.id,
    }, request, readRelayTimingConfig())
    return relayJson({
      // Desktop 0.4.7 requires this historical response envelope. The marker
      // is retained strictly as a frozen-client compatibility field; the job
      // itself is persisted under the production contract below.
      fieldOnly: true,
      jobId: result.job.id,
      requestId: request.requestId,
      status: 'PENDING_RECEIVE',
      productionContract: true,
      schemaVersion: result.job.schemaVersion,
      created: result.created,
      job: result.job,
    }, { status: 202 })
  })
}
