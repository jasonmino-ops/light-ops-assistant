/**
 * Compatibility exports for legacy Browser POS token callers.
 * Transaction routes must use transaction-authorization.ts; this module has no
 * storeCode/Header fallback and never synthesizes an OWNER principal.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'

export {
  getPosAuthHeaders,
  hashPosDeviceToken,
  signPosDeviceToken,
  verifyPosDeviceToken,
  type PosDeviceTokenPayload,
} from '@/lib/browser-pos-device'

export const POS_AUTH_ERROR = {
  error: 'TRANSACTION_AUTH_REQUIRED',
  message: '请先登录本店老板或员工账号，或完成 POS 设备授权后再操作。',
}

export type DesktopPosStoreScope = {
  tenantId: string
  storeId: string
  storeCode: string
}

export type DesktopPosAccountAuthorization = {
  tenantId: string
  storeId: string
  storeCode: string
  operatorUserId: string
  role: 'OWNER' | 'STAFF'
  source: 'ACCOUNT'
}

export function unauthorizedPosResponse() {
  return NextResponse.json(POS_AUTH_ERROR, { status: 403 })
}

/** Account-only access check used by the non-transaction cashier entry probe. */
export async function authorizeDesktopPosAccount(
  req: NextRequest,
  expected: DesktopPosStoreScope,
): Promise<DesktopPosAccountAuthorization | null> {
  const ctx = await getContext(req)
  if (!ctx || ctx.tenantId !== expected.tenantId) return null

  if (ctx.role === 'OWNER') {
    return {
      tenantId: expected.tenantId,
      storeId: expected.storeId,
      storeCode: expected.storeCode,
      operatorUserId: ctx.userId,
      role: 'OWNER',
      source: 'ACCOUNT',
    }
  }

  if (ctx.role === 'STAFF' && ctx.storeId === expected.storeId) {
    const activeRole = await prisma.userStoreRole.findFirst({
      where: {
        tenantId: expected.tenantId,
        storeId: expected.storeId,
        userId: ctx.userId,
        status: 'ACTIVE',
      },
      select: { role: true },
    })
    if (!activeRole) return null
    return {
      tenantId: expected.tenantId,
      storeId: expected.storeId,
      storeCode: expected.storeCode,
      operatorUserId: ctx.userId,
      role: activeRole.role,
      source: 'ACCOUNT',
    }
  }
  return null
}
