import crypto from 'crypto'

/**
 * Verifies Telegram WebApp initData HMAC against the provided bot token.
 * Returns parsed URLSearchParams (without 'hash') on success, or null on failure.
 *
 * Dev mode: if botToken is empty, HMAC verification is skipped so local
 * development without a real bot still works.
 */
export function verifyTgInitData(initData: string, botToken: string): URLSearchParams | null {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null

  params.delete('hash')

  if (!botToken) {
    // Dev: skip HMAC, trust params as-is
    return params
  }

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected  = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  return expected === hash ? params : null
}

/**
 * Extracts the Telegram numeric user ID from pre-verified initData params.
 * Returns the id as a string, or null if missing / malformed.
 */
export function extractTgUserIdFromParams(params: URLSearchParams): string | null {
  try {
    const userStr = params.get('user')
    if (!userStr) return null
    return String(JSON.parse(userStr).id)
  } catch {
    return null
  }
}
