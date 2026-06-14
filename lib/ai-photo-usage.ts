import { prisma } from '@/lib/prisma'
import { normalizeTier, TENANT_TIERS, type TenantTier } from '@/lib/tier'

export const AI_PHOTO_FEATURE_KEY = 'AI_PHOTO_RECOGNIZE'

export type AiPhotoConfigSource = 'OPS_OVERRIDE' | 'ENV_TRIAL' | 'TIER_DEFAULT'

export type AiPhotoUsagePolicy = {
  tenantTier: TenantTier
  dailyLimit: number
  configSource: AiPhotoConfigSource
  enabled: boolean
  trialUntil: string | null
  opsConfigId: string | null
  opsNote: string | null
}

export function getUtcDayStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export function getEnvPositiveInt(name: string, defaultValue: number): number {
  const raw = process.env[name]
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue
}

export function getAiPhotoTierDailyLimit(tier: TenantTier): number {
  if (tier === TENANT_TIERS.MULTI_STORE) return getEnvPositiveInt('AI_PHOTO_MULTI_STORE_DAILY_LIMIT', 100)
  if (tier === TENANT_TIERS.STANDARD) return getEnvPositiveInt('AI_PHOTO_STANDARD_DAILY_LIMIT', 30)
  return getEnvPositiveInt('AI_PHOTO_LITE_DAILY_LIMIT', 3)
}

export function getAiPhotoTrialStoreIds(): Set<string> {
  return new Set(
    (process.env.AI_PHOTO_TRIAL_STORE_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  )
}

export function isFutureOrUnset(value: Date | null | undefined, now = new Date()): boolean {
  return !value || value.getTime() >= now.getTime()
}

export async function getAiPhotoUsedToday(storeId: string): Promise<number> {
  return prisma.operationLog.count({
    where: {
      storeId,
      actionType: AI_PHOTO_FEATURE_KEY,
      createdAt: { gte: getUtcDayStart() },
    },
  })
}

export async function resolveAiPhotoUsagePolicy(
  tenantId: string,
  storeId: string | null | undefined,
): Promise<AiPhotoUsagePolicy> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { tier: true },
  })
  const tenantTier = normalizeTier(tenant?.tier)

  if (storeId) {
    const opsConfig = await prisma.storeAiFeatureConfig.findUnique({
      where: {
        tenantId_storeId_featureKey: {
          tenantId,
          storeId,
          featureKey: AI_PHOTO_FEATURE_KEY,
        },
      },
      select: {
        id: true,
        enabled: true,
        dailyLimitOverride: true,
        trialUntil: true,
        opsNote: true,
      },
    })

    if (opsConfig) {
      if (!opsConfig.enabled) {
        return {
          tenantTier,
          dailyLimit: getFallbackDailyLimit(tenantTier, storeId),
          configSource: 'OPS_OVERRIDE',
          enabled: false,
          trialUntil: opsConfig.trialUntil?.toISOString() ?? null,
          opsConfigId: opsConfig.id,
          opsNote: opsConfig.opsNote ?? null,
        }
      }

      if (opsConfig.dailyLimitOverride != null && isFutureOrUnset(opsConfig.trialUntil)) {
        return {
          tenantTier,
          dailyLimit: opsConfig.dailyLimitOverride,
          configSource: 'OPS_OVERRIDE',
          enabled: true,
          trialUntil: opsConfig.trialUntil?.toISOString() ?? null,
          opsConfigId: opsConfig.id,
          opsNote: opsConfig.opsNote ?? null,
        }
      }
    }
  }

  if (storeId && getAiPhotoTrialStoreIds().has(storeId)) {
    return {
      tenantTier,
      dailyLimit: getEnvPositiveInt('AI_PHOTO_TRIAL_STORE_DAILY_LIMIT', 200),
      configSource: 'ENV_TRIAL',
      enabled: true,
      trialUntil: null,
      opsConfigId: null,
      opsNote: null,
    }
  }

  return {
    tenantTier,
    dailyLimit: getAiPhotoTierDailyLimit(tenantTier),
    configSource: 'TIER_DEFAULT',
    enabled: true,
    trialUntil: null,
    opsConfigId: null,
    opsNote: null,
  }
}

function getFallbackDailyLimit(tier: TenantTier, storeId: string): number {
  if (getAiPhotoTrialStoreIds().has(storeId)) return getEnvPositiveInt('AI_PHOTO_TRIAL_STORE_DAILY_LIMIT', 200)
  return getAiPhotoTierDailyLimit(tier)
}
