export type AiSupportProvider = 'LINGSHUO' | 'OPENAI' | 'CLAUDE' | 'GEMINI' | 'SELF_HOSTED' | 'MOCK'

export type AiSupportStatus = 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'LOW_CONFIDENCE' | 'NEED_HUMAN'

export type AiSupportRequest = {
  tenantId: string
  storeId: string
  storeName?: string | null
  telegramId: string
  customerId?: string | null
  sessionId: string
  language?: string | null
  userMessage: string
  channel: 'TELEGRAM_CUSTOMER'
  allowedTools: string[]
  context?: Record<string, unknown>
}

export type AiSupportResponse = {
  ok: boolean
  provider: AiSupportProvider | string
  replyText?: string
  confidence?: number | null
  needHuman?: boolean | null
  intent?: string | null
  auditId?: string | null
  raw?: unknown
  errorCode?: string | null
  errorMessage?: string | null
  latencyMs?: number | null
}

export type AiSupportRouterResult = {
  handled: boolean
  provider?: AiSupportProvider | string
  replyText?: string
  confidence?: number | null
  needHuman?: boolean
  intent?: string | null
  auditId?: string | null
  status?: string
  errorCode?: string | null
  errorMessage?: string | null
  latencyMs?: number | null
}

export type AiProviderAdapter = {
  provider: AiSupportProvider
  callAiProvider(input: AiSupportRequest, config: unknown): Promise<AiSupportResponse>
}

export type AiSupportProviderConfig = {
  id: string
  tenantId: string
  storeId: string | null
  provider: AiSupportProvider | string
  enabled: boolean
  apiBaseUrl: string | null
  clientId: string | null
  encryptedApiSecret: string | null
  secretRef: string | null
  allowedTools: string[]
  timeoutMs: number
}

export type AiSupportAuditInput = {
  tenantId?: string | null
  storeId?: string | null
  customerId?: string | null
  sessionId?: string | null
  provider: AiSupportProvider | string
  userMessage: string
  aiReply?: string | null
  intent?: string | null
  confidence?: number | null
  needHuman?: boolean | null
  toolCalls?: unknown
  providerAuditId?: string | null
  latencyMs?: number | null
  status: AiSupportStatus | string
  errorMessage?: string | null
}

export type LingshuoReplyInput = {
  apiBaseUrl?: string | null
  clientId?: string | null
  apiSecret?: string | null
  timeoutMs?: number | null
  tenantId?: string | null
  storeId?: string | null
  customerId?: string | null
  sessionId?: string | null
  language?: string | null
  message: string
  allowedTools?: string[]
  context?: Record<string, unknown>
}

export type LingshuoReplySuccess = {
  ok: true
  replyText: string
  language: string | null
  intent: string | null
  confidence: number | null
  needHuman: boolean
  auditId: string | null
  raw: unknown
  latencyMs: number
}

export type LingshuoReplyFailure = {
  ok: false
  errorCode: 'CONFIG_MISSING' | 'TIMEOUT' | 'HTTP_ERROR' | 'INVALID_RESPONSE' | 'REQUEST_FAILED'
  errorMessage: string
  latencyMs: number
  raw?: unknown
}

export type LingshuoReplyResult = LingshuoReplySuccess | LingshuoReplyFailure
