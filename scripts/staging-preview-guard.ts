import crypto from 'node:crypto'

export const STAGING_PROJECT_REF_FINGERPRINT = 'c18c04531444'

function fingerprint(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function projectRefFromUrl(url: URL) {
  const userParts = decodeURIComponent(url.username).split('.')
  if (userParts.length > 1) return userParts.at(-1) ?? ''

  const hostParts = url.hostname.split('.')
  if (hostParts[0] === 'db' && hostParts.length > 2) return hostParts[1]
  return ''
}

export function assertStagingPreviewDatabase() {
  if (process.env.STAGING_PREVIEW_MAINTENANCE !== '1') {
    throw new Error('STAGING_PREVIEW_MAINTENANCE=1 is required')
  }
  if (process.env.VERCEL_ENV === 'production') {
    throw new Error('Staging maintenance is forbidden in Vercel Production')
  }

  const rawUrl = process.env.DATABASE_URL
  if (!rawUrl) throw new Error('DATABASE_URL is required')

  const url = new URL(rawUrl)
  const allowedHost = url.hostname.endsWith('.pooler.supabase.com')
    || (url.hostname.startsWith('db.') && url.hostname.endsWith('.supabase.co'))
  if (!allowedHost || url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL is not an approved Supabase PostgreSQL endpoint')
  }

  const projectRef = projectRefFromUrl(url)
  if (!projectRef || fingerprint(projectRef) !== STAGING_PROJECT_REF_FINGERPRINT) {
    throw new Error('DATABASE_URL does not match the authorized staging fingerprint')
  }

  return { projectRefFingerprint: STAGING_PROJECT_REF_FINGERPRINT }
}
