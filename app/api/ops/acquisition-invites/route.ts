import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuthContext, hasOpsRole } from '@/lib/ops-auth'
import {
  acquisitionInviteUrl,
  cleanInviteLabel,
  generateAcquisitionInviteCode,
  isPublicAcquisitionSource,
} from '@/lib/sales-lead-invite'

type InviteWithOwnerAndCount = Prisma.AcquisitionInviteGetPayload<{
  include: {
    salesOwner: { select: { id: true; name: true; role: true } }
    _count: { select: { leads: true } }
  }
}>

function toInviteResponse(invite: InviteWithOwnerAndCount, origin?: string | null) {
  const { _count, ...data } = invite
  return {
    ...data,
    url: acquisitionInviteUrl(invite.code, origin),
    leadCount: _count.leads,
  }
}

export async function GET(req: NextRequest) {
  const ops = await checkOpsAuthContext(req)
  if (!ops) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const [invites, salesOwners] = await Promise.all([
    prisma.acquisitionInvite.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        salesOwner: { select: { id: true, name: true, role: true } },
        _count: { select: { leads: true } },
      },
    }),
    prisma.opsAdmin.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, role: true },
    }),
  ])
  return NextResponse.json({
    invites: invites.map((invite) => toInviteResponse(invite, req.nextUrl.origin)),
    salesOwners,
    canManage: hasOpsRole(ops.role, 'OPS_ADMIN'),
  })
}

export async function POST(req: NextRequest) {
  const ops = await checkOpsAuthContext(req)
  if (!ops || !hasOpsRole(ops.role, 'OPS_ADMIN')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  }
  if (!isPublicAcquisitionSource(body.sourceChannel)) {
    return NextResponse.json({ error: 'INVALID_SOURCE' }, { status: 400 })
  }
  const campaignLabel = cleanInviteLabel(body.campaignLabel, 120)
  const internalNote = cleanInviteLabel(body.internalNote, 1000)
  const salesOwnerId = cleanInviteLabel(body.salesOwnerId, 64)
  if (salesOwnerId) {
    const owner = await prisma.opsAdmin.findFirst({
      where: { id: salesOwnerId, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!owner) return NextResponse.json({ error: 'INVALID_SALES_OWNER' }, { status: 400 })
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const invite = await prisma.acquisitionInvite.create({
        data: {
          code: generateAcquisitionInviteCode(),
          sourceChannel: body.sourceChannel,
          campaignLabel,
          salesOwnerId,
          internalNote,
        },
        include: {
          salesOwner: { select: { id: true, name: true, role: true } },
          _count: { select: { leads: true } },
        },
      })
      return NextResponse.json(toInviteResponse(invite, req.nextUrl.origin), { status: 201 })
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
    }
  }
  return NextResponse.json({ error: 'CODE_GENERATION_FAILED' }, { status: 503 })
}
