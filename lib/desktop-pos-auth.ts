import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'

const TOKEN_VERSION = 'pos-device-v1'
const TOKEN_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000

export const POS_AUTH_ERROR = {
  error: 'POS_DEVICE_UNAUTHORIZED',
  message: '请先登录本店老板或员工账号，或完成 POS 设备授权后再操作。',
}

export type PosDeviceTokenPayload = {
  v: typeof TOKEN_VERSION
  tenantId: string
  storeId: string
  storeCode: string
  deviceId: string
  issuedBy: string
  /** 仅 Agent 一键启动签发；旧 Browser POS token 不含此字段。 */
  computerBindingId?: string
  iat: number
}

export type DesktopPosStoreScope = {
  tenantId: string
  storeId: string
  storeCode: string
}

export type DesktopPosAuthorization = {
  tenantId: string
  storeId: string
  storeCode: string
  operatorUserId: string
  role: 'OWNER' | 'STAFF'
  source: 'ACCOUNT' | 'DEVICE' | 'STORE_CODE'
}

function secret(): string {
  return process.env.AUTH_SECRET ?? 'dev-secret-change-in-production'
}

function signPayload(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function signPosDeviceToken(input: Omit<PosDeviceTokenPayload, 'v' | 'iat'>): string {
  const payload: PosDeviceTokenPayload = {
    v: TOKEN_VERSION,
    ...input,
    iat: Date.now(),
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${signPayload(encoded)}`
}

export function verifyPosDeviceToken(token: string): PosDeviceTokenPayload | null {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const encoded = token.slice(0, dot)
    const sig = token.slice(dot + 1)
    if (signPayload(encoded) !== sig) return null
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as PosDeviceTokenPayload
    if (payload.v !== TOKEN_VERSION) return null
    if (!payload.tenantId || !payload.storeId || !payload.storeCode || !payload.deviceId) return null
    if (
      payload.computerBindingId !== undefined &&
      (typeof payload.computerBindingId !== 'string' || !payload.computerBindingId)
    ) return null
    if (!Number.isFinite(payload.iat) || Date.now() - payload.iat > TOKEN_MAX_AGE_MS) return null
    return payload
  } catch {
    return null
  }
}

export function getPosAuthHeaders(req: NextRequest) {
  return {
    token: req.headers.get('x-pos-device-token')?.trim() ?? '',
    deviceId: req.headers.get('x-pos-device-id')?.trim() ?? '',
  }
}

export function unauthorizedPosResponse() {
  return NextResponse.json(POS_AUTH_ERROR, { status: 403 })
}

export async function verifyPosDeviceRequest(
  req: NextRequest,
  expected: { tenantId: string; storeId: string; storeCode: string },
) {
  const { token, deviceId } = getPosAuthHeaders(req)
  if (!token || !deviceId) return null
  const payload = verifyPosDeviceToken(token)
  if (!payload) return null
  if (
    payload.tenantId !== expected.tenantId ||
    payload.storeId !== expected.storeId ||
    payload.storeCode !== expected.storeCode ||
    payload.deviceId !== deviceId
  ) {
    return null
  }

  // Agent 启动的现有 POS session 必须持续受 Computer Binding 状态约束。
  // 老的 Browser POS token 没有 computerBindingId，行为完全不变。
  if (payload.computerBindingId) {
    const binding = await prisma.computerBinding.findFirst({
      where: {
        id: payload.computerBindingId,
        tenantId: expected.tenantId,
        storeId: expected.storeId,
        status: 'APPROVED',
        boundAt: { not: null },
        disabledAt: null,
        credentialStatus: 'ACTIVE',
        OR: [
          { credentialExpiresAt: null },
          { credentialExpiresAt: { gt: new Date() } },
        ],
      },
      select: { id: true },
    })
    if (!binding) return null
  }
  return payload
}

function hasDesktopPosMarker(req: NextRequest) {
  return req.headers.get('x-lightops-client') === 'desktop-pos'
}

export async function authorizeDesktopPosAccount(
  req: NextRequest,
  expected: DesktopPosStoreScope,
): Promise<DesktopPosAuthorization | null> {
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

export async function authorizeDesktopPosRequest(
  req: NextRequest,
  expected: DesktopPosStoreScope,
  options?: { allowStoreCodeFallback?: boolean },
): Promise<DesktopPosAuthorization | null> {
  const presentedToken = getPosAuthHeaders(req).token
  const presentedPayload = presentedToken ? verifyPosDeviceToken(presentedToken) : null

  // 已绑定电脑的 session 一旦停用必须立即失效，即使同一浏览器碰巧还保留
  // Telegram OWNER/STAFF cookie，也不能用 account fallback 绕过停用状态。
  if (presentedPayload?.computerBindingId) {
    const linkedDeviceAuth = await verifyPosDeviceRequest(req, expected)
    if (!linkedDeviceAuth) return null
    return authorizationForDevice(expected, linkedDeviceAuth)
  }

  const accountAuth = await authorizeDesktopPosAccount(req, expected)
  if (accountAuth) return accountAuth

  const deviceAuth = await verifyPosDeviceRequest(req, expected)
  if (!deviceAuth && (!options?.allowStoreCodeFallback || !hasDesktopPosMarker(req))) return null

  if (deviceAuth) return authorizationForDevice(expected, deviceAuth)

  const ownerRole = await prisma.userStoreRole.findFirst({
    where: {
      tenantId: expected.tenantId,
      storeId: expected.storeId,
      role: 'OWNER',
      status: 'ACTIVE',
    },
    select: { userId: true },
  })
  if (!ownerRole) return null

  return {
    tenantId: expected.tenantId,
    storeId: expected.storeId,
    storeCode: expected.storeCode,
    operatorUserId: ownerRole.userId,
    role: 'OWNER',
    source: 'STORE_CODE',
  }
}

async function authorizationForDevice(
  expected: DesktopPosStoreScope,
  _deviceAuth: PosDeviceTokenPayload,
): Promise<DesktopPosAuthorization | null> {
  const ownerRole = await prisma.userStoreRole.findFirst({
    where: {
      tenantId: expected.tenantId,
      storeId: expected.storeId,
      role: 'OWNER',
      status: 'ACTIVE',
    },
    select: { userId: true },
  })
  if (!ownerRole) return null
  return {
    tenantId: expected.tenantId,
    storeId: expected.storeId,
    storeCode: expected.storeCode,
    operatorUserId: ownerRole.userId,
    role: 'OWNER',
    source: 'DEVICE',
  }
}
