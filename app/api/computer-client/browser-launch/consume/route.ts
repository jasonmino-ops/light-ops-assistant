import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { apiError, noStoreJson, withComputerClientApiError } from '@/lib/computer-client/http'
import { auditRequestFingerprint, createComputerBindingAudit } from '@/lib/computer-client/audit'
import {
  hashBrowserDeviceId,
  hashBrowserLaunchTicket,
  isValidBrowserDeviceId,
  isValidBrowserLaunchTicketFormat,
} from '@/lib/computer-client/crypto'
import { issuePosDeviceSession } from '@/lib/desktop-pos-auth'

/** 浏览器把 fragment 中的一次性票据兑换为现有 Browser POS device session。 */
export async function POST(req: NextRequest) {
  return withComputerClientApiError(async () => {
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return apiError('INVALID_BODY', 400)
    }

    const ticket = typeof body.ticket === 'string' ? body.ticket.trim() : ''
    const browserDeviceId =
      typeof body.browserDeviceId === 'string' ? body.browserDeviceId.trim() : ''
    if (!isValidBrowserLaunchTicketFormat(ticket)) return apiError('LAUNCH_TICKET_INVALID', 400)
    if (!isValidBrowserDeviceId(browserDeviceId)) return apiError('BROWSER_DEVICE_ID_INVALID', 400)

    const now = new Date()
    const ticketHash = hashBrowserLaunchTicket(ticket)
    const browserDeviceIdHash = hashBrowserDeviceId(browserDeviceId)
    const fingerprint = auditRequestFingerprint(req)

    const consumed = await prisma.$transaction(
      async (tx) => {
        const row = await tx.computerBrowserLaunchTicket.findUnique({
          where: { ticketHash },
          include: { binding: { include: { store: true } } },
        })
        if (!row || row.usedAt || row.expiresAt.getTime() <= now.getTime()) return null

        const binding = row.binding
        if (
          binding.status !== 'APPROVED' ||
          !binding.boundAt ||
          binding.disabledAt ||
          binding.credentialStatus !== 'ACTIVE' ||
          (binding.credentialExpiresAt &&
            binding.credentialExpiresAt.getTime() <= now.getTime()) ||
          binding.store.status !== 'ACTIVE'
        ) {
          return null
        }

        const changed = await tx.computerBrowserLaunchTicket.updateMany({
          where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now, browserDeviceIdHash },
        })
        if (changed.count !== 1) return null

        const browserSession = await issuePosDeviceSession(tx, {
          tenantId: binding.tenantId,
          storeId: binding.storeId,
          storeCode: binding.store.code,
          browserDeviceId,
          issuedBy: binding.decidedByUserId ?? 'computer-binding',
          issuedByUserId: binding.decidedByUserId,
          displayName: binding.computerName,
        })
        await tx.computerBrowserLaunchTicket.update({
          where: { id: row.id },
          data: { browserPosDeviceId: browserSession.sessionId },
        })

        await createComputerBindingAudit(tx, {
          tenantId: binding.tenantId,
          storeId: binding.storeId,
          bindingId: binding.id,
          eventType: 'COMPUTER_BROWSER_LAUNCH_TICKET_CONSUMED',
          result: 'SUCCESS',
          metadata: { status: 'APPROVED' },
          ...fingerprint,
        })

        return {
          bindingId: binding.id,
          tenantId: binding.tenantId,
          storeId: binding.storeId,
          storeCode: binding.store.code,
          posDeviceToken: browserSession.token,
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )

    if (!consumed) return apiError('LAUNCH_TICKET_INVALID_OR_EXPIRED', 409)

    return noStoreJson({
      storeCode: consumed.storeCode,
      posDeviceToken: consumed.posDeviceToken,
    })
  })
}
