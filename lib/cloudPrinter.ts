/**
 * lib/cloudPrinter.ts — SW-AIOT 云打印 v1
 * env: SW_PRINTER_USERNAME / SECRET / DEVID / KEY
 * password = MD5("secret=...&times=...&username=...").toUpperCase()
 * times 为 13 位毫秒级时间戳（与商为开放平台规范一致）
 * /api/getToken（缓存 23h）→ /api/message/printMsg
 * tier 门控由调用方负责；失败 fire-and-forget 写 OperationLog
 */

import crypto from 'crypto'
import { prisma } from './prisma'

const USERNAME = process.env.SW_PRINTER_USERNAME ?? ''
const SECRET   = process.env.SW_PRINTER_SECRET   ?? ''
const DEVID    = process.env.SW_PRINTER_DEVID    ?? ''
const KEY      = process.env.SW_PRINTER_KEY      ?? ''

const TOKEN_API = 'https://open.sw-aiot.com/api/getToken'
const PRINT_API = 'https://open.sw-aiot.com/api/message/printMsg'
const BIND_API  = 'https://open.sw-aiot.com/api/device/bindPrint'

export function isPrinterConfigured(): boolean {
  return !!(USERNAME && SECRET && DEVID && KEY)
}

// ── token 缓存（内存级；Vercel cold start 会重置，无影响） ───────────────
let cachedToken: { token: string; expiresAt: number } | null = null

function md5Upper(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex').toUpperCase()
}

function maskSecret(s: string): string {
  return s.length > 8 ? `${s.slice(0, 4)}***${s.slice(-4)}` : '***'
}

/** 按 SW-AIOT 协议生成签名：MD5(secret=...&times=...&username=...) 大写
 *  times 必须为 13 位毫秒级时间戳（与商为开放平台规范一致） */
export function generatePassword(times: number): string {
  return md5Upper(`secret=${SECRET}&times=${times}&username=${USERNAME}`)
}

export type TokenDiag = {
  username: string
  times: number          // 13 位毫秒
  signSource: string     // secret=****&times=xxx&username=xxx（secret 脱敏）
  md5: string
  httpStatus?: number
  rawBody?: unknown
  errorMessage?: string
  cached?: boolean
  configured: boolean
}

/**
 * 获取 token 并附带诊断信息（用于 /api/print/status?diagnose=1 排障）。
 * force=true 时跳过内存缓存强制重新拉取。
 */
export async function getPrinterTokenWithDiag(
  force = false,
): Promise<{ token: string | null; diag: TokenDiag }> {
  const username = USERNAME
  const times = Date.now() // 13 位毫秒（修复 TOKEN_FAILED 根因）
  const md5 = generatePassword(times)
  const signSource = `secret=${maskSecret(SECRET)}&times=${times}&username=${username}`
  const baseDiag: TokenDiag = { username, times, signSource, md5, configured: isPrinterConfigured() }

  if (!isPrinterConfigured()) {
    return { token: null, diag: { ...baseDiag, errorMessage: 'PRINTER_NOT_CONFIGURED' } }
  }

  if (force) cachedToken = null
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return { token: cachedToken.token, diag: { ...baseDiag, cached: true } }
  }

  try {
    const r = await fetch(TOKEN_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: md5, times }),
    })
    const httpStatus = r.status
    const body = await r.json().catch(() => null) as Record<string, unknown> | null
    const data = body?.data as Record<string, unknown> | undefined
    const token = (data?.token ?? body?.token ?? body?.access_token ?? null) as string | null
    if (token) {
      cachedToken = { token: String(token), expiresAt: Date.now() + 23 * 3600 * 1000 }
      return { token: cachedToken.token, diag: { ...baseDiag, httpStatus, rawBody: body } }
    }
    const errorMessage = String(
      (body?.message ?? body?.msg ?? body?.error ?? `no token in response (HTTP ${httpStatus})`) ?? 'unknown',
    )
    console.error('[cloudPrinter] getToken failed', { ...baseDiag, httpStatus, rawBody: body, errorMessage })
    return { token: null, diag: { ...baseDiag, httpStatus, rawBody: body, errorMessage } }
  } catch (e) {
    const errorMessage = (e as Error).message ?? 'network error'
    console.error('[cloudPrinter] getToken error', { ...baseDiag, errorMessage })
    return { token: null, diag: { ...baseDiag, errorMessage } }
  }
}

/** 业务路径调用（不需要 diag） */
export async function getPrinterToken(): Promise<string | null> {
  const { token } = await getPrinterTokenWithDiag(false)
  return token
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
    const times = Date.now() // 13 位毫秒，与 token 接口口径一致
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

// ── 设备绑定确认（排查离线/未绑定，复用 getPrinterTokenWithDiag） ────────

export type BindDeviceResult = {
  ok: boolean
  httpStatus?: number
  rawBody?: unknown
  errorMessage?: string
  tokenDiag?: TokenDiag  // 拿 token 阶段失败时附上诊断
  request?: { devid: string; key: string; pwidth: number; timeout: number; nickname: string }
}

export async function bindDevice(opts: {
  pwidth?: number      // 默认 58
  timeout?: number     // 默认 600
  nickname?: string    // 默认 '店小二_测试打印机'
}): Promise<BindDeviceResult> {
  const pwidth   = opts.pwidth   ?? 58
  const timeout  = opts.timeout  ?? 600
  const nickname = opts.nickname ?? '店小二_测试打印机'
  const request  = { devid: DEVID, key: KEY, pwidth, timeout, nickname }

  if (!isPrinterConfigured()) {
    return { ok: false, errorMessage: 'PRINTER_NOT_CONFIGURED', request }
  }

  // 复用既有 token 获取链路；失败回传诊断
  const tokenResult = await getPrinterTokenWithDiag(false)
  if (!tokenResult.token) {
    return { ok: false, errorMessage: 'TOKEN_FAILED', tokenDiag: tokenResult.diag, request }
  }

  try {
    const r = await fetch(BIND_API, {
      method: 'POST',
      headers: {
        token: tokenResult.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })
    const httpStatus = r.status
    const body = await r.json().catch(() => null) as Record<string, unknown> | null
    const ok =
      r.ok &&
      (body?.code === 0 || body?.code === '0' || body?.success === true || body?.status === 'ok')
    if (ok) return { ok: true, httpStatus, rawBody: body, request }
    return {
      ok: false,
      httpStatus,
      rawBody: body,
      errorMessage: String(body?.message ?? body?.msg ?? body?.error ?? `HTTP ${httpStatus}`),
      request,
    }
  } catch (e) {
    return { ok: false, errorMessage: (e as Error).message ?? 'network error', request }
  }
}

export function isPrintingTier(tier: string | null | undefined): boolean {
  return tier === 'STANDARD' || tier === 'MULTI_STORE'
}
