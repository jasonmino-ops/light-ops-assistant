import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { checkOpsAuthContext } from '@/lib/ops-auth'
import { verifySession } from '@/lib/session'
import { apiError, noStoreJson, withComputerClientApiError } from '@/lib/computer-client/http'
import {
  auditRequestFingerprint,
  createComputerBindingAudit,
} from '@/lib/computer-client/audit'
import { serializeManagedComputer } from '@/lib/computer-client/service'

/** OWNER 软停用一台已绑定电脑；保留绑定与审计历史，不提供重新启用。 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ computerId: string }> },
) {
  return withComputerClientApiError(async () => {
    const ctx = await getContext(req)
    if (!ctx) return apiError('LOGIN_REQUIRED', 401)
    if (ctx.role !== 'OWNER') return apiError('OWNER_REQUIRED', 403)

    const { computerId } = await params
    const current = await prisma.computerBinding.findFirst({
      where: { id: computerId, tenantId: ctx.tenantId, storeId: ctx.storeId },
    })
    if (!current) return apiError('COMPUTER_NOT_FOUND', 404)
    if (current.disabledAt) {
      return noStoreJson({ computer: serializeManagedComputer(current), idempotent: true })
    }
    if (current.status !== 'APPROVED' || !current.boundAt) {
      return apiError('COMPUTER_NOT_BOUND', 409)
    }

    const actorUser = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { id: true },
    })
    let actorUserId: string | null = actorUser?.id ?? null
    let operatorRole: string = ctx.role

    if (!actorUserId) {
      const delegateToken = req.cookies.get('delegate-session')?.value ?? ''
      const delegate = verifySession(delegateToken)
      const isMatchingDelegate = Boolean(
        delegate
        && !delegate.opsRole
        && delegate.tenantId === ctx.tenantId
        && delegate.storeId === ctx.storeId
        && delegate.userId === ctx.userId,
      )
      const opsActor = isMatchingDelegate ? await checkOpsAuthContext(req) : false
      if (!opsActor) return apiError('OWNER_REQUIRED', 403)

      // OPS delegate 在门店没有真实 OWNER 时使用虚拟 context actor（如 sys）。
      // 三个目标字段都是 nullable User FK；此时必须写 NULL，并在绑定审计中保留
      // delegate 来源与已验证的 OPS 角色。平台入口审计继续保存真实 OpsAdmin 身份。
      actorUserId = null
      operatorRole = `OPS_DELEGATE_${opsActor.role}`
    }

    const now = new Date()
    const fingerprint = auditRequestFingerprint(req)
    const disabled = await prisma.$transaction(async (tx) => {
      // 与 Launch Ticket 兑换共用同一 binding 行锁，避免停用与兑换交错后留下
      // 未被本次停用查询捕获的 ACTIVE Browser POS Session。
      await tx.$queryRaw`SELECT "id" FROM "ComputerBinding" WHERE "id" = ${current.id} FOR UPDATE`

      const changed = await tx.computerBinding.updateMany({
        where: {
          id: current.id,
          tenantId: ctx.tenantId,
          storeId: ctx.storeId,
          status: 'APPROVED',
          boundAt: { not: null },
          disabledAt: null,
        },
        data: {
          disabledAt: now,
          disabledByUserId: actorUserId,
          credentialStatus: 'VOID',
        },
      })
      if (changed.count !== 1) return null

      // 电脑停用是 Browser Session 生命周期结束事件。
      // 仅在此处解除由该电脑创建的 Session；日常营业请求不再读取 Computer Binding。
      const sessionLinks = await tx.computerBrowserLaunchTicket.findMany({
        where: {
          bindingId: current.id,
          browserPosDeviceId: { not: null },
        },
        select: { browserPosDeviceId: true },
      })
      const sessionIds = [
        ...new Set(
          sessionLinks
            .map((item) => item.browserPosDeviceId)
            .filter((id): id is string => Boolean(id)),
        ),
      ]
      if (sessionIds.length > 0) {
        await tx.browserPosDevice.updateMany({
          where: {
            id: { in: sessionIds },
            tenantId: ctx.tenantId,
            storeId: ctx.storeId,
            status: 'ACTIVE',
          },
          data: {
            status: 'REVOKED',
            activeSlot: null,
            revokedAt: now,
            revokedByUserId: actorUserId,
            revocationReason: 'COMPUTER_BINDING_DISABLED',
          },
        })
      }

      await createComputerBindingAudit(tx, {
        tenantId: ctx.tenantId,
        storeId: ctx.storeId,
        bindingId: current.id,
        actorUserId,
        eventType: 'COMPUTER_BINDING_DISABLED',
        result: 'SUCCESS',
        metadata: {
          status: 'DISABLED',
          previousStatus: 'APPROVED',
          credentialStatus: 'VOID',
          operatorRole,
        },
        ...fingerprint,
      })

      return tx.computerBinding.findUnique({ where: { id: current.id } })
    })

    if (!disabled) {
      const latest = await prisma.computerBinding.findFirst({
        where: { id: computerId, tenantId: ctx.tenantId, storeId: ctx.storeId },
      })
      if (latest?.disabledAt) {
        return noStoreJson({ computer: serializeManagedComputer(latest), idempotent: true })
      }
      return apiError('COMPUTER_STATE_CHANGED', 409)
    }

    return noStoreJson({ computer: serializeManagedComputer(disabled) })
  })
}
