import { prisma } from '@/lib/prisma'
import { canUseAiSupport, normalizeTier, type TenantTier } from '@/lib/tier'
import type { AiSupportProvider, AiSupportProviderConfig } from './types'

const DEFAULT_TIMEOUT_MS = 3000

function aiKillSwitchEngaged(): boolean {
  const value = (process.env.AI_SUPPORT_KILL_SWITCH ?? '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function parseAllowedTools(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []
  } catch {
    return []
  }
}

function normalizeConfig(config: {
  id: string
  tenantId: string
  storeId: string | null
  provider: string
  enabled: boolean
  apiBaseUrl: string | null
  clientId: string | null
  encryptedApiSecret: string | null
  secretRef: string | null
  allowedToolsJson: string
  timeoutMs: number
}): AiSupportProviderConfig {
  return {
    id: config.id,
    tenantId: config.tenantId,
    storeId: config.storeId,
    provider: config.provider,
    enabled: config.enabled,
    apiBaseUrl: config.apiBaseUrl,
    clientId: config.clientId,
    encryptedApiSecret: config.encryptedApiSecret,
    secretRef: config.secretRef,
    allowedTools: parseAllowedTools(config.allowedToolsJson),
    timeoutMs: Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
      ? config.timeoutMs
      : DEFAULT_TIMEOUT_MS,
  }
}

export type AiSupportProviderSelection = {
  provider: AiSupportProvider | string | null
  enabled: boolean
  reason:
    | 'SELECTED_STORE_CONFIG'
    | 'SELECTED_TENANT_CONFIG'
    | 'TIER_NOT_ALLOWED'
    | 'CONFIG_DISABLED_OR_MISSING'
    | 'MULTIPLE_ENABLED_CONFIGS'
    | 'INVALID_CONTEXT'
    | 'KILL_SWITCH'
    | 'LOOKUP_FAILED'
  configId: string | null
  tier: TenantTier
  tierAllowed: boolean
  shouldCallAi: boolean
}

function disabledSelection(reason: AiSupportProviderSelection['reason'], tier?: string | null): AiSupportProviderSelection {
  const normalizedTier = normalizeTier(tier)
  return {
    provider: null,
    enabled: false,
    reason,
    configId: null,
    tier: normalizedTier,
    tierAllowed: canUseAiSupport(normalizedTier),
    shouldCallAi: false,
  }
}

function selectSingleEnabledConfig(
  configs: Array<{ id: string; provider: string; enabled: boolean }>,
  reason: 'SELECTED_STORE_CONFIG' | 'SELECTED_TENANT_CONFIG',
  tier: TenantTier,
): AiSupportProviderSelection | null {
  const enabledConfigs = configs.filter((config) => config.enabled)
  if (enabledConfigs.length === 0) return null
  if (enabledConfigs.length > 1) {
    return {
      provider: null,
      enabled: false,
      reason: 'MULTIPLE_ENABLED_CONFIGS',
      configId: null,
      tier,
      tierAllowed: true,
      shouldCallAi: false,
    }
  }
  const selected = enabledConfigs[0]
  return {
    provider: selected.provider,
    enabled: true,
    reason,
    configId: selected.id,
    tier,
    tierAllowed: true,
    shouldCallAi: true,
  }
}

export async function resolveAiSupportProviderForStore(params: {
  tenantId: string | null | undefined
  storeId: string | null | undefined
  scenario: 'customer_support_l3'
}): Promise<AiSupportProviderSelection> {
  if (aiKillSwitchEngaged()) return disabledSelection('KILL_SWITCH')

  const tenantId = params.tenantId?.trim()
  const storeId = params.storeId?.trim()
  if (!tenantId || !storeId || params.scenario !== 'customer_support_l3') {
    return disabledSelection('INVALID_CONTEXT')
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { tier: true },
    })
    const tier = normalizeTier(tenant?.tier)
    if (!canUseAiSupport(tier)) return disabledSelection('TIER_NOT_ALLOWED', tier)

    const storeConfigs = await prisma.aiSupportProviderConfig.findMany({
      where: { tenantId, storeId },
      select: { id: true, provider: true, enabled: true },
      orderBy: { createdAt: 'asc' },
    })
    if (storeConfigs.length > 0) {
      return selectSingleEnabledConfig(storeConfigs, 'SELECTED_STORE_CONFIG', tier)
        ?? disabledSelection('CONFIG_DISABLED_OR_MISSING', tier)
    }

    const tenantConfigs = await prisma.aiSupportProviderConfig.findMany({
      where: { tenantId, storeId: null },
      select: { id: true, provider: true, enabled: true },
      orderBy: { createdAt: 'asc' },
    })
    if (tenantConfigs.length > 0) {
      return selectSingleEnabledConfig(tenantConfigs, 'SELECTED_TENANT_CONFIG', tier)
        ?? disabledSelection('CONFIG_DISABLED_OR_MISSING', tier)
    }

    return disabledSelection('CONFIG_DISABLED_OR_MISSING', tier)
  } catch (error) {
    console.error('[ai-support] provider selection failed', error)
    return disabledSelection('LOOKUP_FAILED')
  }
}

export async function getAiSupportConfig(params: {
  tenantId: string | null | undefined
  storeId?: string | null
  provider?: AiSupportProvider | string
}): Promise<AiSupportProviderConfig | null> {
  if (aiKillSwitchEngaged()) return null

  const tenantId = params.tenantId?.trim()
  if (!tenantId) return null

  const provider = params.provider ?? 'LINGSHUO'
  try {
    const storeConfig = params.storeId
      ? await prisma.aiSupportProviderConfig.findFirst({
          where: { tenantId, storeId: params.storeId, provider },
        })
      : null
    if (storeConfig) return storeConfig.enabled ? normalizeConfig(storeConfig) : null

    const tenantConfig = await prisma.aiSupportProviderConfig.findFirst({
      where: { tenantId, storeId: null, provider, enabled: true },
    })
    return tenantConfig ? normalizeConfig(tenantConfig) : null
  } catch (error) {
    console.error('[ai-support] config lookup failed', error)
    return null
  }
}
