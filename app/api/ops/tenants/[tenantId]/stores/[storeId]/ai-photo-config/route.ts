/**
 * PATCH /api/ops/tenants/[tenantId]/stores/[storeId]/ai-photo-config
 *
 * OPS-only: configure one store's AI photo recognition trial limit.
 * No merchant OWNER / STAFF access. No image / AI invocation here.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth, hasOpsRole } from '@/lib/ops-auth'
import { AI_PHOTO_FEATURE_KEY } from '@/lib/ai-photo-usage'
import { verifySession } from '@/lib/session'

type Body = {
  enabled?: unknown
  dailyLimitOverride?: unknown
  trialUntil?: unknown
  opsNote?: unknown
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string; storeId: string }> },
) {
  const opsRole = await checkOpsAuth(req)
  if (!opsRole || !hasOpsRole(opsRole, 'OPS_ADMIN')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  const sessionToken = req.cookies.get('auth-session')?.value
  const session = sessionToken ? verifySession(sessionToken) : null
  const updatedByOpsAdminId = session?.userId ?? null
  const { tenantId, storeId } = await params

  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId, status: 'ACTIVE' },
    select: { id: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })

  let body: Body
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'INVALID_ENABLED' }, { status: 400 })
  }

  let dailyLimitOverride: number | null = null
  if (body.dailyLimitOverride !== null && body.dailyLimitOverride !== '' && body.dailyLimitOverride !== undefined) {
    const parsed = typeof body.dailyLimitOverride === 'number'
      ? body.dailyLimitOverride
      : Number.parseInt(String(body.dailyLimitOverride), 10)
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 10000) {
      return NextResponse.json({ error: 'INVALID_DAILY_LIMIT' }, { status: 400 })
    }
    dailyLimitOverride = parsed
  }

  let trialUntil: Date | null = null
  if (body.trialUntil !== null && body.trialUntil !== '' && body.trialUntil !== undefined) {
    if (typeof body.trialUntil !== 'string') {
      return NextResponse.json({ error: 'INVALID_TRIAL_UNTIL' }, { status: 400 })
    }
    trialUntil = new Date(`${body.trialUntil}T23:59:59.999Z`)
    if (Number.isNaN(trialUntil.getTime())) {
      return NextResponse.json({ error: 'INVALID_TRIAL_UNTIL' }, { status: 400 })
    }
  }

  const opsNote = typeof body.opsNote === 'string'
    ? body.opsNote.trim().slice(0, 500)
    : ''

  const config = await prisma.storeAiFeatureConfig.upsert({
    where: {
      tenantId_storeId_featureKey: {
        tenantId,
        storeId,
        featureKey: AI_PHOTO_FEATURE_KEY,
      },
    },
    create: {
      tenantId,
      storeId,
      featureKey: AI_PHOTO_FEATURE_KEY,
      enabled: body.enabled,
      dailyLimitOverride,
      trialUntil,
      opsNote: opsNote || null,
      updatedByOpsAdminId,
    },
    update: {
      enabled: body.enabled,
      dailyLimitOverride,
      trialUntil,
      opsNote: opsNote || null,
      updatedByOpsAdminId,
    },
    select: {
      id: true,
      enabled: true,
      dailyLimitOverride: true,
      trialUntil: true,
      opsNote: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({
    ok: true,
    config: {
      ...config,
      trialUntil: config.trialUntil?.toISOString() ?? null,
      updatedAt: config.updatedAt.toISOString(),
    },
  })
}
