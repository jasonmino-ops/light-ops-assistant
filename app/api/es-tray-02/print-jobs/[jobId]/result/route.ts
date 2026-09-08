import { NextRequest } from 'next/server'
import { authenticateRelayAgent } from '@/lib/es-tray-relay/auth'
import { parseResultInput } from '@/lib/es-tray-relay/contract'
import { relayError, relayJson, withRelayApiError } from '@/lib/es-tray-relay/http'
import { completeRelayPrintJob } from '@/lib/es-tray-relay/service'

export const runtime = 'nodejs'

const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  return withRelayApiError(async () => {
    const auth = await authenticateRelayAgent(req)
    if (!auth.ok) return relayError(auth.error, auth.status)
    const { jobId } = await params
    if (!JOB_ID_PATTERN.test(jobId)) return relayError('ES_TRAY_02_INVALID_JOB_ID', 400)
    const terminal = parseResultInput(await req.json(), auth.context.schemaVersion)
    const { binding, tenantId, storeId } = auth.context
    const result = await completeRelayPrintJob({
      tenantId,
      storeId,
      computerBindingId: binding.id,
      schemaVersion: auth.context.schemaVersion,
    }, jobId, terminal)
    return relayJson({ productionContract: true, ...result })
  })
}
