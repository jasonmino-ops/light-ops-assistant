/**
 * lib/session.ts
 *
 * Signs and verifies the auth-session cookie.
 * Node.js crypto only — do NOT import this in middleware (Edge runtime).
 * Middleware does an unverified role-peek; real verification happens here in API routes.
 */

import crypto from 'crypto'

export type SessionData = {
  tenantId: string
  userId: string
  storeId: string
  role: 'OWNER' | 'STAFF'
}

function secret(): string {
  return process.env.AUTH_SECRET ?? 'dev-secret-change-in-production'
}

/** Returns `<base64url-payload>.<base64url-hmac>` */
export function signSession(data: SessionData): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

/** Returns parsed data or null if signature is invalid / malformed. */
export function verifySession(token: string): SessionData | null {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const payload = token.slice(0, dot)
    const sig = token.slice(dot + 1)
    const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
    if (expected !== sig) return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as SessionData
  } catch {
    return null
  }
}
