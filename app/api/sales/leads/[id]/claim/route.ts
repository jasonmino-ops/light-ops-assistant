import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSalesWorkspaceActor } from '@/lib/sales-workspace-auth'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getSalesWorkspaceActor(req)
  if (!actor || actor.userId === '_ops_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  const admin = await prisma.opsAdmin.findUnique({
    where: { id: actor.userId },
    select: { id: true, name: true, status: true, role: true },
  })
  if (!admin || admin.status !== 'ACTIVE' || admin.role !== actor.role) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const { id } = await params
  const claimed = await prisma.salesLead.updateMany({
    where: { id, salesOwnerId: null },
    data: { salesOwnerId: admin.id, lastActivityAt: new Date() },
  })
  if (claimed.count === 1) {
    return NextResponse.json({ ok: true, salesOwner: { id: admin.id, name: admin.name } })
  }
  const current = await prisma.salesLead.findUnique({
    where: { id },
    select: { salesOwnerId: true },
  })
  if (!current) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (current.salesOwnerId === admin.id) return NextResponse.json({ ok: true, alreadyOwned: true })
  return NextResponse.json({ error: 'ALREADY_CLAIMED' }, { status: 409 })
}
