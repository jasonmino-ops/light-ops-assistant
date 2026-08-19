import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { blockStoreApplications, cleanApplicationBlockText } from '@/lib/application-block'
import { getFkBackedOpsAdminIdentity } from '@/lib/ops-auth'
import { getSalesLeadTelegramAdvisoryKey } from '@/lib/sales-lead-advisory'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getFkBackedOpsAdminIdentity(req, 'OPS_ADMIN')
  if (!actor) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const action = body?.action
  if (action !== 'BAN' && action !== 'UNBAN') {
    return NextResponse.json({ error: 'INVALID_ACTION' }, { status: 400 })
  }
  const { id } = await params
  const lead = await prisma.salesLead.findUnique({
    where: { id },
    select: { telegramId: true, telegramUsername: true },
  })
  if (!lead) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (!lead.telegramId) return NextResponse.json({ error: 'TELEGRAM_NOT_BOUND' }, { status: 409 })

  const reason = cleanApplicationBlockText(body?.reason, 160)
  const note = cleanApplicationBlockText(body?.note, 1000)
  if (action === 'BAN' && !reason) {
    return NextResponse.json({ error: 'REASON_REQUIRED' }, { status: 400 })
  }
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${getSalesLeadTelegramAdvisoryKey(lead.telegramId!)}) IS NULL AS "ignored"`
    if (action === 'BAN') {
      await blockStoreApplications({
        tx,
        telegramId: lead.telegramId!,
        telegramUsername: lead.telegramUsername,
        reason: reason!,
        note,
        opsAdminId: actor.id,
        now,
      })
    } else {
      await tx.applicationBlock.updateMany({
        where: { telegramId: lead.telegramId!, unblockedAt: null },
        data: { unblockedByOpsAdminId: actor.id, unblockedAt: now },
      })
    }
  })
  return NextResponse.json({ ok: true, state: action === 'BAN' ? 'BLOCKED' : 'UNBLOCKED' })
}
