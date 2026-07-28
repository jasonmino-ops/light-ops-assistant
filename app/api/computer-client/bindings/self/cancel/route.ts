import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, noStoreJson, withComputerClientApiError } from '@/lib/computer-client/http'
import { auditRequestFingerprint, writeComputerBindingAudit } from '@/lib/computer-client/audit'
import {
  authenticateAgent,
  persistExpiryIfNeeded,
  serializeRequestState,
  transitionFromPending,
} from '@/lib/computer-client/service'

/**
 * 取消本机绑定申请（Agent 侧，claim 通道）。
 *
 * 第一阶段只允许 PENDING → CANCELLED，不得扩展为停用 / 恢复 / 解绑。
 * 已批准的绑定无法用 claim 通道撤销。
 */
export async function POST(req: NextRequest) {
  return withComputerClientApiError(async () => {
    const auth = await authenticateAgent(req, 'claim')
    if (!auth.ok) return apiError(auth.error, auth.status)

    const binding = await persistExpiryIfNeeded(auth.binding)
    if (binding.status !== 'PENDING') {
      return apiError('INVALID_STATE', 409, { status: binding.status })
    }

    const { won, binding: cancelled } = await transitionFromPending(
      { id: binding.id },
      { status: 'CANCELLED', credentialStatus: 'VOID', decidedAt: new Date() },
    )
    if (!won || !cancelled) {
      return apiError('INVALID_STATE', 409, { status: cancelled?.status ?? 'UNKNOWN' })
    }

    await writeComputerBindingAudit(prisma, {
      tenantId: cancelled.tenantId,
      storeId: cancelled.storeId,
      bindingId: cancelled.id,
      eventType: 'COMPUTER_BINDING_CANCEL',
      result: 'SUCCESS',
      metadata: { previousStatus: 'PENDING', status: 'CANCELLED' },
      ...auditRequestFingerprint(req),
    })

    return noStoreJson(serializeRequestState(cancelled))
  })
}
