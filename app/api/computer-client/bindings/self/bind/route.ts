import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, noStoreJson, withComputerClientApiError } from '@/lib/computer-client/http'
import { auditRequestFingerprint, writeComputerBindingAudit } from '@/lib/computer-client/audit'
import { authenticateAgent, serializeBoundResult } from '@/lib/computer-client/service'

/**
 * 确认绑定（Agent 侧，device 通道）。
 *
 * Agent 用本机一直持有的 deviceSecret 调用；云端校验哈希 + 凭证 ACTIVE + 安装实例一致后
 * 写入 boundAt，绑定完成。凭证从不由云端下发，因此本接口天然幂等、可无限重试：
 * 响应丢失、进程崩溃、断网都只需再调一次，不存在凭证作废或并发签发问题。
 *
 * 绑定完成后重复调用等价于「读取本机绑定态」，返回同一份最小结果。
 */
export async function POST(req: NextRequest) {
  return withComputerClientApiError(async () => {
    const auth = await authenticateAgent(req, 'device')
    if (!auth.ok) return apiError(auth.error, auth.status)

    const binding = auth.binding
    if (binding.status !== 'APPROVED') {
      return apiError('INVALID_STATE', 409, { status: binding.status })
    }

    const store = await prisma.store.findFirst({
      where: { id: binding.storeId, tenantId: binding.tenantId },
      select: { code: true, name: true, status: true },
    })
    if (!store || store.status !== 'ACTIVE') return apiError('STORE_NOT_AVAILABLE', 409)

    const now = new Date()
    const alreadyBound = Boolean(binding.boundAt)

    const bound = await prisma.computerBinding.update({
      where: { id: binding.id },
      data: {
        boundAt: binding.boundAt ?? now,
        lastSeenAt: now,
      },
    })

    if (!alreadyBound) {
      await writeComputerBindingAudit(prisma, {
        tenantId: bound.tenantId,
        storeId: bound.storeId,
        bindingId: bound.id,
        eventType: 'COMPUTER_BINDING_CONFIRMED',
        result: 'SUCCESS',
        metadata: { status: 'APPROVED', credentialStatus: 'ACTIVE' },
        ...auditRequestFingerprint(req),
      })
    }

    return noStoreJson(serializeBoundResult(bound, store))
  })
}
