'use client'

import { getPosDeviceToken, posDeviceHeaders } from './desktop-pos-client'

export function isDesktopPosDeviceRuntime(): boolean {
  return typeof window !== 'undefined' && window.location.pathname === '/desktop/pos'
}

function currentDesktopPosStoreCode(): string {
  if (!isDesktopPosDeviceRuntime()) return ''
  return new URLSearchParams(window.location.search).get('storeCode')?.trim() ?? ''
}

/**
 * Explicit device-only transport. It never falls back to account identity or
 * generic development identity headers.
 */
export async function desktopPosDeviceFetch(input: string, init?: RequestInit) {
  const storeCode = currentDesktopPosStoreCode()
  if (!storeCode || !getPosDeviceToken(storeCode)) {
    throw new Error('POS_DEVICE_AUTH_REQUIRED')
  }

  const headers = new Headers(init?.headers)
  for (const [name, value] of Object.entries(posDeviceHeaders(storeCode))) {
    headers.set(name, value)
  }
  return fetch(input, { ...init, credentials: 'omit', headers })
}

export function readDesktopPosDeviceOrderDetail(orderNo: string) {
  return desktopPosDeviceFetch(
    `/api/es-tray-02/device/orders/${encodeURIComponent(orderNo)}`,
    { method: 'GET', cache: 'no-store' },
  )
}
