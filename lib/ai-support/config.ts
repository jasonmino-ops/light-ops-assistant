import { prisma } from '@/lib/prisma'
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
