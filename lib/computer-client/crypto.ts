import crypto from 'crypto'

/**
 * EP-CC-01 电脑客户端凭证哈希。
 *
 * 与旧 Desktop 激活链路、Browser POS Device Token 三者密钥完全隔离：
 *   - Browser POS : lib/desktop-pos-auth.ts（签名 token，另一套密钥）
 *   - 旧 Desktop  : edt_v1_ + DESKTOP_DEVICE_TOKEN_SECRET
 *   - 电脑客户端  : ecr_v1_ / ecc_v1_ + COMPUTER_CLIENT_TOKEN_SECRET
 *
 * 凭证明文由 Agent 本机生成并保存，云端只保存 HMAC 哈希；
 * 任何情况下都不落库、不写日志、不由云端下发。
 */

/** 申请通道凭证前缀：提交 / 查询 / 取消绑定申请 */
export const CLAIM_SECRET_PREFIX = 'ecr_v1_'
/** 设备通道凭证前缀：批准后确认绑定 */
export const DEVICE_SECRET_PREFIX = 'ecc_v1_'
/** 一次性 Browser POS 启动票据前缀。 */
export const BROWSER_LAUNCH_TICKET_PREFIX = 'ecl_v1_'

export const CLAIM_SECRET_HASH_VERSION = 1
export const DEVICE_SECRET_HASH_VERSION = 1

/** PENDING 申请有效期（小时）。超时后读取时惰性判定为 EXPIRED。 */
export const BINDING_REQUEST_TTL_HOURS = 24
/** 设备凭证有效期（天）。第一阶段不做轮换，仅作为到期兜底。 */
export const DEVICE_CREDENTIAL_TTL_DAYS = 365
/** 启动票据只用于默认浏览器接力，60 秒内未兑换即失效。 */
export const BROWSER_LAUNCH_TICKET_TTL_SECONDS = 60

export class ComputerClientSecretError extends Error {
  code: 'COMPUTER_CLIENT_SECRET_NOT_CONFIGURED'

  constructor() {
    super('COMPUTER_CLIENT_SECRET_NOT_CONFIGURED')
    this.code = 'COMPUTER_CLIENT_SECRET_NOT_CONFIGURED'
  }
}

/** 缺失即 fail-closed，绝不降级到默认值或明文比对 */
function requiredSecret() {
  const value = process.env.COMPUTER_CLIENT_TOKEN_SECRET?.trim()
  if (!value) throw new ComputerClientSecretError()
  return value
}

export function assertComputerClientSecretConfigured() {
  requiredSecret()
}

function hmacSha256Hex(value: string) {
  return crypto.createHmac('sha256', requiredSecret()).update(value).digest('hex')
}

export function hashInstallationId(installationId: string) {
  return hmacSha256Hex(`computer-client-installation:v1:${installationId}`)
}

export function hashClaimSecret(secret: string) {
  return hmacSha256Hex(`computer-client-claim-secret:v1:${secret}`)
}

export function hashDeviceSecret(secret: string) {
  return hmacSha256Hex(`computer-client-device-secret:v1:${secret}`)
}

export function createBrowserLaunchTicket() {
  return `${BROWSER_LAUNCH_TICKET_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
}

export function hashBrowserLaunchTicket(ticket: string) {
  return hmacSha256Hex(`computer-browser-launch-ticket:v1:${ticket}`)
}

export function hashBrowserDeviceId(deviceId: string) {
  return hmacSha256Hex(`computer-browser-device-id:v1:${deviceId}`)
}

/** 审计里出现的 IP / UA 一律哈希后存储 */
export function hashAuditValue(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized) return null
  try {
    return hmacSha256Hex(`computer-client-audit:v1:${normalized}`)
  } catch {
    return null
  }
}

function isValidSecretFormat(prefix: string, value: unknown): value is string {
  if (typeof value !== 'string') return false
  return new RegExp(`^${prefix}[A-Za-z0-9_-]{32,128}$`).test(value.trim())
}

export function isValidClaimSecretFormat(value: unknown): value is string {
  return isValidSecretFormat(CLAIM_SECRET_PREFIX, value)
}

export function isValidDeviceSecretFormat(value: unknown): value is string {
  return isValidSecretFormat(DEVICE_SECRET_PREFIX, value)
}

export function isValidBrowserLaunchTicketFormat(value: unknown): value is string {
  return isValidSecretFormat(BROWSER_LAUNCH_TICKET_PREFIX, value)
}

export function isValidBrowserDeviceId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length >= 8 && trimmed.length <= 128 && /^[A-Za-z0-9_-]+$/.test(trimmed)
}

export function isValidInstallationId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length >= 16 && trimmed.length <= 128 && /^[A-Za-z0-9_-]+$/.test(trimmed)
}

/** 定长比较，避免哈希比对上的时序侧信道 */
export function safeHashEqual(a: string, b: string) {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export function getBindingRequestExpiresAt(now = new Date()) {
  return new Date(now.getTime() + BINDING_REQUEST_TTL_HOURS * 60 * 60 * 1000)
}

export function getDeviceCredentialExpiresAt(now = new Date()) {
  return new Date(now.getTime() + DEVICE_CREDENTIAL_TTL_DAYS * 24 * 60 * 60 * 1000)
}

export function getBrowserLaunchTicketExpiresAt(now = new Date()) {
  return new Date(now.getTime() + BROWSER_LAUNCH_TICKET_TTL_SECONDS * 1000)
}
