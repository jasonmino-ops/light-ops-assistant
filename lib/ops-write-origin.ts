import { NextRequest, NextResponse } from 'next/server'

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

function forbidden() {
  return NextResponse.json(
    { error: 'OPS_WRITE_ORIGIN_FORBIDDEN' },
    { status: 403, headers: NO_STORE_HEADERS },
  )
}

function exactHttpOrigin(value: string) {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.username || parsed.password) return null
    return parsed.origin === value ? parsed.origin : null
  } catch {
    return null
  }
}

export function enforceOpsWriteOrigin(req: NextRequest): Response | null {
  if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase())) return null

  const expectedOrigin = exactHttpOrigin(req.nextUrl.origin)
  if (!expectedOrigin) return forbidden()

  const fetchSite = req.headers.get('sec-fetch-site')?.trim().toLowerCase() ?? ''
  const origin = req.headers.get('origin')?.trim() ?? ''

  if (origin) {
    if (origin === 'null' || exactHttpOrigin(origin) !== expectedOrigin) return forbidden()
    if (fetchSite && fetchSite !== 'same-origin') return forbidden()
    return null
  }

  if (fetchSite) return fetchSite === 'same-origin' ? null : forbidden()

  const referer = req.headers.get('referer')?.trim() ?? ''
  if (!referer) return forbidden()
  try {
    const parsed = new URL(referer)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return forbidden()
    if (parsed.username || parsed.password || parsed.origin !== expectedOrigin) return forbidden()
    return null
  } catch {
    return forbidden()
  }
}
