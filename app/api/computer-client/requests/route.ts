import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { apiError, noStoreJson, withComputerClientApiError } from '@/lib/computer-client/http'
import {
  COMPUTER_REAPPLY_ALLOWED_EVENT,
  COMPUTER_REAPPLY_CONSUMED_EVENT,
  computerReapplyConsumeAuditId,
  persistExpiryIfNeeded,
  serializeManagedComputer,
  serializeOwnerRequest,
} from '@/lib/computer-client/service'

/**
 * OWNER 查看本门店待审批电脑（会话鉴权）。
 *
 * 严格限定 ctx.tenantId + ctx.storeId，不接受客户端传入的 tenant/store 参数，
 * 因此不存在跨商户、跨门店读取的路径。
 */
export async function GET(req: NextRequest) {
  return withComputerClientApiError(async () => {
    const ctx = await getContext(req)
    if (!ctx) return apiError('LOGIN_REQUIRED', 401)
    if (ctx.role !== 'OWNER') return apiError('OWNER_REQUIRED', 403)

    const pending = await prisma.computerBinding.findMany({
      where: { tenantId: ctx.tenantId, storeId: ctx.storeId, status: 'PENDING' },
      orderBy: { requestedAt: 'asc' },
      take: 50,
    })

    // 惰性把超时的 PENDING 落成 EXPIRED，列表只呈现真正待办
    const now = new Date()
    const alive = []
    for (const binding of pending) {
      const settled = await persistExpiryIfNeeded(binding, now)
      if (settled.status === 'PENDING') alive.push(settled)
    }

    const [boundComputers, disabledComputers] = await Promise.all([
      prisma.computerBinding.findMany({
        where: {
          tenantId: ctx.tenantId,
          storeId: ctx.storeId,
          status: 'APPROVED',
          boundAt: { not: null },
          disabledAt: null,
        },
        orderBy: { boundAt: 'desc' },
        take: 100,
      }),
      prisma.computerBinding.findMany({
        where: {
          tenantId: ctx.tenantId,
          storeId: ctx.storeId,
          disabledAt: { not: null },
        },
        include: {
          audits: {
            where: {
              eventType: {
                in: [COMPUTER_REAPPLY_ALLOWED_EVENT, COMPUTER_REAPPLY_CONSUMED_EVENT],
              },
              result: 'SUCCESS',
            },
            select: { id: true, eventType: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 2,
          },
        },
        orderBy: { disabledAt: 'desc' },
        take: 100,
      }),
    ])

    return noStoreJson({
      requests: alive.map(serializeOwnerRequest),
      boundComputers: boundComputers.map(serializeManagedComputer),
      disabledComputers: disabledComputers.map((binding) => {
        const latestPermit = binding.audits.find(
          (audit) => audit.eventType === COMPUTER_REAPPLY_ALLOWED_EVENT,
        )
        const reapplyConsumed = latestPermit
          ? binding.audits.some(
              (audit) =>
                audit.id === computerReapplyConsumeAuditId(binding.id, latestPermit.id),
            )
          : false
        return {
          ...serializeManagedComputer(binding),
          reapplyAllowed: Boolean(latestPermit) && !reapplyConsumed,
          reapplyConsumed,
        }
      }),
    })
  })
}
