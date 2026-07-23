import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'
import { revokeBrowserPosDevice } from '@/lib/browser-pos-device'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'LOGIN_REQUIRED' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'OWNER_REQUIRED' }, { status: 403 })
  const membership = await prisma.userStoreRole.findFirst({
    where: {
      tenantId: ctx.tenantId,
      storeId: ctx.storeId,
      userId: ctx.userId,
      role: 'OWNER',
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
      store: { tenantId: ctx.tenantId, status: 'ACTIVE' },
    },
    select: { id: true },
  })
  if (!membership) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const { id } = await params
  let body: { reason?: unknown } = {}
  try { body = await req.json() } catch {}
  const reason = typeof body.reason === 'string' ? body.reason : null
  const device = await revokeBrowserPosDevice({
    id,
    tenantId: ctx.tenantId,
    storeId: ctx.storeId,
    revokedByUserId: ctx.userId,
    reason,
  })
  if (!device) return NextResponse.json({ error: 'BROWSER_DEVICE_NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ ok: true, deviceId: device.id, status: 'REVOKED' })
}
