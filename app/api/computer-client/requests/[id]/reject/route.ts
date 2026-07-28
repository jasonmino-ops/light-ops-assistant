import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { apiError, noStoreJson, withComputerClientApiError } from '@/lib/computer-client/http'
import { auditRequestFingerprint, writeComputerBindingAudit } from '@/lib/computer-client/audit'
import {
  persistExpiryIfNeeded,
  serializeOwnerRequest,
  transitionFromPending,
} from '@/lib/computer-client/service'

/**
 * OWNER 拒绝绑定申请（会话鉴权）。
 * 拒绝后设备凭证置 VOID，永远不会变成可用凭证。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withComputerClientApiError(async () => {
    const ctx = await getContext(req)
    if (!ctx) return apiError('LOGIN_REQUIRED', 401)
    if (ctx.role !== 'OWNER') return apiError('OWNER_REQUIRED', 403)

    const { id } = await params

    const binding = await prisma.computerBinding.findFirst({
      where: { id, tenantId: ctx.tenantId, storeId: ctx.storeId },
    })
    if (!binding) return apiError('REQUEST_NOT_FOUND', 404)

    const settled = await persistExpiryIfNeeded(binding)
    if (settled.status !== 'PENDING') {
      return apiError('INVALID_STATE', 409, { status: settled.status })
    }

    const { won, binding: rejected } = await transitionFromPending(
      { id: settled.id, tenantId: ctx.tenantId, storeId: ctx.storeId },
      {
        status: 'REJECTED',
        decidedByUserId: ctx.userId,
        decidedAt: new Date(),
        credentialStatus: 'VOID',
      },
    )
    if (!won || !rejected) {
      return apiError('INVALID_STATE', 409, { status: rejected?.status ?? 'UNKNOWN' })
    }

    await writeComputerBindingAudit(prisma, {
      tenantId: rejected.tenantId,
      storeId: rejected.storeId,
      bindingId: rejected.id,
      actorUserId: ctx.userId,
      eventType: 'COMPUTER_BINDING_REJECT',
      result: 'SUCCESS',
      metadata: {
        previousStatus: 'PENDING',
        status: 'REJECTED',
        credentialStatus: 'VOID',
        operatorRole: ctx.role,
      },
      ...auditRequestFingerprint(req),
    })

    return noStoreJson({ request: serializeOwnerRequest(rejected) })
  })
}
