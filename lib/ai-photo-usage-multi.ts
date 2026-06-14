import { prisma } from '@/lib/prisma'
import { getUtcDayStart, getEnvPositiveInt, isFutureOrUnset } from '@/lib/ai-photo-usage'
import { normalizeTier, TENANT_TIERS, type TenantTier } from '@/lib/tier'

export const AI_PHOTO_MULTI_FEATURE_KEY = 'AI_PHOTO_RECOGNIZE_MULTI'

export type AiPhotoMultiConfigSource = 'OPS_OVERRIDE' | 'ENV_TRIAL' | 'TIER_DEFAULT'

export type AiPhotoMultiUsagePolicy = {
  tenantTier: TenantTier
  dailyLimit: number
  configSource: AiPhotoMultiConfigSource
  enabled: boolean
  trialUntil: string | null
  opsConfigId: string | null
  opsNote: string | null
}

export function getAiPhotoMultiTrialStoreIds(): Set<string> {
  return new Set(
    (process.env.AI_PHOTO_MULTI_TRIAL_STORE_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  )
}

export function getAiPhotoMultiTierDailyLimit(tier: TenantTier): number {
  if (tier === TENANT_TIERS.MULTI_STORE) return getEnvPositiveInt('AI_PHOTO_MULTI_STORE_DAILY_LIMIT', 20)
  if (tier === TENANT_TIERS.STANDARD) return getEnvPositiveInt('AI_PHOTO_MULTI_STANDARD_DAILY_LIMIT', 10)
  return getEnvPositiveInt('AI_PHOTO_MULTI_LITE_DAILY_LIMIT', 1)
}

export function getAiPhotoMultiTrialStoreLimit(): number {
  return getEnvPositiveInt('AI_PHOTO_MULTI_TRIAL_STORE_DAILY_LIMIT', 50)
}

export async function getAiPhotoMultiUsedToday(storeId: string): Promise<number> {
  return prisma.operationLog.count({
    where: {
      storeId,
      actionType: AI_PHOTO_MULTI_FEATURE_KEY,
      createdAt: { gte: getUtcDayStart() },
    },
  })
}

export async function resolveAiPhotoMultiUsagePolicy(
  tenantId: string,
  storeId: string | null | undefined,
): Promise<AiPhotoMultiUsagePolicy> {
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
          featureKey: AI_PHOTO_MULTI_FEATURE_KEY,
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

  if (storeId && getAiPhotoMultiTrialStoreIds().has(storeId)) {
    return {
      tenantTier,
      dailyLimit: getAiPhotoMultiTrialStoreLimit(),
      configSource: 'ENV_TRIAL',
      enabled: true,
      trialUntil: null,
      opsConfigId: null,
      opsNote: null,
    }
  }

  return {
    tenantTier,
    dailyLimit: getAiPhotoMultiTierDailyLimit(tenantTier),
    configSource: 'TIER_DEFAULT',
    enabled: true,
    trialUntil: null,
    opsConfigId: null,
    opsNote: null,
  }
}

function getFallbackDailyLimit(tier: TenantTier, storeId: string): number {
  if (getAiPhotoMultiTrialStoreIds().has(storeId)) return getAiPhotoMultiTrialStoreLimit()
  return getAiPhotoMultiTierDailyLimit(tier)
}
