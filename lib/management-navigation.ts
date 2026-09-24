/**
 * Management Center return navigation (ES-MANAGEMENT-CENTER-P5-01).
 *
 * Pure navigation helpers: no fetch, no storage, no Desktop runtime access.
 * A destination page reached from /management receives `returnTo`; only a
 * same-origin /management target (optionally carrying the existing Desktop
 * `from=desktop` / `storeCode` context) is accepted, so the parameter cannot
 * become an open redirect.
 */

export const MANAGEMENT_PATH = '/management'

const RETURN_PARAM = 'returnTo'
const PARSE_BASE = 'https://management-return.invalid'
const MAX_STORE_CODE_LENGTH = 128

export function buildManagementHref(context: { fromDesktop: boolean; storeCode: string | null }): string {
  if (!context.fromDesktop) return MANAGEMENT_PATH
  const params = new URLSearchParams({ from: 'desktop' })
  if (context.storeCode) params.set('storeCode', context.storeCode)
  return `${MANAGEMENT_PATH}?${params.toString()}`
}

export function withManagementReturn(path: string, managementHref: string): string {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}${RETURN_PARAM}=${encodeURIComponent(managementHref)}`
}

export function readManagementReturnHref(search: string): string | null {
  let raw: string | null
  try {
    raw = new URLSearchParams(search).get(RETURN_PARAM)
  } catch {
    return null
  }
  if (!raw || !raw.startsWith(MANAGEMENT_PATH) || raw.startsWith('//')) return null

  let url: URL
  try {
    url = new URL(raw, PARSE_BASE)
  } catch {
    return null
  }
  if (url.origin !== PARSE_BASE || url.pathname !== MANAGEMENT_PATH) return null

  const storeCode = url.searchParams.get('storeCode')?.trim() || null
  return buildManagementHref({
    fromDesktop: url.searchParams.get('from') === 'desktop',
    storeCode: storeCode && storeCode.length <= MAX_STORE_CODE_LENGTH ? storeCode : null,
  })
}
