/**
 * lib/password.ts — scrypt-based password hashing (Node.js crypto, no extra deps)
 */
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto'

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const colonIdx = stored.indexOf(':')
  if (colonIdx < 0) return false
  const salt = stored.slice(0, colonIdx)
  const hash = stored.slice(colonIdx + 1)
  try {
    const hashBuf = Buffer.from(hash, 'hex')
    const actual = scryptSync(password, salt, 64)
    if (actual.length !== hashBuf.length) return false
    return timingSafeEqual(actual, hashBuf)
  } catch {
    return false
  }
}
