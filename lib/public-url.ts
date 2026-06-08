const DEFAULT_PUBLIC_SITE_URL = 'https://elifekh.com'

function cleanBaseUrl(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

export function getPublicSiteUrl(origin?: string | null): string {
  const configured = cleanBaseUrl(
    process.env.NEXT_PUBLIC_PUBLIC_SITE_URL ??
    process.env.PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL,
  )
  if (configured) return configured

  const runtimeOrigin = cleanBaseUrl(origin)
  if (process.env.NODE_ENV !== 'production' && runtimeOrigin) return runtimeOrigin

  if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
    return cleanBaseUrl(window.location.origin)
  }

  return DEFAULT_PUBLIC_SITE_URL
}

export function publicUrl(path: string, origin?: string | null): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${getPublicSiteUrl(origin)}${normalizedPath}`
}
