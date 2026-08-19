import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { normalizeAcquisitionInviteCode } from '@/lib/sales-lead-invite'
import { getPlatformSupportConfig } from '@/lib/sales-lead-support'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params
  const code = normalizeAcquisitionInviteCode(rawCode)
  const support = await getPlatformSupportConfig()
  if (!code) {
    return NextResponse.json({ error: 'INVITE_NOT_FOUND', support }, { status: 404 })
  }

  const invite = await prisma.acquisitionInvite.findUnique({
    where: { code },
    select: { id: true, status: true, campaignLabel: true },
  })
  if (!invite) {
    return NextResponse.json({ error: 'INVITE_NOT_FOUND', support }, { status: 404 })
  }

  const now = new Date()
  await prisma.$transaction([
    prisma.acquisitionInvite.updateMany({
      where: { id: invite.id, firstVisitAt: null },
      data: { firstVisitAt: now },
    }),
    prisma.acquisitionInvite.update({
      where: { id: invite.id },
      data: { visitCount: { increment: 1 }, lastVisitAt: now },
    }),
  ])

  return NextResponse.json({
    state: invite.status,
    campaignLabel: invite.campaignLabel,
    support,
  })
}
