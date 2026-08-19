import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuthContext, hasOpsRole } from '@/lib/ops-auth'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ops = await checkOpsAuthContext(req)
  if (!ops || !hasOpsRole(ops.role, 'OPS_ADMIN')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  const body = await req.json().catch(() => null) as { status?: unknown } | null
  if (body?.status !== 'ACTIVE' && body?.status !== 'INACTIVE') {
    return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 })
  }
  const { id } = await params
  const result = await prisma.acquisitionInvite.updateMany({
    where: { id },
    data: { status: body.status },
  })
  if (result.count !== 1) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ ok: true, status: body.status })
}
