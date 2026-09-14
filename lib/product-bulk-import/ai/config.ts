const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
const DEFAULT_ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export type ProductImportAiConfig = {
  provider: 'anthropic'
  model: string
  baseUrl: string
  apiKey: string
}

export function productImportAiConfig(): ProductImportAiConfig {
  const provider = (process.env.PRODUCT_IMPORT_AI_PROVIDER || 'anthropic').trim().toLowerCase()
  if (provider !== 'anthropic') throw new Error('PRODUCT_IMPORT_AI_PROVIDER_UNSUPPORTED')
  const model = (process.env.PRODUCT_IMPORT_AI_MODEL || DEFAULT_MODEL).trim()
  if (!model) throw new Error('PRODUCT_IMPORT_AI_MODEL_INVALID')
  const baseUrl = (process.env.PRODUCT_IMPORT_AI_BASE_URL || DEFAULT_ANTHROPIC_URL).trim()
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error('PRODUCT_IMPORT_AI_BASE_URL_INVALID')
  }
  if (url.protocol !== 'https:') throw new Error('PRODUCT_IMPORT_AI_BASE_URL_INVALID')
  if (process.env.NODE_ENV === 'production' && (url.hostname !== 'api.anthropic.com' || url.pathname !== '/v1/messages')) {
    throw new Error('PRODUCT_IMPORT_AI_BASE_URL_NOT_ALLOWED')
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) throw new Error('AI_NOT_CONFIGURED')
  return { provider: 'anthropic', model, baseUrl: url.toString(), apiKey }
}

export const PRODUCT_IMPORT_AI_DEFAULT_MODEL = DEFAULT_MODEL
