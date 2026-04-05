/**
 * POST /api/ops/applications/[id]/approve
 *
 * Approve a PENDING store application:
 *  1. Create Tenant + Store atomically
 *  2. Generate a 72-hour owner BindToken
 *  3. Mark application as APPROVED
 *
 * The applicant scans the returned tgLink → /bind → /home.
 * Ops-admin only.
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await params

  const app = await prisma.storeApplication.findUnique({ where: { id } })
  if (!app) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (app.status !== 'PENDING') {
    return NextResponse.json({ error: 'NOT_PENDING', message: '该申请已处理' }, { status: 409 })
  }

  const storeCode = 'ST' + crypto.randomBytes(4).toString('hex').toUpperCase()
  const token = crypto.randomBytes(20).toString('hex')
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000) // 72h for new-store onboarding

  const { tenant, store } = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: app.storeName } })
    const store = await tx.store.create({
      data: { tenantId: tenant.id, code: storeCode, name: app.storeName },
    })
    await tx.bindToken.create({
      data: {
        token,
        tenantId: tenant.id,
        storeId: store.id,
        role: 'OWNER',
        label: `申请-${app.ownerName}-${new Date().toISOString().slice(0, 10)}`,
        expiresAt,
        maxUses: 1,
      },
    })
    await tx.storeApplication.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        tenantId: tenant.id,
        bindTokenValue: token,
      },
    })
    return { tenant, store }
  })

  const botUsername = (process.env.TELEGRAM_BOT_USERNAME ?? '')
    .replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '')
  const tgLink = botUsername ? `https://t.me/${botUsername}?startapp=bind_${token}` : null

  return NextResponse.json({
    ok: true,
    tenantId: tenant.id,
    storeName: store.name,
    tgLink,
    token,
  }, { status: 201 })
}
