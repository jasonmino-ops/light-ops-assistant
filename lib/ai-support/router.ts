import { getAiSupportConfig } from './config'
import { getAiProviderAdapter } from './providers'
import type { AiSupportProvider, AiSupportRequest, AiSupportRouterResult } from './types'

type AiSupportRouterInput = AiSupportRequest & {
  provider?: AiSupportProvider | string
}

function aiKillSwitchEngaged(): boolean {
  const value = (process.env.AI_SUPPORT_KILL_SWITCH ?? '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export async function tryAiSupportReply(input: AiSupportRouterInput): Promise<AiSupportRouterResult> {
  if (aiKillSwitchEngaged()) {
    return { handled: false, status: 'KILL_SWITCH' }
  }

  const config = await getAiSupportConfig({
    tenantId: input.tenantId,
    storeId: input.storeId,
    provider: input.provider,
  })
  if (!config) {
    return { handled: false, status: 'CONFIG_DISABLED_OR_MISSING' }
  }

  const adapter = getAiProviderAdapter(config.provider)
  if (!adapter) {
    return {
      handled: false,
      provider: config.provider,
      status: 'ADAPTER_NOT_FOUND',
      errorCode: 'ADAPTER_NOT_FOUND',
    }
  }

  const response = await adapter.callAiProvider(input, config)
  return {
    handled: response.ok,
    provider: response.provider,
    replyText: response.replyText,
    confidence: response.confidence,
    needHuman: response.needHuman ?? false,
    intent: response.intent,
    auditId: response.auditId,
    status: response.ok ? 'SUCCESS' : 'FAILED',
    errorCode: response.errorCode,
    errorMessage: response.errorMessage,
    latencyMs: response.latencyMs,
  }
}
