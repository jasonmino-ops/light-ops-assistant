/**
 * POST /api/cashier/device-authorization/start
 *
 * Public desktop endpoint. Creates a short-lived authorization request for
 * one POS computer. The owner confirms it from a phone; the computer later
 * checks the same request and stores the returned POS device token locally.
 */
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  POS_DEVICE_AUTH_ACTION,
  POS_DEVICE_AUTH_QR,
  POS_DEVICE_AUTH_TARGET,
  POS_DEVICE_AUTH_TTL_MS,
} from '@/lib/browser-pos-authorization'

function originFrom(req: NextRequest) {
  return req.headers.get('origin') || req.nextUrl.origin
}

export async function POST(req: NextRequest) {
  let body: { storeCode?: string; deviceId?: string; deviceName?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  const storeCode = body.storeCode?.trim()
  const deviceId = body.deviceId?.trim()
  const deviceName = body.deviceName?.trim() || '前台收银机'
  if (!storeCode) return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })
  if (!deviceId) return NextResponse.json({ error: 'MISSING_DEVICE_ID' }, { status: 400 })

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, tenantId: true, code: true, name: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  const requestId = randomUUID()
  const expiresAt = new Date(Date.now() + POS_DEVICE_AUTH_TTL_MS).toISOString()
  await prisma.operationLog.create({
    data: {
      tenantId: store.tenantId,
      storeId: store.id,
      actionType: POS_DEVICE_AUTH_ACTION,
      targetType: POS_DEVICE_AUTH_TARGET,
      targetId: deviceId,
      requestId,
      status: 'FAILED',
      message: 'Desktop POS device authorization request',
      payloadSnapshot: {
        challengeType: POS_DEVICE_AUTH_QR,
        storeCode: store.code,
        storeName: store.name,
        deviceName,
        expiresAt,
      },
    },
  })

  const authorizeUrl = `${originFrom(req)}/cashier/authorize?requestId=${encodeURIComponent(requestId)}`
  return NextResponse.json({
    requestId,
    authorizeUrl,
    expiresAt,
    storeName: store.name,
    deviceName,
  }, { status: 201 })
}
