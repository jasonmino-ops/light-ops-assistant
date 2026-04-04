/**
 * POST /api/ops/tenants/[tenantId]/tokens
 * Generate a bind token for any tenant (cross-tenant, ops-admin only).
 *
 * Body: { storeId, role: 'OWNER' | 'STAFF', expiresInHours?: number }
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const { tenantId } = await params

  let body: { storeId?: string; role?: string; expiresInHours?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }) }

  const { storeId, role, expiresInHours = 24 } = body
  if (!storeId) return NextResponse.json({ error: 'MISSING_STORE_ID' }, { status: 400 })
  if (!role || !['OWNER', 'STAFF'].includes(role))
    return NextResponse.json({ error: 'INVALID_ROLE' }, { status: 400 })

  // BD can only generate OWNER bind tokens
  const effectiveRole = opsRole === 'BD' ? 'OWNER' : role

  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId, status: 'ACTIVE' },
    select: { id: true, name: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })

  const token = crypto.randomBytes(20).toString('hex')
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)

  await prisma.bindToken.create({
    data: {
      token,
      tenantId,
      storeId,
      role: effectiveRole as 'OWNER' | 'STAFF',
      label: `Ops-${effectiveRole}-${new Date().toISOString().slice(0, 10)}`,
      expiresAt,
      maxUses: 1,
    },
  })

  const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? ''
  const tgLink = botUsername ? `https://t.me/${botUsername}?startapp=bind_${token}` : null

  return NextResponse.json({
    token,
    role: effectiveRole,
    storeName: store.name,
    expiresAt: expiresAt.toISOString(),
    tgLink,
  }, { status: 201 })
}
