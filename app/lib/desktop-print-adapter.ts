'use client'

import type { Lang } from '@/app/components/LangProvider'
import { printDesktopReceipt, type DesktopReceiptData } from '@/app/components/DesktopReceipt'

export type RuntimeReceiptItemPayload = {
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export type RuntimeReceiptPayload = {
  schemaVersion: '1'
  receiptId: string
  saleId?: string
  orderNumber?: string
  storeName: string
  storeCode: string
  cashierName?: string
  timestamp: string
  currencyCode: string
  items: RuntimeReceiptItemPayload[]
  subtotal: number
  total: number
  paymentMethod?: string
  footer?: string
  language?: string
}

export type DesktopPrinterBridgeResult = {
  ok: boolean
  status: 'SUBMITTED' | 'FAILED' | 'TIMED_OUT' | 'PROVIDER_UNAVAILABLE' | 'PRINTER_NOT_CONFIGURED' | 'PRINTER_NOT_FOUND' | 'UNKNOWN'
  commandId?: string
  errorCode?: string
  message?: string
  effectBoundary?: string
}

export type ReceiptPrintResult = DesktopPrinterBridgeResult & {
  transport: 'runtime' | 'browser'
}

export type ReceiptPrintContext = {
  storeCode: string
  lang: Lang
  trigger: 'auto' | 'manual'
  onAfterPrint?: () => void
}

type DesktopPrinterBridge = {
  printReceipt: (payload: RuntimeReceiptPayload) => Promise<DesktopPrinterBridgeResult>
}

declare global {
  interface Window {
    eshopDesktopPrinter?: DesktopPrinterBridge
  }
}

const submittedPrintKeys = new Set<string>()
const inFlightPrintKeys = new Set<string>()

export async function printReceipt(receipt: DesktopReceiptData, context: ReceiptPrintContext): Promise<ReceiptPrintResult> {
  const runtime = getRuntimePrinter()
  if (!runtime) {
    printDesktopReceipt(receipt, context.lang, { onAfterPrint: context.onAfterPrint })
    return { ok: true, status: 'SUBMITTED', transport: 'browser' }
  }

  const payload = toRuntimeReceiptPayload(receipt, context)
  const printKey = receiptPrintKey(payload, context.trigger)
  if (submittedPrintKeys.has(printKey) || sessionStorage.getItem(printKey) === '1') {
    return { ok: false, status: 'UNKNOWN', errorCode: 'DUPLICATE_PRINT_SUPPRESSED', transport: 'runtime' }
  }
  if (inFlightPrintKeys.has(printKey)) {
    return { ok: false, status: 'UNKNOWN', errorCode: 'PRINTING', transport: 'runtime' }
  }

  inFlightPrintKeys.add(printKey)
  try {
    const result = await runtime.printReceipt(payload)
    if (result.ok || result.status === 'TIMED_OUT' || result.status === 'UNKNOWN') {
      submittedPrintKeys.add(printKey)
      sessionStorage.setItem(printKey, '1')
    }
    return { ...result, transport: 'runtime' }
  } finally {
    inFlightPrintKeys.delete(printKey)
  }
}

function getRuntimePrinter(): DesktopPrinterBridge | null {
  if (typeof window === 'undefined') return null
  const desktopWindow = window as Window & { eshopDesktopRuntime?: { isDesktop?: boolean; windowRole?: string } }
  if (!desktopWindow.eshopDesktopRuntime?.isDesktop || desktopWindow.eshopDesktopRuntime.windowRole !== 'employee') return null
  return window.eshopDesktopPrinter ?? null
}

function toRuntimeReceiptPayload(receipt: DesktopReceiptData, context: ReceiptPrintContext): RuntimeReceiptPayload {
  const currencyCode = receipt.currencyCode || 'USD'
  const receiptId = stableReceiptId(receipt)
  const subtotal = receipt.items.reduce((sum, item) => sum + finiteNumber(item.lineAmount), 0)
  const payload: RuntimeReceiptPayload = {
    schemaVersion: '1',
    receiptId,
    saleId: receipt.orderNo ?? receiptId,
    orderNumber: receipt.orderNo ?? undefined,
    storeName: clamp(receipt.storeName || 'Store', 120),
    storeCode: clamp(context.storeCode, 80),
    cashierName: receipt.cashierName ? clamp(receipt.cashierName, 80) : undefined,
    timestamp: receipt.createdAt,
    currencyCode: clamp(currencyCode, 12),
    items: receipt.items.slice(0, 200).map((item) => ({
      name: clamp([item.name, item.spec ? `(${item.spec})` : ''].filter(Boolean).join(' '), 160),
      quantity: positiveNumber(item.qty),
      unitPrice: finiteNumber(item.price),
      lineTotal: finiteNumber(item.lineAmount),
    })),
    subtotal,
    total: finiteNumber(receipt.totalAmount),
    paymentMethod: receipt.paymentMethod ? clamp(receipt.paymentMethod, 40) : undefined,
    footer: context.lang === 'km' ? 'សូមអរគុណ' : context.lang === 'en' ? 'Thank you' : '谢谢光临',
    language: context.lang,
  }
  validatePayload(payload)
  return payload
}

function receiptPrintKey(payload: RuntimeReceiptPayload, trigger: ReceiptPrintContext['trigger']) {
  return `receipt:${payload.saleId || payload.receiptId}:${trigger === 'auto' ? 'auto' : 'manual-initial'}:v1`
}

function stableReceiptId(receipt: DesktopReceiptData) {
  return clamp(receipt.orderNo || `receipt-${receipt.createdAt}-${receipt.totalAmount}`, 80).replace(/\s+/g, '-')
}

function validatePayload(payload: RuntimeReceiptPayload): void {
  if (payload.items.length < 1 || payload.items.length > 200) throw new Error('INVALID_PRINT_RECEIPT')
  if (!Number.isFinite(payload.total) || !Number.isFinite(payload.subtotal)) throw new Error('INVALID_PRINT_RECEIPT')
}

function clamp(value: string, maxLength: number) {
  return value.replace(/https?:\/\/\S+/g, '').replace(/<\/?[a-z][\s\S]*?>/gi, '').slice(0, maxLength)
}

function finiteNumber(value: number) {
  return Number.isFinite(value) ? value : 0
}

function positiveNumber(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 1
}
