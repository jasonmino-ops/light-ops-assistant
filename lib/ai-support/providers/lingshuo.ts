import { callLingshuoReply } from '../lingshuo-client'
import type {
  AiProviderAdapter,
  AiSupportProviderConfig,
  AiSupportRequest,
  AiSupportResponse,
} from '../types'

function resolveApiSecret(config: AiSupportProviderConfig): string | null {
  return config.encryptedApiSecret ?? (config.secretRef ? process.env[config.secretRef] ?? null : null)
}

function toAiSupportResponse(result: Awaited<ReturnType<typeof callLingshuoReply>>): AiSupportResponse {
  if (!result.ok) {
    return {
      ok: false,
      provider: 'LINGSHUO',
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      latencyMs: result.latencyMs,
      raw: result.raw,
    }
  }

  return {
    ok: true,
    provider: 'LINGSHUO',
    replyText: result.replyText,
    confidence: result.confidence,
    needHuman: result.needHuman,
    intent: result.intent,
    auditId: result.auditId,
    raw: result.raw,
    latencyMs: result.latencyMs,
  }
}

export const lingshuoProviderAdapter: AiProviderAdapter = {
  provider: 'LINGSHUO',
  async callAiProvider(input: AiSupportRequest, config: unknown): Promise<AiSupportResponse> {
    const providerConfig = config as AiSupportProviderConfig
    const result = await callLingshuoReply({
      apiBaseUrl: providerConfig.apiBaseUrl,
      clientId: providerConfig.clientId,
      apiSecret: resolveApiSecret(providerConfig),
      timeoutMs: providerConfig.timeoutMs,
      tenantId: input.tenantId,
      storeId: input.storeId,
      customerId: input.customerId,
      sessionId: input.sessionId,
      language: input.language,
      message: input.userMessage,
      allowedTools: input.allowedTools.length > 0 ? input.allowedTools : providerConfig.allowedTools,
      context: input.context,
    })

    return toAiSupportResponse(result)
  },
}
