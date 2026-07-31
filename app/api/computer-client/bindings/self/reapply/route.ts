import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, noStoreJson, withComputerClientApiError } from '@/lib/computer-client/http'
import { auditRequestFingerprint } from '@/lib/computer-client/audit'
import {
  authenticateAgent,
  COMPUTER_REAPPLY_ALLOWED_EVENT,
  COMPUTER_REAPPLY_CONSUMED_EVENT,
  computerReapplyAuditId,
  computerReapplyConsumeAuditId,
} from '@/lib/computer-client/service'

/**
 * 已停用 Agent 手工点击“重新绑定”时消费 OWNER 创建的一次性许可。
 * 许可与旧 bindingId 一一对应；唯一消费审计保证并发请求只有一个成功。
 */
export async function POST(req: NextRequest) {
  return withComputerClientApiError(async () => {
    const auth = await authenticateAgent(req, 'claim')
    if (!auth.ok) return apiError(auth.error, auth.status)

    const binding = auth.binding
    if (!binding.disabledAt) return apiError('COMPUTER_NOT_DISABLED', 409)

    const fingerprint = auditRequestFingerprint(req)
    const outcome = await prisma.$transaction(async (tx) => {
      const allowed = await tx.computerBindingAudit.findUnique({
        where: { id: computerReapplyAuditId(binding.id) },
        select: { id: true },
      })
      if (!allowed) return 'NOT_ALLOWED' as const

      const consumed = await tx.computerBindingAudit.createMany({
        data: [{
          id: computerReapplyConsumeAuditId(binding.id),
          tenantId: binding.tenantId,
          storeId: binding.storeId,
          bindingId: binding.id,
          eventType: COMPUTER_REAPPLY_CONSUMED_EVENT,
          result: 'SUCCESS',
          ipHash: fingerprint.ipHash,
          userAgentHash: fingerprint.userAgentHash,
        }],
        skipDuplicates: true,
      })
      return consumed.count === 1 ? 'CONSUMED' as const : 'ALREADY_CONSUMED' as const
    })

    if (outcome === 'NOT_ALLOWED') return apiError('REAPPLY_NOT_ALLOWED', 403)
    if (outcome === 'ALREADY_CONSUMED') {
      return apiError('REAPPLY_PERMISSION_ALREADY_CONSUMED', 409)
    }
    return noStoreJson({ consumed: true })
  })
}
