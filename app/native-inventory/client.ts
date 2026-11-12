'use client'

import { useEffect, useState } from 'react'
import { posDeviceHeaders } from '@/lib/desktop-pos-client'

export type Access = { role: 'OWNER' | 'RECEIVER'; currencyCode: string; storeName: string; storeId: string; userId: string }
export type Unit = { id: string; name: string; factor: string; barcode: string | null }
export type Item = {
  id: string
  name: string
  productId: string | null
  kind: 'PRODUCT' | 'MATERIAL'
  tracked: boolean
  sku: string | null
  onHand: string
  lowStock: boolean
  sellPrice: string | null
  averageUnitCost?: string | null
  units: Unit[]
}
export type Supplier = { id: string; name: string; contact: string | null; postedCount?: number; purchaseTotal?: string }
export type Line = { itemId: string; unitId: string; itemName: string; unitName: string; quantity: string; unitPrice: string; amount: string; baseQty: string; lineNo: number }
export type Receipt = {
  id: string
  revision: number
  supplierId: string
  supplier: { name: string }
  createdAt: string
  postedAt: string | null
  createdBy: string
  total: string
  currencyCode: string
  lines: Line[]
}
export type Movement = { sourceId: string; type: string; quantity: string; balance: string; unitCost: string | null; reason: string | null; createdAt: string }
export type Profit = { itemId: string; name: string; category: string | null; quantity: string; revenue: string | null; cost: string | null; profit: string | null; marginPercent: string | null; unknownCostCount: number; currencyMismatchCount: number }
export type Purchases = { supplier: Supplier; totals: { currencyCode: string; _sum: { total: string }; _count: number }[]; receipts: Receipt[] }
export type DraftLine = Pick<Line, 'itemId' | 'unitId' | 'itemName' | 'unitName' | 'quantity' | 'unitPrice'> & { oldCost?: string | null; sellPrice?: string | null; imported?: boolean; units?: Unit[] }
export type Draft = { id: string; supplierId: string; revision: number; lines: DraftLine[] }

export class RequestError extends Error {
  constructor(readonly code: string, readonly unknown = false) {
    super(code)
  }
}

const errorText: Record<string, string> = {
  PERSON_REQUIRED: '请登录后再访问进销存。',
  PERSON_PROOF_REQUIRED: '请通过 Telegram 打开以验证操作人员身份。',
  PERSON_PROOF_INVALID: 'Telegram 验证已过期，请从 Telegram 重新打开。',
  DESKTOP_DEVICE_REQUIRED: '请先完成本门店的桌面设备授权。',
  DESKTOP_OPERATOR_REQUIRED: '请重新验证当前桌面操作员。',
  DESKTOP_OPERATOR_REVOKED: '该操作员已失去本门店进销存权限，请重新配对。',
  DESKTOP_PAIRING_INVALID: '配对码无效、已使用或不属于当前门店。',
  NATIVE_INVENTORY_DISABLED: '当前门店尚未开通原生库存。',
  RECEIVING_ACCESS_DENIED: '当前账号没有入库权限。',
  OWNER_REQUIRED: '此操作需要店主权限。',
  STOCK_CHANGED: '库存已变化，请关闭详情后重新打开核对。',
  RECEIPT_REVISION_CONFLICT: '单据已更新，请从入库记录重新打开。',
  INVALID_RECEIPT_LINES: '请录入 1–100 行有效商品。',
  INVALID_DECIMAL: '请核对数量和金额。',
  INVALID_BASE_QUANTITY: '换算后的数量超出支持范围。',
  INVENTORY_CURRENCY_MISMATCH: '门店币种已变化，请先核对库存账本币种。',
  CHECK_OPERATION_STATUS: '结果暂时无法确认，请查询原请求。',
}
export function message(error: unknown) {
  return error instanceof RequestError ? (errorText[error.code] ?? '请求失败，请核对资料后重试。') : '暂时无法读取数据，请重试。'
}

export function path(resource: string, query: Record<string, string> = {}) {
  const search = new URLSearchParams(query).toString()
  return resource + (search ? '?' + search : '')
}

export function telegramInitData() {
  return (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData
}

export function isInventoryDesktop() {
  const url = new URL(window.location.href)
  const host = window as Window & { eshopDesktopRuntime?: { isDesktop?: boolean } }
  return host.eshopDesktopRuntime?.isDesktop === true || url.pathname === '/desktop/inventory' ||
    url.searchParams.get('from') === 'desktop'
}

let desktopClaim: string | null = null

export function setDesktopInventoryClaim(claim: string) {
  desktopClaim = claim
}

export async function endDesktopInventoryClaim() {
  if (!desktopClaim) return
  const headers = desktopInventoryHeaders()
  desktopClaim = null
  await fetch('/api/native-inventory/desktop-operator', {
    method: 'POST', body: JSON.stringify({ action: 'end' }), keepalive: true,
    headers: { ...headers, 'content-type': 'application/json' },
  })
}

export function desktopInventoryHeaders() {
  const storeCode = new URL(window.location.href).searchParams.get('storeCode') || localStorage.getItem('cashier:lastStoreCode')
  return {
    ...posDeviceHeaders(storeCode),
    'x-lightops-client': 'desktop-pos',
    ...(desktopClaim ? { 'x-inventory-operator': desktopClaim } : {}),
  }
}

export async function request<T>(resource: string, body?: object, signal?: AbortSignal): Promise<T> {
  const desktop = isInventoryDesktop()
  const tg = desktop ? undefined : telegramInitData()
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(abort, 18000)
  try {
    const response = await fetch('/api/native-inventory/' + resource, {
      method: body === undefined ? 'GET' : 'PUT',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        ...(tg ? { 'x-telegram-init-data': tg } : {}),
        ...(desktop ? desktopInventoryHeaders() : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const result = await response.json()
    if (response.ok && result.outcome === 'SUCCESS') return result.data
    if (result.outcome === 'FAILED' || result.outcome === 'UNKNOWN') {
      throw new RequestError(result.error, result.outcome === 'UNKNOWN')
    }
    throw new RequestError('CHECK_OPERATION_STATUS', body !== undefined)
  } catch (error) {
    if (error instanceof RequestError) throw error
    throw new RequestError(body === undefined ? 'INVENTORY_UNAVAILABLE' : 'CHECK_OPERATION_STATUS', body !== undefined)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

export function useInventory<T>(resource: string | null, refresh = 0) {
  const [response, setResponse] = useState<{ key: string; data?: T; error?: unknown }>()
  const key = resource && `${resource}#${refresh}`
  useEffect(() => {
    if (!resource || !key) return
    const controller = new AbortController()
    request<T>(resource, undefined, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setResponse({ key, data }) },
      (error) => { if (!controller.signal.aborted) setResponse({ key, error }) },
    )
    return () => controller.abort()
  }, [key, resource])
  return response?.key === key ? response : undefined
}

export function money(amount: string | number | null | undefined, currency: string) {
  if (amount == null || !Number.isFinite(Number(amount))) return '—'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount))
}

export function dateLabel(date: string) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Phnom_Penh', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(date))
}

export function period(range: string, now = new Date()) {
  const local = new Date(now.getTime() + 7 * 3600000)
  local.setUTCHours(0, 0, 0, 0)
  const until = new Date(local.getTime() + 17 * 3600000).toISOString()
  if (range === '本周') local.setUTCDate(local.getUTCDate() - (local.getUTCDay() + 6) % 7)
  if (range === '本月') local.setUTCDate(1)
  return { from: new Date(local.getTime() - 7 * 3600000).toISOString(), until }
}

export function receiptNumber(id: string) {
  return 'RK-' + id.slice(0, 8).toUpperCase()
}
