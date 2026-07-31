import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { apiError, noStoreJson, withComputerClientApiError } from '@/lib/computer-client/http'
import { auditRequestFingerprint } from '@/lib/computer-client/audit'
import {
  COMPUTER_REAPPLY_ALLOWED_EVENT,
  computerReapplyAuditId,
  serializeManagedComputer,
} from '@/lib/computer-client/service'

/**
 * OWNER 允许一台已停用电脑重新提交绑定申请。
 *
 * 这里只写一条幂等审计许可：不恢复旧状态、不刷新旧凭证，也不创建新绑定。
 * 新 ComputerBinding 仍由 Agent 生成全新 installationId 后走既有 submit 流程创建。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ computerId: string }> },
) {
  return withComputerClientApiError(async () => {
    const ctx = await getContext(req)
    if (!ctx) return apiError('LOGIN_REQUIRED', 401)
    if (ctx.role !== 'OWNER') return apiError('OWNER_REQUIRED', 403)

    const { computerId } = await params
    const binding = await prisma.computerBinding.findFirst({
      where: {
        id: computerId,
        tenantId: ctx.tenantId,
        storeId: ctx.storeId,
        disabledAt: { not: null },
      },
    })
    if (!binding) return apiError('DISABLED_COMPUTER_NOT_FOUND', 404)

    const fingerprint = auditRequestFingerprint(req)
    await prisma.computerBindingAudit.upsert({
      where: { id: computerReapplyAuditId(binding.id) },
      update: {},
      create: {
        id: computerReapplyAuditId(binding.id),
        tenantId: binding.tenantId,
        storeId: binding.storeId,
        bindingId: binding.id,
        actorUserId: ctx.userId,
        eventType: COMPUTER_REAPPLY_ALLOWED_EVENT,
        result: 'SUCCESS',
        ipHash: fingerprint.ipHash,
        userAgentHash: fingerprint.userAgentHash,
      },
    })

    return noStoreJson({
      computer: { ...serializeManagedComputer(binding), reapplyAllowed: true },
    })
  })
}
