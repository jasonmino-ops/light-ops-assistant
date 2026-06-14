/**
 * GET   /api/ops/tenants/[tenantId]  — tenant detail with members + today's stats
 * PATCH /api/ops/tenants/[tenantId]  — update tier
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'
import { canUseAiSupport, normalizeTier, type TenantTier } from '@/lib/tier'
import {
  AI_PHOTO_FEATURE_KEY,
  getAiPhotoTierDailyLimit,
  getAiPhotoTrialStoreIds,
  getEnvPositiveInt,
  getUtcDayStart,
  isFutureOrUnset,
  type AiPhotoConfigSource,
} from '@/lib/ai-photo-usage'

function todayStart() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function maskAiSupportApiBaseUrl(value: string | null): string | null {
  if (!value) return null
  if (value.startsWith('mock://')) return value
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}`
  } catch {
    return value.length > 32 ? `${value.slice(0, 32)}…` : value
  }
}

function asPayloadObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

type StoreAiConfigRow = {
  id: string
  enabled: boolean
  dailyLimitOverride: number | null
  trialUntil: Date | null
  opsNote: string | null
  updatedAt: Date
}

function resolveAiPhotoLimit(
  tier: TenantTier,
  storeId: string,
  config: StoreAiConfigRow | null | undefined,
): {
  dailyLimit: number
  limitSource: AiPhotoConfigSource
} {
  const envLimit = getAiPhotoTrialStoreIds().has(storeId)
    ? getEnvPositiveInt('AI_PHOTO_TRIAL_STORE_DAILY_LIMIT', 200)
    : null
  const fallbackLimit = envLimit ?? getAiPhotoTierDailyLimit(tier)
  const fallbackSource: AiPhotoConfigSource = envLimit != null ? 'ENV_TRIAL' : 'TIER_DEFAULT'

  if (!config) return { dailyLimit: fallbackLimit, limitSource: fallbackSource }
  if (!config.enabled) {
    return {
      dailyLimit: config.dailyLimitOverride ?? fallbackLimit,
      limitSource: 'OPS_OVERRIDE',
    }
  }
  if (config.dailyLimitOverride != null && isFutureOrUnset(config.trialUntil)) {
    return {
      dailyLimit: config.dailyLimitOverride,
      limitSource: 'OPS_OVERRIDE',
    }
  }
  return { dailyLimit: fallbackLimit, limitSource: fallbackSource }
}

function numberFromPayload(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringFromPayload(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value ? value : null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const opsRole = await checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const { tenantId } = await params

  const todayUtc = new Date().toISOString().slice(0, 10)
  const todayStartUtc = getUtcDayStart()
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [tenant, stores, users, todaySummary, lastSale, aiSupportConfigs, aiPhotoLogs, aiPhotoConfigs] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.store.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: { id: true, name: true, code: true, eLifeFeatured: true, eLifeFeaturedSort: true, businessType: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.user.findMany({
      where: { tenantId, status: 'ACTIVE' },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        telegramId: true,
        staffNumber: true,
        storeRoles: {
          where: { status: 'ACTIVE' },
          take: 1,
          select: { store: { select: { name: true } } },
        },
      },
    }),
    // Try summary table first for today
    prisma.tenantDailySummary.findUnique({
      where: { tenantId_date: { tenantId, date: todayUtc } },
      select: { salesCount: true, refundCount: true, grossSales: true },
    }),
    prisma.saleRecord.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.aiSupportProviderConfig.findMany({
      where: { tenantId },
      orderBy: [{ storeId: 'asc' }, { provider: 'asc' }],
      select: {
        id: true,
        tenantId: true,
        storeId: true,
        provider: true,
        enabled: true,
        apiBaseUrl: true,
        timeoutMs: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.operationLog.findMany({
      where: {
        tenantId,
        actionType: 'AI_PHOTO_RECOGNIZE',
        createdAt: { gte: sevenDaysAgo },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        storeId: true,
        status: true,
        message: true,
        payloadSnapshot: true,
        createdAt: true,
      },
    }),
    prisma.storeAiFeatureConfig.findMany({
      where: { tenantId, featureKey: AI_PHOTO_FEATURE_KEY },
      select: {
        id: true,
        storeId: true,
        enabled: true,
        dailyLimitOverride: true,
        trialUntil: true,
        opsNote: true,
        updatedAt: true,
      },
    }),
  ])

  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  const tenantTier = normalizeTier(tenant.tier)
  const storeById = new Map(stores.map((store) => [store.id, store]))
  const aiPhotoConfigByStoreId = new Map(aiPhotoConfigs.map((config) => [config.storeId, config]))
  const aiTierAllowed = canUseAiSupport(tenant.tier)
  const enabledCount = aiSupportConfigs.filter((config) => config.enabled).length
  const hasMultipleEnabled = enabledCount > 1
  const allDisabled = enabledCount === 0
  const selectionNotes: string[] = []
  if (!aiTierAllowed) selectionNotes.push('当前套餐不允许 AI Support L3，即使存在 Provider 配置也不会调用 AI。')
  if (allDisabled) selectionNotes.push('当前安全：所有 AI Provider 均为关闭状态，不会调用 AI。')
  if (hasMultipleEnabled) selectionNotes.push('配置冲突：存在多个 enabled=true，selection policy 会拒绝调用 AI。')
  if (aiTierAllowed && enabledCount === 1) selectionNotes.push('当前存在一个可选 Provider；仍需确认是否为测试门店与灰度场景。')
  if (aiSupportConfigs.length === 0) selectionNotes.push('当前没有 AI Support Provider 配置，selection policy 不会调用 AI。')
  const safeStateLabel = !aiTierAllowed
    ? '套餐拦截'
    : hasMultipleEnabled
      ? '配置冲突'
      : allDisabled
        ? '全部关闭'
        : '存在可选 Provider'

  // Today's stats: summary first, fall back to raw if missing
  let todayStats: { saleCount: number; saleAmount: number; refundCount: number }
  if (todaySummary) {
    todayStats = {
      saleCount: todaySummary.salesCount,
      saleAmount: Math.round(Number(todaySummary.grossSales) * 100) / 100,
      refundCount: todaySummary.refundCount,
    }
  } else {
    const todayRecords = await prisma.saleRecord.findMany({
      where: { tenantId, createdAt: { gte: todayStart() } },
      select: { saleType: true, lineAmount: true, orderNo: true },
    })
    const saleOrders = new Set<string>()
    let saleAmount = 0
    let refundCount = 0
    for (const r of todayRecords) {
      if (r.saleType === 'SALE') {
        if (r.orderNo) saleOrders.add(r.orderNo)
        saleAmount += Number(r.lineAmount)
      } else {
        refundCount++
      }
    }
    todayStats = {
      saleCount: saleOrders.size,
      saleAmount: Math.round(saleAmount * 100) / 100,
      refundCount,
    }
  }

  return NextResponse.json({
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,
    tier: tenant.tier,
    createdAt: tenant.createdAt.toISOString(),
    stores,
    members: users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      bound: !!u.telegramId,
      telegramId: u.telegramId ?? null,
      staffNumber: u.staffNumber ?? null,
      storeName: u.storeRoles[0]?.store.name ?? '—',
    })),
    today: {
      ...todayStats,
      lastActiveAt: lastSale?.createdAt.toISOString() ?? null,
    },
    aiSupport: {
      tier: tenant.tier,
      canUseAiSupport: aiTierAllowed,
      configs: aiSupportConfigs.map((config) => {
        const store = config.storeId ? storeById.get(config.storeId) : null
        return {
          id: config.id,
          provider: config.provider,
          enabled: config.enabled,
          scope: config.storeId ? 'STORE' : 'TENANT',
          tenantId: config.tenantId,
          storeId: config.storeId,
          storeName: store?.name ?? null,
          storeCode: store?.code ?? null,
          apiBaseUrlMasked: maskAiSupportApiBaseUrl(config.apiBaseUrl),
          timeoutMs: config.timeoutMs,
          createdAt: config.createdAt.toISOString(),
          updatedAt: config.updatedAt.toISOString(),
        }
      }),
      selectionSummary: {
        totalConfigs: aiSupportConfigs.length,
        enabledCount,
        hasMultipleEnabled,
        allDisabled,
        blockedByTier: !aiTierAllowed,
        canBeSelected: aiTierAllowed && enabledCount === 1,
        safeStateLabel,
        notes: selectionNotes,
      },
    },
    aiPhoto: {
      tier: tenant.tier,
      stores: stores.map((store) => {
        const config = aiPhotoConfigByStoreId.get(store.id) ?? null
        const { dailyLimit, limitSource } = resolveAiPhotoLimit(tenantTier, store.id, config)
        const storeLogs = aiPhotoLogs.filter((log) => log.storeId === store.id)
        const todayLogs = storeLogs.filter((log) => log.createdAt >= todayStartUtc)
        const latest = storeLogs[0] ?? null
        const latestPayload = latest ? asPayloadObject(latest.payloadSnapshot) : {}
        const latestErrorCode = latest?.message === 'AI_DAILY_LIMIT_REACHED'
          ? 'AI_DAILY_LIMIT_REACHED'
          : stringFromPayload(latestPayload, 'errorCode')
        const totalCalls7d = storeLogs.length
        const successCalls7d = storeLogs.filter((log) => log.status === 'SUCCESS').length
        const failedCalls7d = storeLogs.filter((log) => log.status === 'FAILED').length
        const limitReached7d = storeLogs.filter((log) => {
          const payload = asPayloadObject(log.payloadSnapshot)
          return log.message === 'AI_DAILY_LIMIT_REACHED' || stringFromPayload(payload, 'errorCode') === 'AI_DAILY_LIMIT_REACHED'
        }).length
        const usedToday = todayLogs.length
        const statusLabel = usedToday >= dailyLimit
          ? '今日已超限'
          : usedToday === 0
            ? '今日未使用'
            : latest?.status === 'FAILED'
              ? '最近失败'
              : '可试用'
        return {
          storeId: store.id,
          storeName: store.name,
          storeCode: store.code,
          tier: tenant.tier,
          statusLabel,
          usedToday,
          dailyLimit,
          limitSource,
          config: config ? {
            id: config.id,
            enabled: config.enabled,
            dailyLimitOverride: config.dailyLimitOverride,
            trialUntil: config.trialUntil?.toISOString() ?? null,
            opsNote: config.opsNote ?? '',
            updatedAt: config.updatedAt.toISOString(),
          } : null,
          latest: latest ? {
            id: latest.id,
            createdAt: latest.createdAt.toISOString(),
            status: latest.status,
            message: latest.message,
            errorCode: latestErrorCode,
            candidateCount: numberFromPayload(latestPayload, 'candidateCount'),
            latencyMs: numberFromPayload(latestPayload, 'latencyMs'),
          } : null,
          last7Days: {
            totalCalls: totalCalls7d,
            successCalls: successCalls7d,
            failedCalls: failedCalls7d,
            limitReachedCalls: limitReached7d,
          },
        }
      }),
    },
  })
}

const VALID_TIERS = ['LITE', 'STANDARD', 'MULTI_STORE']
const VALID_STATUS = ['ACTIVE', 'ARCHIVED']

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const opsRole = await checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  // BD cannot modify tenant tier or status
  if (opsRole === 'BD') return NextResponse.json({ error: 'FORBIDDEN', message: 'BD 角色无此操作权限' }, { status: 403 })
  const { tenantId } = await params

  let body: { tier?: string; status?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }) }

  const data: { tier?: string; status?: string } = {}
  if (body.tier !== undefined) {
    if (!VALID_TIERS.includes(body.tier)) return NextResponse.json({ error: 'INVALID_TIER' }, { status: 400 })
    data.tier = body.tier
  }
  if (body.status !== undefined) {
    if (!VALID_STATUS.includes(body.status)) return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 })
    data.status = body.status
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'NO_CHANGE' }, { status: 400 })

  await prisma.tenant.update({ where: { id: tenantId }, data })
  return NextResponse.json({ ok: true, ...data })
}
