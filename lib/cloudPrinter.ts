/**
 * lib/cloudPrinter.ts — SW-AIOT 云打印机最小闭环（v1）
 *
 * 目标：顾客下单成功 → 异步打印小票，失败不阻塞主链。
 *
 * 环境变量：
 *   SW_PRINTER_USERNAME  — 主账号用户名
 *   SW_PRINTER_SECRET    — API secret（用于生成 password 签名）
 *   SW_PRINTER_DEVID     — 打印机设备 ID
 *   SW_PRINTER_KEY       — 打印机 key
 *
 * 协议参考：
 *   password = MD5("secret=...&times=...&username=...").toUpperCase()
 *   POST https://open.sw-aiot.com/api/getToken      → 拿 token（24h 内缓存）
 *   POST https://open.sw-aiot.com/api/message/printMsg  → 实际打印
 *
 * 设计：
 *   - 所有调用 fire-and-forget；失败 console + runtime/print_logs（dev）+ DB OperationLog
 *   - tier 门控由调用方负责（仅 STANDARD / MULTI_STORE 启用自动打印）
 *   - 单文件 < 300 行
 */

import crypto from 'crypto'
import { prisma } from './prisma'

const USERNAME = process.env.SW_PRINTER_USERNAME ?? ''
const SECRET   = process.env.SW_PRINTER_SECRET   ?? ''
const DEVID    = process.env.SW_PRINTER_DEVID    ?? ''
const KEY      = process.env.SW_PRINTER_KEY      ?? ''

const TOKEN_API = 'https://open.sw-aiot.com/api/getToken'
const PRINT_API = 'https://open.sw-aiot.com/api/message/printMsg'

export function isPrinterConfigured(): boolean {
  return !!(USERNAME && SECRET && DEVID && KEY)
}

// ── token 缓存（内存级；Vercel cold start 会重置，无影响） ───────────────
let cachedToken: { token: string; expiresAt: number } | null = null

function md5Upper(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex').toUpperCase()
}

/** 按 SW-AIOT 协议生成签名：MD5(secret=...&times=...&username=...) 大写 */
export function generatePassword(times: number): string {
  return md5Upper(`secret=${SECRET}&times=${times}&username=${USERNAME}`)
}

export async function getPrinterToken(): Promise<string | null> {
  if (!isPrinterConfigured()) return null
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token

  const times = Math.floor(Date.now() / 1000)
  try {
    const r = await fetch(TOKEN_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: USERNAME,
        password: generatePassword(times),
        times,
      }),
    })
    const body = await r.json().catch(() => null) as Record<string, unknown> | null
    // 兼容多种返回字段命名（具体以厂商响应为准）
    const data = body?.data as Record<string, unknown> | undefined
    const token = (data?.token ?? body?.token ?? body?.access_token ?? null) as string | null
    if (token) {
      // 默认 23h 重用一次（小于厂商常用 24h），cold start 不影响
      cachedToken = { token: String(token), expiresAt: Date.now() + 23 * 3600 * 1000 }
      return cachedToken.token
    }
    console.warn('[cloudPrinter] getToken: no token in response', body)
    return null
  } catch (e) {
    console.error('[cloudPrinter] getToken error', e)
    return null
  }
}

/** 连通性 / 绑定状态检查；SW-AIOT 设备通常云端预绑定，本函数复用 token 拉取作为健康检查 */
export async function bindPrinterIfNeeded(): Promise<{ ok: boolean; error?: string }> {
  if (!isPrinterConfigured()) return { ok: false, error: 'PRINTER_NOT_CONFIGURED' }
  const token = await getPrinterToken()
  return token ? { ok: true } : { ok: false, error: 'TOKEN_FAILED' }
}

// ── 小票渲染 ──────────────────────────────────────────────────────────────

export type ReceiptItem = {
  name: string
  spec?: string | null
  quantity: number
  price: number
  lineAmount: number
}

export type ReceiptInput = {
  storeName: string
  orderNo: string
  items: ReceiptItem[]
  totalAmount: number
  remark?: string | null
  /** 可选二维码内容（顾客订单查询短链等） */
  qrPayload?: string | null
}

/** 通用 ESC/POS 风格文本（具体指令以厂商解析为准；v2 再细化字号/对齐） */
function buildReceiptText(input: ReceiptInput): string {
  const now = new Date().toLocaleString('zh-CN', { hour12: false })
  const lines: string[] = []
  lines.push('<C><B>店小二订单</B></C>')
  lines.push(`<C>${input.storeName}</C>`)
  lines.push('--------------------------------')
  lines.push(`单号: ${input.orderNo}`)
  lines.push(`时间: ${now}`)
  lines.push('--------------------------------')
  for (const it of input.items) {
    const nameLine = it.spec ? `${it.name} (${it.spec})` : it.name
    lines.push(nameLine)
    lines.push(`  x${it.quantity}   $${it.lineAmount.toFixed(2)}`)
  }
  lines.push('--------------------------------')
  lines.push(`<R><B>合计: $${input.totalAmount.toFixed(2)}</B></R>`)
  if (input.remark) {
    lines.push('--------------------------------')
    lines.push(`备注: ${input.remark}`)
  }
  if (input.qrPayload) {
    lines.push('--------------------------------')
    lines.push(`<QR>${input.qrPayload}</QR>`)
  }
  lines.push('<C>感谢惠顾</C>')
  lines.push('<CUT>')
  return lines.join('\n')
}

// ── 打印 ──────────────────────────────────────────────────────────────────

export async function printReceipt(
  input: ReceiptInput,
): Promise<{ ok: boolean; error?: string }> {
  if (!isPrinterConfigured()) return { ok: false, error: 'PRINTER_NOT_CONFIGURED' }
  const token = await getPrinterToken()
  if (!token) return { ok: false, error: 'TOKEN_FAILED' }

  const msg = buildReceiptText(input)
  try {
    const times = Math.floor(Date.now() / 1000)
    const r = await fetch(PRINT_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        devid: DEVID,
        key: KEY,
        msg,
        times,
      }),
    })
    const body = await r.json().catch(() => null) as Record<string, unknown> | null
    // 兼容多种"成功"返回（具体以厂商为准）
    const ok =
      r.ok &&
      (body?.code === 0 ||
        body?.code === '0' ||
        body?.success === true ||
        body?.status === 'ok')
    if (ok) return { ok: true }
    return {
      ok: false,
      error: (body?.message ?? body?.msg ?? body?.error ?? `HTTP ${r.status}`) as string,
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message ?? 'network error' }
  }
}

// ── 日志：runtime/print_logs（dev 写文件）+ OperationLog（DB，所有环境） ──

export async function logPrintAttempt(opts: {
  tenantId: string
  storeId?: string | null
  orderNo: string
  status: 'ok' | 'failed' | 'skipped'
  error?: string | null
  reason?: string  // 例如 'auto' / 'reprint' / 'test' / 'tier_lite'
}): Promise<void> {
  // 1) 控制台
  console.log('[print]', opts.status, opts.orderNo, opts.error ?? '')

  // 2) dev 文件日志（生产 serverless ephemeral，所以仅 dev 启用）
  if (process.env.NODE_ENV !== 'production') {
    try {
      const fs = await import('fs/promises')
      const path = await import('path')
      const dir = path.join(process.cwd(), 'runtime', 'print_logs', new Date().toISOString().slice(0, 10))
      await fs.mkdir(dir, { recursive: true })
      const file = path.join(dir, `${opts.orderNo}-${Date.now()}.json`)
      await fs.writeFile(file, JSON.stringify({ ...opts, at: new Date().toISOString() }, null, 2))
    } catch {
      /* silent */
    }
  }

  // 3) DB OperationLog（复用既有审计表，不新增 schema）
  try {
    await prisma.operationLog.create({
      data: {
        tenantId:   opts.tenantId,
        storeId:    opts.storeId ?? null,
        userId:     null,
        actionType: 'PRINT_RECEIPT',
        targetType: 'CustomerOrder',
        targetId:   opts.orderNo,
        status:     opts.status === 'ok' ? 'SUCCESS' : 'FAILED',
        message:    opts.error ?? opts.reason ?? null,
        payloadSnapshot: { reason: opts.reason ?? null, error: opts.error ?? null },
      },
    })
  } catch {
    /* silent — 日志失败不能影响业务 */
  }
}

// ── 自动打印（顾客下单成功后调用，tier 门控由调用方负责） ─────────────

export async function autoPrintCustomerOrder(opts: {
  tenantId: string
  storeId: string
  storeName: string
  orderNo: string
  items: ReceiptItem[]
  totalAmount: number
  remark?: string | null
  qrPayload?: string | null
}): Promise<void> {
  if (!isPrinterConfigured()) {
    await logPrintAttempt({
      tenantId: opts.tenantId,
      storeId: opts.storeId,
      orderNo: opts.orderNo,
      status: 'skipped',
      reason: 'PRINTER_NOT_CONFIGURED',
    })
    return
  }
  const result = await printReceipt(opts)
  await logPrintAttempt({
    tenantId: opts.tenantId,
    storeId: opts.storeId,
    orderNo: opts.orderNo,
    status: result.ok ? 'ok' : 'failed',
    error: result.ok ? undefined : (result.error ?? 'unknown'),
    reason: 'auto',
  })
}

// ── tier 门控辅助 ─────────────────────────────────────────────────────────

export function isPrintingTier(tier: string | null | undefined): boolean {
  return tier === 'STANDARD' || tier === 'MULTI_STORE'
}
