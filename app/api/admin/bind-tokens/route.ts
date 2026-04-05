/**
 * POST /api/admin/bind-tokens  — OWNER only
 *
 * Creates a one-time (or limited-use) bind token that can be shared with a
 * new staff member. They open /bind?token=<token> inside the Telegram Mini
 * App to register their account.
 *
 * Body: {
 *   storeId:       string   — which store this member belongs to
 *   role:          'OWNER' | 'STAFF'
 *   label?:        string   — human-readable note, e.g. "总店员工邀请"
 *   expiresInHours?: number — default 48
 *   maxUses?:      number   — default 1
 * }
 *
 * Returns: { token, expiresAt, label, role, storeId }
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以创建邀请码' }, { status: 403 })
  }

  let body: {
    storeId?: string
    role?: string
    label?: string
    expiresInHours?: number
    maxUses?: number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { storeId, role, label, expiresInHours = 24, maxUses = 1 } = body

  if (!storeId) {
    return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
  }
  if (!role || !['OWNER', 'STAFF'].includes(role)) {
    return NextResponse.json({ error: 'INVALID_ROLE' }, { status: 400 })
  }

  // Verify store belongs to this tenant
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: ctx.tenantId, status: 'ACTIVE' },
  })
  if (!store) {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  const token = crypto.randomBytes(20).toString('hex') // 40 hex chars
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)

  // Revoke any existing ACTIVE tokens for this store+role so old links are immediately invalid
  await prisma.bindToken.updateMany({
    where: { storeId, tenantId: ctx.tenantId, role: role as 'OWNER' | 'STAFF', status: 'ACTIVE' },
    data: { status: 'REVOKED' },
  })

  const bt = await prisma.bindToken.create({
    data: {
      token,
      tenantId: ctx.tenantId,
      storeId,
      role: role as 'OWNER' | 'STAFF',
      label: label?.trim() || null,
      expiresAt,
      maxUses,
    },
  })

  // Telegram deep link — open Mini App with startapp parameter
  // Format: https://t.me/<bot_username>?startapp=bind_<token>
  // The Mini App receives start_param via initDataUnsafe.start_param,
  // then navigates to /bind?token= (same origin, WebApp context preserved).
  // Strip leading '@' — env vars are sometimes set as "@qingdianboss_bot" which
  // produces https://t.me/@username and triggers "user doesn't seem to exist" in Telegram.
  const botUsername = (process.env.TELEGRAM_BOT_USERNAME ?? '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '')
  const tgLink = botUsername
    ? `https://t.me/${botUsername}?startapp=bind_${bt.token}`
    : null

  return NextResponse.json({
    token: bt.token,
    role: bt.role,
    storeId: bt.storeId,
    storeName: store.name,
    label: bt.label,
    expiresAt: bt.expiresAt.toISOString(),
    maxUses: bt.maxUses,
    tgLink,
  })
}
