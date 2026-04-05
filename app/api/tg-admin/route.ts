/**
 * POST /api/tg-admin  — Telegram webhook for internal admin bot
 *
 * Only whitelisted Telegram IDs (TG_ADMIN_IDS env, comma-separated) can use this.
 *
 * Webhook setup (run once after deploy):
 *   curl "https://api.telegram.org/bot<TG_BOT_TOKEN>/setWebhook" \
 *     -d "url=https://<your-domain>/api/tg-admin" \
 *     -d "secret_token=<TG_WEBHOOK_SECRET>"
 *
 * Required env vars:
 *   TG_BOT_TOKEN         — from @BotFather
 *   TG_ADMIN_IDS         — comma-separated Telegram user IDs allowed to use admin commands
 *   TG_WEBHOOK_SECRET    — random string used to verify requests come from Telegram
 *   TELEGRAM_BOT_USERNAME — bot username (without @), used to build deep links
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import QRCode from 'qrcode'

const BOT_TOKEN = process.env.TG_BOT_TOKEN ?? ''
const WEBHOOK_SECRET = process.env.TG_WEBHOOK_SECRET ?? ''
// Strip leading '@' — env vars are sometimes set as "@qingdianboss_bot" which
// produces https://t.me/@username and triggers "user doesn't seem to exist" in Telegram.
const BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME ?? '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '')
const ADMIN_IDS = new Set(
  (process.env.TG_ADMIN_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
)

// ─── Telegram API helpers ──────────────────────────────────────────────────────

async function tgFetch(method: string, init: RequestInit) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, init)
}

async function sendText(chatId: number, html: string) {
  await tgFetch('sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML' }),
  })
}

async function sendQR(chatId: number, url: string, caption: string) {
  const buf = await QRCode.toBuffer(url, { width: 320, margin: 2 })
  const form = new FormData()
  form.append('chat_id', String(chatId))
  form.append('caption', caption)
  form.append('parse_mode', 'HTML')
  form.append('photo', new Blob([buf as unknown as BlobPart], { type: 'image/png' }), 'qr.png')
  await tgFetch('sendPhoto', { method: 'POST', body: form })
}

// ─── Admin context from DB ─────────────────────────────────────────────────────

async function getAdminCtx(tgId: string) {
  const user = await prisma.user.findFirst({
    where: { telegramId: tgId, status: 'ACTIVE' },
    include: {
      storeRoles: {
        where: { status: 'ACTIVE' },
        take: 1,
        include: { store: true },
      },
    },
  })
  if (!user) return null
  return {
    user,
    tenantId: user.tenantId,
    store: user.storeRoles[0]?.store ?? null,
  }
}

// ─── Command: /genowner | /genstaff ───────────────────────────────────────────

async function cmdGenCode(chatId: number, role: 'OWNER' | 'STAFF', tgId: string) {
  // Guard: require TELEGRAM_BOT_USERNAME to be configured; otherwise the link
  // would be https://t.me/?startapp=... which Telegram rejects as invalid.
  if (!BOT_USERNAME) {
    await sendText(chatId, '❌ 未配置 TELEGRAM_BOT_USERNAME，无法生成有效链接。请在环境变量中设置商户 bot 用户名（不带 @）。')
    return
  }

  const ctx = await getAdminCtx(tgId)
  if (!ctx?.store) {
    await sendText(chatId, '❌ 未找到你的店铺信息，请确认账号已绑定。')
    return
  }

  const token = crypto.randomBytes(20).toString('hex')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

  // Revoke any existing ACTIVE tokens for this store+role so old links are immediately invalid
  await prisma.bindToken.updateMany({
    where: { storeId: ctx.store.id, tenantId: ctx.tenantId, role, status: 'ACTIVE' },
    data: { status: 'REVOKED' },
  })

  await prisma.bindToken.create({
    data: {
      token,
      tenantId: ctx.tenantId,
      storeId: ctx.store.id,
      role,
      label: `Bot-${role}-${new Date().toISOString().slice(0, 10)}`,
      expiresAt,
      maxUses: 1,
    },
  })

  const tgLink = `https://t.me/${BOT_USERNAME}?startapp=bind_${token}`
  const expStr = expiresAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  const roleLabel = role === 'OWNER' ? '👑 老板' : '👤 员工'

  const caption = [
    `✅ <b>${roleLabel}绑定码</b>`,
    `🏪 店铺：${ctx.store.name}`,
    `⏰ 有效至：${expStr}（北京时间）`,
    `🔢 次数：单次使用`,
    ``,
    `🔗 <code>${tgLink}</code>`,
    ``,
    `扫描二维码或点击链接在 Telegram 中完成绑定`,
  ].join('\n')

  await sendQR(chatId, tgLink, caption)
}

// ─── Command: /members ─────────────────────────────────────────────────────────

async function cmdMembers(chatId: number, tgId: string) {
  const ctx = await getAdminCtx(tgId)
  if (!ctx) {
    await sendText(chatId, '❌ 未找到你的账号信息。')
    return
  }

  const users = await prisma.user.findMany({
    where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      telegramId: true,
      storeRoles: {
        where: { status: 'ACTIVE' },
        take: 1,
        select: { store: { select: { name: true } } },
      },
    },
  })

  if (users.length === 0) {
    await sendText(chatId, '暂无成员记录。')
    return
  }

  const lines = users.map((u, i) => {
    const bound = u.telegramId ? '🟢' : '🔴'
    const roleLabel = u.role === 'OWNER' ? '老板' : '员工'
    const store = u.storeRoles[0]?.store.name ?? '—'
    const name = u.displayName || u.username || '—'
    return [
      `${i + 1}. ${bound} <b>${name}</b> [${roleLabel}] · ${store}`,
      `   ID: <code>${u.id}</code>`,
    ].join('\n')
  })

  const header = `<b>成员列表</b>（${users.length} 人）\n🟢 已绑定 Telegram  🔴 未绑定\n`
  await sendText(chatId, header + '\n' + lines.join('\n\n'))
}

// ─── Command: /unbind <user_id> ────────────────────────────────────────────────

async function cmdUnbind(chatId: number, targetId: string, tgId: string) {
  if (!targetId) {
    await sendText(
      chatId,
      '用法：/unbind &lt;用户ID&gt;\n\n用 /members 查看完整用户 ID（复制 ID 字段）。',
    )
    return
  }

  const ctx = await getAdminCtx(tgId)
  if (!ctx) {
    await sendText(chatId, '❌ 未找到你的账号信息。')
    return
  }

  if (targetId === ctx.user.id) {
    await sendText(chatId, '❌ 不能解绑自己的账号。')
    return
  }

  const target = await prisma.user.findFirst({
    where: { id: targetId, tenantId: ctx.tenantId, status: 'ACTIVE' },
  })

  if (!target) {
    await sendText(chatId, '❌ 未找到该用户，请确认 ID 是否正确（完整 UUID）。')
    return
  }

  if (!target.telegramId) {
    await sendText(
      chatId,
      `⚠️ 用户 <b>${target.displayName || target.username}</b> 尚未绑定 Telegram，无需解绑。`,
    )
    return
  }

  // Follow the same unbind rules as the API routes: clear telegramId, mark user
  // DISABLED, and revoke all store roles so the old session cookie is immediately
  // invalidated. The user record is preserved for audit history.
  await prisma.$transaction([
    prisma.user.update({ where: { id: targetId }, data: { telegramId: null, status: 'DISABLED' } }),
    prisma.userStoreRole.updateMany({ where: { userId: targetId }, data: { status: 'DISABLED' } }),
  ])
  await sendText(
    chatId,
    `✅ 已解绑 <b>${target.displayName || target.username}</b> 的 Telegram 账号。\n他们可重新扫码绑定。`,
  )
}

// ─── Main webhook handler ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleUpdate(update: any) {
  const msg = update?.message
  if (!msg?.text) return

  const chatId: number = msg.chat.id
  const fromId: string = String(msg.from?.id ?? '')
  const text: string = msg.text.trim()

  if (!ADMIN_IDS.has(fromId)) {
    await sendText(chatId, '⛔ 无权限访问管理后台。')
    return
  }

  const [cmd, ...args] = text.split(/\s+/)

  switch (cmd) {
    case '/start':
    case '/help':
      await sendText(chatId, [
        '🛠 <b>E-shop 店小二助手管理后台</b>',
        '',
        '/genowner — 生成老板绑定码（24h · 单次）',
        '/genstaff — 生成员工绑定码（24h · 单次）',
        '/members — 查看成员 &amp; 绑定状态',
        '/unbind &lt;用户ID&gt; — 解绑指定成员',
      ].join('\n'))
      break
    case '/genowner':
      await cmdGenCode(chatId, 'OWNER', fromId)
      break
    case '/genstaff':
      await cmdGenCode(chatId, 'STAFF', fromId)
      break
    case '/members':
      await cmdMembers(chatId, fromId)
      break
    case '/unbind':
      await cmdUnbind(chatId, args[0] ?? '', fromId)
      break
    default:
      await sendText(chatId, '未知命令，发送 /help 查看可用命令。')
  }
}

export async function POST(req: NextRequest) {
  if (WEBHOOK_SECRET) {
    const secret = req.headers.get('x-telegram-bot-api-secret-token')
    if (secret !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }
  }

  if (!BOT_TOKEN) {
    return NextResponse.json({ error: 'BOT_NOT_CONFIGURED' }, { status: 500 })
  }

  try {
    const update = await req.json()
    await handleUpdate(update)
  } catch (e) {
    console.error('[tg-admin] webhook error:', e)
  }

  // Always return 200 to Telegram (avoid retry storms)
  return NextResponse.json({ ok: true })
}
