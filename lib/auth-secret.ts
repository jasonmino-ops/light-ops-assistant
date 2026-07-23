const MIN_AUTH_SECRET_LENGTH = 32

export type AuthSecretConfigurationErrorCode =
  | 'AUTH_SECRET_NOT_CONFIGURED'
  | 'AUTH_SECRET_INVALID'

export class AuthSecretConfigurationError extends Error {
  code: AuthSecretConfigurationErrorCode

  constructor(code: AuthSecretConfigurationErrorCode) {
    super(code)
    this.code = code
  }
}

/**
 * Shared HMAC/encryption configuration for application sessions, Browser POS
 * credentials and their delivery envelopes. No caller may substitute a
 * development default: an absent, blank, or too-short secret is unusable.
 */
export function requireAuthSecret() {
  const secret = process.env.AUTH_SECRET?.trim()
  if (!secret) throw new AuthSecretConfigurationError('AUTH_SECRET_NOT_CONFIGURED')
  if (secret.length < MIN_AUTH_SECRET_LENGTH) {
    throw new AuthSecretConfigurationError('AUTH_SECRET_INVALID')
  }
  return secret
}

export function isAuthSecretConfigured() {
  try {
    requireAuthSecret()
    return true
  } catch (error) {
    if (error instanceof AuthSecretConfigurationError) return false
    throw error
  }
}
