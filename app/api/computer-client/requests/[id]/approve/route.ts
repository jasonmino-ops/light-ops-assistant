import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { getDeviceCredentialExpiresAt } from '@/lib/computer-client/crypto'
import { apiError, noStoreJson, withComputerClientApiError } from '@/lib/computer-client/http'
import { auditRequestFingerprint, writeComputerBindingAudit } from '@/lib/computer-client/audit'
import {
  persistExpiryIfNeeded,
  serializeOwnerRequest,
  transitionFromPending,
} from '@/lib/computer-client/service'

/**
 * OWNER 批准绑定申请（会话鉴权）。
 *
 * 批准只做两件事：把申请置 APPROVED、把设备凭证置 ACTIVE。
 * **不生成、不下发任何凭证明文** —— deviceSecret 一直在 Agent 本机，
 * 云端只有它的哈希，因此不存在凭证下发丢失或重复签发的问题。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withComputerClientApiError(async () => {
    const ctx = await getContext(req)
    if (!ctx) return apiError('LOGIN_REQUIRED', 401)
    if (ctx.role !== 'OWNER') return apiError('OWNER_REQUIRED', 403)

    const { id } = await params

    // 同时按 id + tenantId + storeId 定位：跨商户/跨门店一律 404，不泄露存在性
    const binding = await prisma.computerBinding.findFirst({
      where: { id, tenantId: ctx.tenantId, storeId: ctx.storeId },
    })
    if (!binding) return apiError('REQUEST_NOT_FOUND', 404)

    const settled = await persistExpiryIfNeeded(binding)
    if (settled.status !== 'PENDING') {
      await writeComputerBindingAudit(prisma, {
        tenantId: settled.tenantId,
        storeId: settled.storeId,
        bindingId: settled.id,
        actorUserId: ctx.userId,
        eventType: 'COMPUTER_BINDING_APPROVE',
        result: 'FAILED',
        reasonCode: 'INVALID_STATE',
        metadata: { status: settled.status, operatorRole: ctx.role },
        ...auditRequestFingerprint(req),
      })
      return apiError('INVALID_STATE', 409, { status: settled.status })
    }

    const now = new Date()
    // 原子转移：并发的 approve / reject / cancel / expire 中只有一个能成功
    const { won, binding: approved } = await transitionFromPending(
      { id: settled.id, tenantId: ctx.tenantId, storeId: ctx.storeId },
      {
        status: 'APPROVED',
        decidedByUserId: ctx.userId,
        decidedAt: now,
        credentialStatus: 'ACTIVE',
        credentialActivatedAt: now,
        credentialExpiresAt: getDeviceCredentialExpiresAt(now),
      },
    )
    if (!won || !approved) {
      // 输掉竞态：不写成功审计、不刷新任何时间字段
      return apiError('INVALID_STATE', 409, { status: approved?.status ?? 'UNKNOWN' })
    }

    await writeComputerBindingAudit(prisma, {
      tenantId: approved.tenantId,
      storeId: approved.storeId,
      bindingId: approved.id,
      actorUserId: ctx.userId,
      eventType: 'COMPUTER_BINDING_APPROVE',
      result: 'SUCCESS',
      metadata: {
        previousStatus: 'PENDING',
        status: 'APPROVED',
        credentialStatus: 'ACTIVE',
        operatorRole: ctx.role,
      },
      ...auditRequestFingerprint(req),
    })

    return noStoreJson({ request: serializeOwnerRequest(approved) })
  })
}
