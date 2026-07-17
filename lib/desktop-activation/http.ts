import { NextResponse } from 'next/server'

export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

export function noStoreJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...(init?.headers ?? {}),
    },
  })
}

export function apiError(error: string, status: number, extra?: Record<string, unknown>) {
  return noStoreJson({ error, ...(extra ?? {}) }, { status })
}

export async function withDesktopApiError(handler: () => Promise<Response>) {
  try {
    return await handler()
  } catch {
    return apiError('INTERNAL_ERROR', 500)
  }
}

export function minimalDesktopSubscription(subscription: { accessState: string; status: string; warning: string | null }) {
  return {
    accessState: subscription.accessState,
    status: subscription.status,
    warning: subscription.warning,
  }
}
