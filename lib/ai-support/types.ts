export type AiSupportProvider = 'LINGSHUO'

export type AiSupportStatus = 'SKIPPED' | 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'NEED_HUMAN'

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
