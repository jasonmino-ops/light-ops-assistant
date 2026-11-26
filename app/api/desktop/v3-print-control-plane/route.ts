import { NextRequest } from 'next/server'
import { preparePrintReplacementTarget } from '@/lib/v3-print-replacement-target'
import { prisma } from '@/lib/prisma'
import { getDesktopDeviceContext } from '@/lib/desktop-activation/auth'
import { noStoreJson, withDesktopApiError } from '@/lib/desktop-activation/http'
import {
  acquireV3Authority, issueV3ExecutionBatch, readV3ControlPlane, recoverExpiredSelfV3Authority,
  releaseV3Authority, renewV3Authority,
  type V3ControlPlaneDb,
} from '@/lib/v3-print-control-plane'

export const runtime = 'nodejs'
const db = prisma as unknown as V3ControlPlaneDb

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export async function GET(req: NextRequest) {
  return withDesktopApiError(async () => {
    const auth = await getDesktopDeviceContext(req, { updateLastSeen: true })
    if (!auth.ok) return noStoreJson({ ok: false, error: auth.error }, { status: auth.status })
    return noStoreJson({ ok: true, controlPlane: await readV3ControlPlane(db, auth.context) })
  })
}

export async function POST(req: NextRequest) {
  return withDesktopApiError(async () => {
    const auth = await getDesktopDeviceContext(req, { updateLastSeen: true })
    if (!auth.ok) return noStoreJson({ ok: false, error: auth.error }, { status: auth.status })
    const body = record(await req.json().catch(() => null))
    if (!body || typeof body.action !== 'string') return noStoreJson({ ok: false, error: 'INVALID_REQUEST' }, { status: 400 })
    if (body.action === 'PREPARE_PRINT_REPLACEMENT') {
      if (Object.keys(body).sort().join(',') !== 'action,printStartVersion' || body.printStartVersion !== 1) {
        return noStoreJson({ ok: false, error: 'INVALID_REQUEST' }, { status: 400 })
      }
      const target = await preparePrintReplacementTarget(prisma, auth.context)
      return target ? noStoreJson({ ok: true, target }) : noStoreJson({ ok: false, error: 'REPLACEMENT_NOT_AVAILABLE' }, { status: 409 })
    }
    const base = { ...auth.context, deviceId: auth.context.deviceId }
    let result
    if (body.action === 'ACQUIRE') result = await acquireV3Authority(db, base)
    else {
      if (!Number.isInteger(body.ownerEpoch) || !Number.isInteger(body.stateVersion) || typeof body.leaseId !== 'string') {
        return noStoreJson({ ok: false, error: 'INVALID_FENCE' }, { status: 400 })
      }
      const fenced = { ...base, ownerEpoch: body.ownerEpoch as number, stateVersion: body.stateVersion as number, leaseId: body.leaseId }
      if (body.action === 'RENEW') result = await renewV3Authority(db, fenced)
      else if (body.action === 'RECOVER_EXPIRED_SELF') result = await recoverExpiredSelfV3Authority(db, fenced)
      else if (body.action === 'RELEASE') result = await releaseV3Authority(db, fenced)
      else if (body.action === 'ISSUE_BATCH') result = await issueV3ExecutionBatch(db, fenced, { printStartVersion: body.printStartVersion === 1 ? 1 : undefined })
      else return noStoreJson({ ok: false, error: 'INVALID_ACTION' }, { status: 400 })
    }
    return result.ok ? noStoreJson({ ok: true, ...result.value }) : noStoreJson({ ok: false, error: result.code }, { status: 409 })
  })
}
