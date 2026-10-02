import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getDesktopDeviceContext } from '@/lib/desktop-activation/auth'
import { noStoreJson, withDesktopApiError } from '@/lib/desktop-activation/http'
import { deliverV3PrintIntent, enqueueHeldV3PrintIntent, materializeHeldV3PrintIntents, parseV3PrintRole, reportV3Execution } from '@/lib/v3-print-job-adapter'
import { issueV3OperatorRecoveryProofWithDb } from '@/lib/v3-print-operator-status'

export const runtime = 'nodejs'
const db = prisma as any
export async function GET(req: NextRequest) {
  return withDesktopApiError(async () => {
    const auth = await getDesktopDeviceContext(req, { updateLastSeen: true })
    if (!auth.ok) return noStoreJson({ ok: false, error: auth.error }, { status: auth.status })
    const searchParams = new URL(req.url).searchParams
    if (searchParams.get('action') === 'OPERATOR_RECOVERY_PROOF') {
      const keys = [...searchParams.keys()].sort().join(',')
      const orderNo = searchParams.get('orderNo') ?? ''
      const originalJobId = searchParams.get('originalJobId') ?? ''
      const role = parseV3PrintRole(searchParams.get('role'))
      const localEvidence = searchParams.get('localEvidence')
      if (
        keys !== 'action,localEvidence,orderNo,originalJobId,role'
        || !/^[A-Za-z0-9._:-]{1,128}$/.test(orderNo)
        || !/^network:[0-9a-f]{64}$/.test(originalJobId)
        || !role
        || localEvidence !== 'LEDGER_ABSENT'
      ) return noStoreJson({ ok: false, error: 'V3_OPERATOR_RECOVERY_PROOF_INVALID' }, { status: 400 })
      const proof = await issueV3OperatorRecoveryProofWithDb(db, {
        tenantId: auth.context.tenantId,
        storeId: auth.context.storeId,
        desktopDeviceId: auth.context.deviceId,
      }, { orderNo, originalJobId, role, localEvidence })
      return proof
        ? noStoreJson({ ok: true, proof })
        : noStoreJson({ ok: false, error: 'V3_OPERATOR_RECOVERY_NOT_PROVABLE' }, { status: 409 })
    }
    const batchId = searchParams.get('batchId') ?? ''
    const role = parseV3PrintRole(searchParams.get('role'))
    if (!batchId || searchParams.getAll('batchId').length !== 1) {
      return noStoreJson({ ok: false, error: 'V3_BATCH_REQUIRED' }, { status: 400 })
    }
    if (!role || searchParams.getAll('role').length !== 1) {
      return noStoreJson({ ok: false, error: 'V3_ROLE_INVALID' }, { status: 400 })
    }
    const result = await deliverV3PrintIntent(db, { ...auth.context, batchId, role })
    return result.ok ? noStoreJson({ ok: true, job: result.job }) : noStoreJson({ ok: false, error: result.code }, { status: 409 })
  })
}
export async function POST(req: NextRequest) {
  return withDesktopApiError(async () => {
    const auth = await getDesktopDeviceContext(req, { updateLastSeen: true })
    if (!auth.ok) return noStoreJson({ ok: false, error: auth.error }, { status: auth.status })
    const body = await req.json().catch(() => null) as any
    if (body?.action === 'HOLD_LOCAL') {
      if (Object.keys(body).sort().join(',') !== 'action,byteLength,expiresAt,orderNo,payloadBase64,payloadHash,printJobId,rendererVersion,role' ||
        typeof body.orderNo !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(body.orderNo) ||
        typeof body.printJobId !== 'string' || body.printJobId.length < 8 || body.printJobId.length > 128 ||
        !['FRONT', 'KITCHEN'].includes(body.role) || typeof body.rendererVersion !== 'string' || !body.rendererVersion ||
        typeof body.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= Date.now() ||
        typeof body.payloadBase64 !== 'string' || !Number.isInteger(body.byteLength) || typeof body.payloadHash !== 'string') {
        return noStoreJson({ ok: false, error: 'INVALID_HELD_INTENT' }, { status: 400 })
      }
      const result = await prisma.$transaction(async (tx) => {
        const controlPlane = await tx.v3PrintControlPlane.findUnique({ where: { storeId: auth.context.storeId } })
        if (!controlPlane || controlPlane.tenantId !== auth.context.tenantId) return { ok: false as const, code: 'CONTROL_PLANE_SCOPE_MISMATCH' }
        const intent = { schemaVersion: 3 as const, printJobId: body.printJobId, source: 'LOCAL_DESKTOP' as const, role: body.role,
          payloadKind: 'RAW_BYTES' as const, orderNo: body.orderNo, rendererVersion: body.rendererVersion,
          payloadBase64: body.payloadBase64, byteLength: body.byteLength, payloadHash: body.payloadHash }
        const held = await enqueueHeldV3PrintIntent(tx as any, auth.context, intent, new Date(body.expiresAt))
        if (controlPlane.mode === 'V2_ACTIVE' || controlPlane.mode === 'V3_ACTIVE') {
          await materializeHeldV3PrintIntents(tx as any, auth.context, controlPlane.mode, new Date())
          return { ok: true as const, status: 'DURABLY_ACCEPTED' as const, created: held.created }
        }
        return { ok: true as const, status: 'DURABLY_HELD' as const, created: held.created }
      })
      return result.ok ? noStoreJson(result) : noStoreJson({ ok: false, error: result.code }, { status: 409 })
    }
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
