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

    // 首次确认必须是原子的：只有 boundAt 仍为 NULL 的那一次能写入。
    // 并发 bind 时其余请求 count === 0，直接幂等返回同一结果，
    // 既不刷新 boundAt，也不会重复写成功审计。
    const firstConfirm = await prisma.computerBinding.updateMany({
      where: { id: binding.id, status: 'APPROVED', boundAt: null },
      data: { boundAt: now, lastSeenAt: now },
    })

    if (firstConfirm.count === 0) {
      // 已经绑定过（或并发中输给了另一个请求）：只更新最后可见时间，不动 boundAt
      await prisma.computerBinding.updateMany({
        where: { id: binding.id, boundAt: { not: null } },
        data: { lastSeenAt: now },
      })
    }

    const bound = await prisma.computerBinding.findUnique({ where: { id: binding.id } })
    if (!bound || !bound.boundAt) return apiError('INVALID_STATE', 409, { status: bound?.status ?? 'UNKNOWN' })

    if (firstConfirm.count === 1) {
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
