import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuthContext, getFkBackedOpsAdminIdentity, hasOpsRole } from '@/lib/ops-auth'
import { normalizeSalesLeadSupportConfig } from '@/lib/sales-lead-support'

const SUPPORT_CONFIG_ID = 'platform'

export async function GET(req: NextRequest) {
  const ops = await checkOpsAuthContext(req)
  if (!ops) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const manager = hasOpsRole(ops.role, 'OPS_ADMIN')
    ? await getFkBackedOpsAdminIdentity(req, 'OPS_ADMIN')
    : false

  const config = await prisma.salesLeadSupportConfig.findUnique({
    where: { id: SUPPORT_CONFIG_ID },
    select: {
      supportPhone: true,
      telegramSupportTarget: true,
      updatedAt: true,
      updatedBy: { select: { name: true } },
    },
  })
  return NextResponse.json({
    supportPhone: config?.supportPhone ?? null,
    telegramSupportTarget: config?.telegramSupportTarget ?? null,
    updatedAt: config?.updatedAt ?? null,
    updatedByName: config?.updatedBy?.name ?? null,
    canManage: Boolean(manager),
  })
}

export async function PATCH(req: NextRequest) {
  const actor = await getFkBackedOpsAdminIdentity(req, 'OPS_ADMIN')
  if (!actor) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  }
  const normalized = normalizeSalesLeadSupportConfig(body)
  if (!normalized) return NextResponse.json({ error: 'INVALID_SUPPORT_CONFIG' }, { status: 400 })

  const config = await prisma.salesLeadSupportConfig.upsert({
    where: { id: SUPPORT_CONFIG_ID },
    create: {
      id: SUPPORT_CONFIG_ID,
      ...normalized,
      updatedByOpsAdminId: actor.id,
    },
    update: {
      ...normalized,
      updatedByOpsAdminId: actor.id,
    },
    select: {
      supportPhone: true,
      telegramSupportTarget: true,
      updatedAt: true,
      updatedBy: { select: { name: true } },
    },
  })
  return NextResponse.json({
    supportPhone: config.supportPhone,
    telegramSupportTarget: config.telegramSupportTarget,
    updatedAt: config.updatedAt,
    updatedByName: config.updatedBy?.name ?? actor.name,
  })
}
