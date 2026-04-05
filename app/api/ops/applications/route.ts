/**
 * GET /api/ops/applications?status=PENDING
 * List store-opening applications. Ops-admin only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'

export async function GET(req: NextRequest) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const status = req.nextUrl.searchParams.get('status') ?? 'PENDING'
  const validStatuses = ['PENDING', 'APPROVED', 'REJECTED']

  const applications = await prisma.storeApplication.findMany({
    where: validStatuses.includes(status) ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json(applications)
}
