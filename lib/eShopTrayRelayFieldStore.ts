import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import {
  parseEshopTray02PrintRequest,
  type EshopTray02PrintRequest,
} from './eShopTrayRelayContract'

/**
 * FIELD ONLY temporary relay persistence.
 *
 * OperationLog is used only as a disposable FIELD mailbox so V0.1 can be
 * verified without a schema change. It is explicitly NOT the Transport
 * Contract and must not become a production relay dependency.
 */
export const ES_TRAY_02_FIELD_PENDING = 'ES_TRAY_02_FIELD_PENDING' as const
export const ES_TRAY_02_FIELD_RECEIVED = 'ES_TRAY_02_FIELD_RECEIVED' as const
const FIELD_RELAY_TARGET = 'ES_TRAY_02_FIELD_RELAY' as const

type FieldRelayScope = {
  tenantId: string
  storeId: string
}

export async function enqueueEshopTray02FieldPrint(
  scope: FieldRelayScope & { userId: string },
  request: EshopTray02PrintRequest,
): Promise<{ id: string }> {
  return prisma.operationLog.create({
    data: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      userId: scope.userId,
      actionType: ES_TRAY_02_FIELD_PENDING,
      targetType: FIELD_RELAY_TARGET,
      targetId: request.orderNo,
      requestId: request.requestId,
      status: 'SUCCESS',
      message: 'FIELD ONLY · pending receive · NOT PRODUCTION CONTRACT',
      payloadSnapshot: {
        fieldOnly: true,
        notProductionContract: true,
        request,
      } satisfies Prisma.InputJsonValue,
    },
    select: { id: true },
  })
}

function storedRequest(value: Prisma.JsonValue | null): EshopTray02PrintRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const request = (value as Record<string, Prisma.JsonValue>).request
  try {
    return parseEshopTray02PrintRequest(request)
  } catch {
    return null
  }
}

export async function receiveNextEshopTray02FieldPrint(
  scope: FieldRelayScope,
): Promise<{ id: string; request: EshopTray02PrintRequest } | null> {
  // A single FIELD Tray is expected. updateMany makes concurrent polls consume
  // at most one copy without introducing leases, retries, or a queue framework.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidate = await prisma.operationLog.findFirst({
      where: {
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        actionType: ES_TRAY_02_FIELD_PENDING,
        targetType: FIELD_RELAY_TARGET,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, payloadSnapshot: true },
    })
    if (!candidate) return null
    const request = storedRequest(candidate.payloadSnapshot)
    if (!request) {
      await prisma.operationLog.updateMany({
        where: { id: candidate.id, actionType: ES_TRAY_02_FIELD_PENDING },
        data: {
          actionType: ES_TRAY_02_FIELD_RECEIVED,
          status: 'FAILED',
          message: 'FIELD ONLY · invalid stored payload · NOT PRODUCTION CONTRACT',
          payloadSnapshot: {
            fieldOnly: true,
            notProductionContract: true,
            invalidStoredPayload: true,
          },
        },
      })
      continue
    }
    const consumed = await prisma.operationLog.updateMany({
      where: { id: candidate.id, actionType: ES_TRAY_02_FIELD_PENDING },
      data: {
        actionType: ES_TRAY_02_FIELD_RECEIVED,
        message: 'FIELD ONLY · received once · NOT PRODUCTION CONTRACT',
        payloadSnapshot: {
          fieldOnly: true,
          notProductionContract: true,
          relayVersion: request.relayVersion,
          requestId: request.requestId,
          orderNo: request.orderNo,
          commandByteLength: request.commandStream.byteLength,
          commandSha256: request.commandStream.sha256,
          receivedAt: new Date().toISOString(),
        },
      },
    })
    if (consumed.count === 1) return { id: candidate.id, request }
  }
  return null
}
