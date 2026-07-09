import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

const TOKEN_VERSION = 'pos-device-v1'
const TOKEN_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000

export const POS_AUTH_ERROR = {
  error: 'POS_DEVICE_UNAUTHORIZED',
  message: 'This POS computer is not authorized yet. Please ask the owner or an active staff member to bind this device first.',
}

export type PosDeviceTokenPayload = {
  v: typeof TOKEN_VERSION
  tenantId: string
  storeId: string
  storeCode: string
  deviceId: string
  issuedBy: string
  iat: number
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

export function verifyPosDeviceRequest(
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
  return payload
}
