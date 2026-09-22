import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getDesktopDeviceContext } from '@/lib/desktop-activation/auth'
import { noStoreJson, withDesktopApiError } from '@/lib/desktop-activation/http'
import { deliverV3PrintIntent, reportV3Execution } from '@/lib/v3-print-job-adapter'

export const runtime = 'nodejs'
const db = prisma as any
export async function GET(req: NextRequest) {
  return withDesktopApiError(async () => {
    const auth = await getDesktopDeviceContext(req, { updateLastSeen: true })
    if (!auth.ok) return noStoreJson({ ok: false, error: auth.error }, { status: auth.status })
    const batchId = new URL(req.url).searchParams.get('batchId') ?? ''
    const result = await deliverV3PrintIntent(db, { ...auth.context, batchId })
    return result.ok ? noStoreJson({ ok: true, job: result.job }) : noStoreJson({ ok: false, error: result.code }, { status: 409 })
  })
}
export async function POST(req: NextRequest) {
  return withDesktopApiError(async () => {
    const auth = await getDesktopDeviceContext(req, { updateLastSeen: true })
    if (!auth.ok) return noStoreJson({ ok: false, error: auth.error }, { status: auth.status })
    const body = await req.json().catch(() => null) as any
    if (!body || Object.keys(body).sort().join(',') !== 'action,batchId,executionId,outcome,ownerEpoch,printJobId,reportVersion,role,source' ||
      body.action !== 'REPORT' || typeof body.batchId !== 'string' || typeof body.printJobId !== 'string' ||
      !['LOCAL_DESKTOP', 'CLOUD_H5', 'CLOUD_THIRD_PARTY', 'CLOUD_REMOTE_REPRINT'].includes(body.source) ||
      !['FRONT', 'KITCHEN'].includes(body.role) || typeof body.executionId !== 'string' || !Number.isInteger(body.ownerEpoch) ||
      !Number.isInteger(body.reportVersion) || body.reportVersion < 1 ||
      !['CROSSED', 'FAILED_NOT_CROSSED', 'CROSSING_UNKNOWN'].includes(body.outcome))
      return noStoreJson({ ok: false, error: 'INVALID_REPORT' }, { status: 400 })
    const result = await reportV3Execution(db, { ...auth.context, batchId: body.batchId }, body)
    return result.ok ? noStoreJson({ ok: true, acknowledged: true }) : noStoreJson({ ok: false, error: result.code }, { status: 409 })
  })
}
