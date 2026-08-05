import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, noStoreJson, withComputerClientApiError } from '@/lib/computer-client/http'
import { auditRequestFingerprint, writeComputerBindingAudit } from '@/lib/computer-client/audit'
import {
  createBrowserLaunchTicket,
  getBrowserLaunchTicketExpiresAt,
  hashBrowserLaunchTicket,
} from '@/lib/computer-client/crypto'
import { authenticateAgent } from '@/lib/computer-client/service'

/** 已绑定 Agent 用 device 通道申请一次性 Browser POS 启动票据。 */
export async function POST(req: NextRequest) {
  return withComputerClientApiError(async () => {
    const auth = await authenticateAgent(req, 'device')
    if (!auth.ok) return apiError(auth.error, auth.status)

    const binding = auth.binding
    if (binding.status !== 'APPROVED' || !binding.boundAt) {
      return apiError('COMPUTER_NOT_BOUND', 409)
    }

    const store = await prisma.store.findFirst({
      where: { id: binding.storeId, tenantId: binding.tenantId, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!store) return apiError('STORE_NOT_AVAILABLE', 409)

    let body: Record<string, unknown> = {}
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      // 兼容已部署的 0.4.4：无 body 仍可申请票据。
    }
    const agentVersion =
      typeof body.agentVersion === 'string'
        ? body.agentVersion.trim().slice(0, 32)
        : ''

    const ticket = createBrowserLaunchTicket()
    const expiresAt = getBrowserLaunchTicketExpiresAt()
    await prisma.$transaction(async (tx) => {
      if (agentVersion && agentVersion !== binding.agentVersion) {
        await tx.computerBinding.update({
          where: { id: binding.id },
          data: { agentVersion },
        })
      }
      await tx.computerBrowserLaunchTicket.create({
        data: {
          bindingId: binding.id,
          ticketHash: hashBrowserLaunchTicket(ticket),
          expiresAt,
        },
      })
    })

    await writeComputerBindingAudit(prisma, {
      tenantId: binding.tenantId,
      storeId: binding.storeId,
      bindingId: binding.id,
      eventType: 'COMPUTER_BROWSER_LAUNCH_TICKET_ISSUED',
      result: 'SUCCESS',
      metadata: {
        expiresAt: expiresAt.toISOString(),
        agentVersion: agentVersion || binding.agentVersion || undefined,
      },
      ...auditRequestFingerprint(req),
    })

    return noStoreJson({ ticket, expiresAt: expiresAt.toISOString() })
  })
}
