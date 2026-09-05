import crypto from 'node:crypto'
import { ComputerClientSecretError } from '@/lib/computer-client/crypto'

export const CLAIM_TOKEN_PREFIX = 'ecp_v1_'
const CLAIM_TOKEN_PATTERN = /^ecp_v1_[A-Za-z0-9_-]{43}$/

function requiredSecret() {
  const value = process.env.COMPUTER_CLIENT_TOKEN_SECRET?.trim()
  if (!value) throw new ComputerClientSecretError()
  return value
}

export function createClaimToken() {
  return `${CLAIM_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
}

export function isValidClaimToken(value: unknown): value is string {
  return typeof value === 'string' && CLAIM_TOKEN_PATTERN.test(value)
}

export function hashClaimToken(token: string) {
  return crypto
    .createHmac('sha256', requiredSecret())
    .update(`es-tray-02-claim-token:v1:${token}`)
    .digest('hex')
}
