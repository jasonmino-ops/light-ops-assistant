/**
 * GET /api/health
 *
 * Structured system health check. Returns an array of checks each with
 * status PASS | WARN | FAIL, plus an overall status.
 *
 * Safe to call publicly — never exposes secrets or credentials.
 * Auth context is checked opportunistically (shows WARN if not authed).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

type Status = 'PASS' | 'WARN' | 'FAIL'

type Check = {
  key: string
  name: string
  status: Status
  detail: string
}

function overall(checks: Check[]): Status {
  if (checks.some((c) => c.status === 'FAIL')) return 'FAIL'
  if (checks.some((c) => c.status === 'WARN')) return 'WARN'
  return 'PASS'
}

export async function GET(req: NextRequest) {
  const checks: Check[] = []

  // ── 1. ENV: AUTH_SECRET ────────────────────────────────────────────────────
  const authSecret = process.env.AUTH_SECRET ?? ''
  if (!authSecret) {
    checks.push({ key: 'auth_secret', name: 'AUTH_SECRET', status: 'FAIL', detail: '未配置，Session 签名不安全' })
  } else if (authSecret === 'dev-secret-change-in-production' || authSecret.length < 16) {
    checks.push({ key: 'auth_secret', name: 'AUTH_SECRET', status: 'WARN', detail: '正在使用默认弱密钥，请在生产环境替换' })
  } else {
    checks.push({ key: 'auth_secret', name: 'AUTH_SECRET', status: 'PASS', detail: '已配置' })
  }

  // ── 2. ENV: TELEGRAM_BOT_TOKEN ────────────────────────────────────────────
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    checks.push({ key: 'bot_token', name: 'TELEGRAM_BOT_TOKEN', status: 'WARN', detail: '未配置，HMAC 验证已跳过（仅限开发）' })
  } else {
    checks.push({ key: 'bot_token', name: 'TELEGRAM_BOT_TOKEN', status: 'PASS', detail: '已配置，initData 验证开启' })
  }

  // ── 3. ENV: TENANT_ID ─────────────────────────────────────────────────────
  const tenantId = process.env.TENANT_ID ?? ''
  if (!tenantId) {
    checks.push({ key: 'tenant_id', name: 'TENANT_ID', status: 'WARN', detail: '未配置，使用默认 seed-tenant-001' })
  } else if (tenantId === 'seed-tenant-001') {
    checks.push({ key: 'tenant_id', name: 'TENANT_ID', status: 'WARN', detail: `当前值 ${tenantId}（种子租户，生产环境应使用正式 ID）` })
  } else {
    checks.push({ key: 'tenant_id', name: 'TENANT_ID', status: 'PASS', detail: tenantId })
  }

  // ── 4. ENV: TELEGRAM_BOT_USERNAME (merchant bot) ──────────────────────────
  // Must be the MERCHANT bot username (@qingdianboss_bot or similar), NOT the ops bot.
  if (!process.env.TELEGRAM_BOT_USERNAME) {
    checks.push({ key: 'bot_username', name: 'TELEGRAM_BOT_USERNAME（商户bot）', status: 'WARN', detail: '未配置，无法生成绑定二维码链接' })
  } else {
    checks.push({ key: 'bot_username', name: 'TELEGRAM_BOT_USERNAME（商户bot）', status: 'PASS', detail: `@${process.env.TELEGRAM_BOT_USERNAME}` })
  }

  // ── 4b. ENV: OPS_BOT_TOKEN — must differ from TELEGRAM_BOT_TOKEN ──────────
  // Ops bot and merchant bot must be separate bots with separate tokens.
  // If OPS_BOT_TOKEN is not set, ops auth falls back to TELEGRAM_BOT_TOKEN (shared bot mode).
  const opsBotToken = process.env.OPS_BOT_TOKEN?.trim() ?? ''
  const merchantBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? ''
  if (!opsBotToken) {
    checks.push({ key: 'ops_bot_token', name: 'OPS_BOT_TOKEN（运营bot）', status: 'WARN', detail: '未配置，ops 验签回退到商户 bot token（单 bot 模式）' })
  } else if (opsBotToken === merchantBotToken) {
    checks.push({ key: 'ops_bot_token', name: 'OPS_BOT_TOKEN（运营bot）', status: 'WARN', detail: '与 TELEGRAM_BOT_TOKEN 相同 — 商户 bot 与 ops bot 共用同一个 token，建议分开' })
  } else {
    checks.push({ key: 'ops_bot_token', name: 'OPS_BOT_TOKEN（运营bot）', status: 'PASS', detail: '已配置，与商户 bot token 不同 ✓' })
  }

  // ── 4c. ENV: STORE_OPEN_CODE — fixed "open store" QR entry code ──────────
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim() ?? ''
  const storeOpenCode = process.env.STORE_OPEN_CODE?.trim() ?? ''
  if (!storeOpenCode) {
    checks.push({ key: 'store_open_code', name: 'STORE_OPEN_CODE（开店验证码）', status: 'WARN', detail: '未配置，新商户自助开店功能不可用' })
  } else {
    const openLink = botUsername ? `https://t.me/${botUsername}?startapp=open` : '（需先配置 TELEGRAM_BOT_USERNAME）'
    checks.push({ key: 'store_open_code', name: 'STORE_OPEN_CODE（开店验证码）', status: 'PASS', detail: `已配置 · 固定开店码：${openLink}` })
  }

  // ── 5. Auth context ────────────────────────────────────────────────────────
  const ctx = await getContext(req)
  if (!ctx) {
    checks.push({ key: 'auth_ctx', name: '当前认证状态', status: 'WARN', detail: '未携带有效 Session，请先登录' })
  } else {
    checks.push({ key: 'auth_ctx', name: '当前认证状态', status: 'PASS', detail: `${ctx.role} · userId ${ctx.userId.slice(-6)}` })
  }

  // ── 6. DB + data checks ────────────────────────────────────────────────────
  if (!process.env.DATABASE_URL) {
    checks.push({ key: 'db', name: '数据库连接', status: 'FAIL', detail: 'DATABASE_URL 未配置' })
    checks.push({ key: 'bound_users', name: '已绑定用户数', status: 'FAIL', detail: '数据库未连接，无法查询' })
    checks.push({ key: 'products', name: '商品数量', status: 'FAIL', detail: '数据库未连接，无法查询' })
  } else {
    try {
      // Single query — avoid opening multiple connections for a health check
      type Row = { user_count: bigint; bound_count: bigint; product_count: bigint }
      const [row] = await prisma.$queryRaw<Row[]>`
        SELECT
          COUNT(*)                                            AS user_count,
          COUNT(*) FILTER (WHERE "telegramId" IS NOT NULL)   AS bound_count,
          (SELECT COUNT(*) FROM "Product" WHERE status = 'ACTIVE') AS product_count
        FROM "User"
        WHERE status = 'ACTIVE'
      `
      const userCount    = Number(row.user_count)
      const boundCount   = Number(row.bound_count)
      const productCount = Number(row.product_count)

      checks.push({ key: 'db', name: '数据库连接', status: 'PASS', detail: `连接正常，${userCount} 个用户，${productCount} 件商品` })

      checks.push({
        key: 'bound_users', name: '已绑定用户数',
        status: boundCount === 0 ? 'WARN' : 'PASS',
        detail: boundCount === 0 ? `${boundCount} / ${userCount}，无已绑定账号` : `${boundCount} / ${userCount}`,
      })

      checks.push({
        key: 'products', name: '商品数量',
        status: productCount === 0 ? 'WARN' : 'PASS',
        detail: productCount === 0 ? '暂无上架商品，销售功能将无法使用' : `${productCount} 件上架商品`,
      })
    } catch (e) {
      const msg = String(e).replace(/postgres(ql)?:\/\/[^@]+@/gi, 'postgres://***@')
      checks.push({ key: 'db', name: '数据库连接', status: 'FAIL', detail: msg.slice(0, 120) })
      checks.push({ key: 'bound_users', name: '已绑定用户数', status: 'FAIL', detail: '数据库连接失败' })
      checks.push({ key: 'products', name: '商品数量', status: 'FAIL', detail: '数据库连接失败' })
    }
  }

  const status = overall(checks)
  return NextResponse.json({ status, checks }, { status: status === 'FAIL' ? 503 : 200 })
}
