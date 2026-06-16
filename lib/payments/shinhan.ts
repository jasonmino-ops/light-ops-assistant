import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getShinhanPaymentConfig, isShinhanConfigured, type ShinhanPaymentConfig } from './shinhan-config'

export type ShinhanCurrency = 'USD' | 'KHR'

export type ShinhanCallback = {
  trxId: string
  txId?: string
  timestamp?: string
  trxCode?: string
  txnCode?: string
  responseCode?: string
  respondCode?: string
  responseMessage?: string
  respondMessage?: string
  paymentAmount?: string
  raw: Record<string, unknown>
}

type DeeplinkInput = {
  paymentId: string
  trxId: string
  amount: string
  currency: ShinhanCurrency
  note?: string
}

type InquiryInput = {
  trxId: string
}

function cleanBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

export function formatShinhanAmount(value: number | string): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) throw new Error('INVALID_AMOUNT')
  return n.toFixed(2)
}

export function assertShinhanCurrency(value: string): asserts value is ShinhanCurrency {
  if (value !== 'USD' && value !== 'KHR') throw new Error('INVALID_CURRENCY')
}

export function buildShinhanHash(args: {
  merchantId: string
  merchantName: string
  trxId: string
  amount: string
  currency: ShinhanCurrency
  timestamp: string
  secretKey: string
}): string {
  const plain = [
    args.merchantId,
    args.merchantName,
    args.trxId,
    args.amount,
    args.currency,
    args.timestamp,
  ].join('.')
  return crypto.createHmac('sha512', args.secretKey).update(plain).digest('base64')
}

export function buildShinhanCallbackUrl(cfg: ShinhanPaymentConfig = getShinhanPaymentConfig()): string {
  const base = cleanBaseUrl(cfg.callbackBaseUrl || '')
  if (!base) return '/api/payments/shinhan/callback'
  return `${base}/api/payments/shinhan/callback`
}

export function normalizeShinhanCallback(payload: Record<string, unknown>): ShinhanCallback {
  const value = (a: string, b?: string) => {
    const raw = payload[a] ?? (b ? payload[b] : undefined)
    return raw == null ? undefined : String(raw)
  }
  const trxId = value('trxId', 'txId') ?? ''
  return {
    trxId,
    txId: value('txId'),
    timestamp: value('timestamp'),
    trxCode: value('trxCode'),
    txnCode: value('txnCode'),
    responseCode: value('responseCode', 'respondCode'),
    respondCode: value('respondCode'),
    responseMessage: value('responseMessage', 'respondMessage'),
    respondMessage: value('respondMessage'),
    paymentAmount: value('paymentAmount'),
    raw: payload,
  }
}

export function isShinhanPaidCallback(cb: ShinhanCallback): boolean {
  const code = cb.responseCode ?? cb.respondCode
  return code === '200'
}

export async function createShinhanDeeplinkPayment(input: DeeplinkInput) {
  const cfg = getShinhanPaymentConfig()
  if (!isShinhanConfigured(cfg)) {
    throw new Error(cfg.enabled ? 'SHINHAN_NOT_CONFIGURED' : 'SHINHAN_DISABLED')
  }

  const timestamp = new Date().toISOString()
  const callbackApiUrl = buildShinhanCallbackUrl(cfg)
  const merchantId = cfg.merchantId || 'MOCK_MERCHANT'
  const merchantName = cfg.merchantName || 'Mock Merchant'
  const requestPayload = {
    merchantId,
    merchantName,
    amount: input.amount,
    currency: input.currency,
    trxId: input.trxId,
    callbackApiUrl,
    note: input.note ?? '',
    remark: input.note ?? '',
    timestamp,
    hash: cfg.secretKey
      ? buildShinhanHash({
          merchantId,
          merchantName,
          trxId: input.trxId,
          amount: input.amount,
          currency: input.currency,
          timestamp,
          secretKey: cfg.secretKey,
        })
      : 'mock-hash',
  }

  if (cfg.mockMode) {
    const deepLinkUrl = `shinhan-sol://payment?trxId=${encodeURIComponent(input.trxId)}&amount=${encodeURIComponent(input.amount)}&currency=${input.currency}`
    return {
      deepLinkUrl,
      callbackApiUrl,
      requestPayload,
      responsePayload: {
        response: { code: '200', message: 'MOCK_SUCCESS' },
        result: { trxId: input.trxId, deepLinkUrl },
      },
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(`${cleanBaseUrl(cfg.baseUrl)}/api/payment/deeplink`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': cfg.apiKey,
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    })
    const responsePayload = await res.json().catch(() => ({ response: { code: String(res.status), message: res.statusText } }))
    const deepLinkUrl = responsePayload?.result?.deepLinkUrl
    if (!res.ok || typeof deepLinkUrl !== 'string' || !deepLinkUrl) {
      const msg = responsePayload?.response?.message ?? `HTTP_${res.status}`
      const error = new Error(String(msg))
      error.name = 'SHINHAN_CREATE_FAILED'
      throw error
    }
    return { deepLinkUrl, callbackApiUrl, requestPayload, responsePayload }
  } finally {
    clearTimeout(timer)
  }
}

export async function inquireShinhanTransaction(input: InquiryInput) {
  const cfg = getShinhanPaymentConfig()
  if (!isShinhanConfigured(cfg)) {
    throw new Error(cfg.enabled ? 'SHINHAN_NOT_CONFIGURED' : 'SHINHAN_DISABLED')
  }

  if (cfg.mockMode) {
    return {
      response: { code: '200', message: 'MOCK_SUCCESS' },
      result: {
        trxId: input.trxId,
        responseCode: '200',
        responseMessage: 'MOCK_PAID',
      },
    }
  }

  const timestamp = new Date().toISOString()
  const body = {
    merchantId: cfg.merchantId,
    merchantName: cfg.merchantName,
    trxId: input.trxId,
    timestamp,
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(`${cleanBaseUrl(cfg.baseUrl)}/api/transaction/inquiry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': cfg.apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    return await res.json().catch(() => ({ response: { code: String(res.status), message: res.statusText } }))
  } finally {
    clearTimeout(timer)
  }
}

export async function markPaymentPaidIfValid(args: {
  trxId: string
  amount?: string | number | null
  payload: Record<string, unknown>
  source: 'callback' | 'inquiry'
}) {
  const tx = await prisma.paymentTransaction.findUnique({ where: { trxId: args.trxId } })
  if (!tx) return { ok: false, errorCode: 'PAYMENT_NOT_FOUND' }
  if (tx.status === 'PAID') return { ok: true, alreadyPaid: true, payment: tx }

  if (args.amount != null && args.amount !== '') {
    const got = Number(args.amount)
    const expected = Number(tx.amount)
    if (!Number.isFinite(got) || Math.abs(got - expected) > 0.01) {
      await prisma.paymentTransaction.update({
        where: { id: tx.id },
        data: {
          status: 'FAILED',
          errorCode: 'AMOUNT_MISMATCH',
          errorMessage: `Expected ${expected.toFixed(2)}, got ${String(args.amount)}`,
          ...(args.source === 'callback'
            ? { callbackPayload: args.payload as Prisma.InputJsonValue }
            : { inquiryPayload: args.payload as Prisma.InputJsonValue }),
        },
      })
      return { ok: false, errorCode: 'AMOUNT_MISMATCH' }
    }
  }

  const paidAt = new Date()
  const updated = await prisma.$transaction(async (db) => {
    const payment = await db.paymentTransaction.update({
      where: { id: tx.id },
      data: {
        status: 'PAID',
        providerTrxCode: String(args.payload.trxCode ?? args.payload.txnCode ?? tx.providerTrxCode ?? ''),
        errorCode: null,
        errorMessage: null,
        paidAt,
        ...(args.source === 'callback'
          ? { callbackPayload: args.payload as Prisma.InputJsonValue, signatureVerified: false }
          : { inquiryPayload: args.payload as Prisma.InputJsonValue }),
      },
    })
    if (tx.customerOrderId) {
      await db.customerOrder.update({
        where: { id: tx.customerOrderId },
        data: {
          status: 'COMPLETED',
          paymentStatus: 'PAID',
          paymentMethod: 'SHINHAN',
          paidAt,
          paidAmount: tx.amount,
        },
      })
    }
    return payment
  })
  return { ok: true, payment: updated }
}
