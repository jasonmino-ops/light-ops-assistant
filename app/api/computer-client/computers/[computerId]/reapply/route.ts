import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { apiError, noStoreJson, withComputerClientApiError } from '@/lib/computer-client/http'
import { auditRequestFingerprint } from '@/lib/computer-client/audit'
import {
  COMPUTER_REAPPLY_ALLOWED_EVENT,
  computerReapplyAuditId,
  computerReapplyConsumeAuditId,
  serializeManagedComputer,
} from '@/lib/computer-client/service'

/**
 * OWNER 允许一台已停用电脑重新提交绑定申请。
 *
 * 只写一条独立审计许可：不恢复旧状态、不刷新旧凭证，也不创建新绑定。
 * 当前许可未消费时重复点击保持幂等；消费后 OWNER 可明确签发下一枚许可。
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
    const permit = await prisma.$transaction(async (tx) => {
      const latest = await tx.computerBindingAudit.findFirst({
        where: {
          bindingId: binding.id,
          eventType: COMPUTER_REAPPLY_ALLOWED_EVENT,
          result: 'SUCCESS',
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      })
      if (latest) {
        const consumed = await tx.computerBindingAudit.findUnique({
          where: { id: computerReapplyConsumeAuditId(binding.id, latest.id) },
          select: { id: true },
        })
        if (!consumed) return { id: latest.id, created: false }
      }

      const issuedCount = await tx.computerBindingAudit.count({
        where: {
          bindingId: binding.id,
          eventType: COMPUTER_REAPPLY_ALLOWED_EVENT,
          result: 'SUCCESS',
        },
      })
      const permitId = computerReapplyAuditId(binding.id, issuedCount + 1)
      const created = await tx.computerBindingAudit.createMany({
        data: [{
          id: permitId,
          tenantId: binding.tenantId,
          storeId: binding.storeId,
          bindingId: binding.id,
          actorUserId: ctx.userId,
          eventType: COMPUTER_REAPPLY_ALLOWED_EVENT,
          result: 'SUCCESS',
          ipHash: fingerprint.ipHash,
          userAgentHash: fingerprint.userAgentHash,
        }],
        skipDuplicates: true,
      })
      return { id: permitId, created: created.count === 1 }
    })

    return noStoreJson({
      computer: {
        ...serializeManagedComputer(binding),
        reapplyAllowed: true,
        reapplyConsumed: false,
      },
      idempotent: !permit.created,
    })
  })
}
