import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { blockStoreApplications, cleanApplicationBlockText } from '@/lib/application-block'
import { checkOpsAuthContext, getFkBackedOpsAdminIdentity } from '@/lib/ops-auth'
import { getSalesLeadTelegramAdvisoryKey } from '@/lib/sales-lead-advisory'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ops = await checkOpsAuthContext(req)
  if (!ops) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const ban = body?.ban === true
  const reason = cleanApplicationBlockText(body?.reason, 160)
  const note = cleanApplicationBlockText(body?.note, 1000)
  if (!reason) return NextResponse.json({ error: 'REASON_REQUIRED' }, { status: 400 })
  const rejectionNote = note ? `${reason}\n${note}` : reason
  const banActor = ban ? await getFkBackedOpsAdminIdentity(req, 'OPS_ADMIN') : null
  if (ban && !banActor) return NextResponse.json({ error: 'BAN_FORBIDDEN' }, { status: 403 })

  const { id } = await params
  const application = await prisma.storeApplication.findUnique({
    where: { id },
    select: { telegramId: true, telegramUsername: true },
  })
  if (!application) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${getSalesLeadTelegramAdvisoryKey(application.telegramId)})`
    const current = await tx.storeApplication.findUnique({
      where: { id },
      select: { status: true },
    })
    if (!current) return 'NOT_FOUND' as const
    if (current.status === 'APPROVED') return 'ALREADY_APPROVED' as const
    if (current.status === 'PENDING') {
      const claimed = await tx.storeApplication.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'REJECTED', note: rejectionNote },
      })
      if (claimed.count !== 1) return 'RACE_LOST' as const
    }
    if (ban && banActor) {
      await blockStoreApplications({
        tx,
        telegramId: application.telegramId,
        telegramUsername: application.telegramUsername,
        reason,
        note,
        opsAdminId: banActor.id,
      })
    }
    return 'REJECTED' as const
  })
  if (result === 'NOT_FOUND') return NextResponse.json({ error: result }, { status: 404 })
  if (result === 'ALREADY_APPROVED' || result === 'RACE_LOST') {
    return NextResponse.json({ error: 'NOT_PENDING' }, { status: 409 })
  }
  return NextResponse.json({ ok: true, state: result, blocked: ban })
}
