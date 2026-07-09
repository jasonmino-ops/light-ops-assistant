/**
 * GET/POST /api/cashier/device-authorization/[requestId]
 *
 * Owner phone confirmation for a desktop POS authorization request.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { signPosDeviceToken } from '@/lib/desktop-pos-auth'

type AuthPayload = {
  storeCode?: string
  storeName?: string
  deviceName?: string
  expiresAt?: string
  token?: string
}

function readPayload(value: unknown): AuthPayload {
  return (typeof value === 'object' && value !== null ? value : {}) as AuthPayload
}

async function findRequest(requestId: string) {
  return prisma.operationLog.findFirst({
    where: {
      requestId,
      actionType: 'POS_DEVICE_AUTH_REQUEST',
      targetType: 'POS_DEVICE',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      tenantId: true,
      storeId: true,
      targetId: true,
      status: true,
      payloadSnapshot: true,
    },
  })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params
  const row = await findRequest(requestId)
  if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  const payload = readPayload(row.payloadSnapshot)
  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt).getTime() : 0
  return NextResponse.json({
    requestId,
    status: !expiresAt || Date.now() > expiresAt ? 'EXPIRED' : row.status === 'SUCCESS' ? 'APPROVED' : 'PENDING',
    storeName: payload.storeName ?? '',
    storeCode: payload.storeCode ?? '',
    deviceName: payload.deviceName ?? '前台收银机',
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) {
    return NextResponse.json({ error: 'LOGIN_REQUIRED', message: '请先用老板账号登录后再授权。' }, { status: 401 })
  }
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'OWNER_REQUIRED', message: '只有老板可以授权这台收银机。' }, { status: 403 })
  }

  const { requestId } = await params
  const row = await findRequest(requestId)
  if (!row || !row.targetId) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (!row.storeId) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  if (row.tenantId !== ctx.tenantId) {
    return NextResponse.json({ error: 'FORBIDDEN', message: '不能授权其他商户的收银机。' }, { status: 403 })
  }

  const payload = readPayload(row.payloadSnapshot)
  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt).getTime() : 0
  if (!expiresAt || Date.now() > expiresAt) {
    return NextResponse.json({ error: 'EXPIRED', message: '授权二维码已过期，请在电脑上刷新后重新扫码。' }, { status: 410 })
  }

  let body: { deviceName?: string }
  try { body = await req.json() } catch { body = {} }
  const deviceName = body.deviceName?.trim() || payload.deviceName || '前台收银机'
  const store = await prisma.store.findFirst({
    where: { id: row.storeId, tenantId: row.tenantId, status: 'ACTIVE' },
    select: { id: true, code: true, tenantId: true, name: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })

  const token = signPosDeviceToken({
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode: store.code,
    deviceId: row.targetId,
    issuedBy: ctx.userId,
  })

  await prisma.operationLog.update({
    where: { id: row.id },
    data: {
      userId: ctx.userId,
      status: 'SUCCESS',
      message: 'Desktop POS device authorized by owner',
      payloadSnapshot: {
        ...payload,
        storeCode: store.code,
        storeName: store.name,
        deviceName,
        token,
        approvedAt: new Date().toISOString(),
      },
    },
  })

  return NextResponse.json({ status: 'APPROVED', storeName: store.name, deviceName })
}
