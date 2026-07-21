export type ShinhanPaymentConfig = {
  enabled: boolean
  mockMode: boolean
  baseUrl: string
  apiKey: string
  secretKey: string
  merchantId: string
  merchantName: string
  callbackBaseUrl: string
}

export type ShinhanPaymentAvailability = {
  enabled: boolean
  frozen: boolean
}

export const SHINHAN_PAYMENT_FROZEN_ERROR = 'SHINHAN_PAYMENT_FROZEN'

function flag(value: string | undefined, defaultValue = false): boolean {
  if (value == null || value === '') return defaultValue
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

export function getShinhanPaymentConfig(): ShinhanPaymentConfig {
  return {
    enabled: flag(process.env.SHINHAN_PAYMENT_ENABLED, false),
    mockMode: flag(process.env.SHINHAN_PAYMENT_MOCK_MODE, true),
    baseUrl: process.env.SHINHAN_UAT_BASE_URL || 'https://uat-pay.shinhan.com.kh',
    apiKey: process.env.SHINHAN_API_KEY || '',
    secretKey: process.env.SHINHAN_SECRET_KEY || '',
    merchantId: process.env.SHINHAN_MERCHANT_ID || '',
    merchantName: process.env.SHINHAN_MERCHANT_NAME || '',
    callbackBaseUrl: process.env.SHINHAN_CALLBACK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '',
  }
}

export function isShinhanConfigured(cfg = getShinhanPaymentConfig()): boolean {
  // Shinhan is frozen until an approved, non-mock commercial configuration exists.
  // This is server configuration only; no request value can enable the capability.
  if (!cfg.enabled || cfg.mockMode) return false
  return Boolean(cfg.baseUrl && cfg.apiKey && cfg.secretKey && cfg.merchantId && cfg.merchantName && cfg.callbackBaseUrl)
}

export function getShinhanPaymentAvailability(
  cfg = getShinhanPaymentConfig(),
): ShinhanPaymentAvailability {
  const enabled = isShinhanConfigured(cfg)
  return { enabled, frozen: !enabled }
}

export function isShinhanPaymentFrozen(cfg = getShinhanPaymentConfig()): boolean {
  return getShinhanPaymentAvailability(cfg).frozen
}
