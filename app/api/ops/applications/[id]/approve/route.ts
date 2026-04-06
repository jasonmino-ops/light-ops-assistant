/**
 * POST /api/ops/applications/[id]/approve
 *
 * 审批通过开店申请 — 直接完成老板账号绑定，无需再发绑定码给客户。
 *
 * 事务内：
 *  1. 创建 Tenant
 *  2. 创建 Store
 *  3. 创建 User（OWNER 角色，直接写入申请人的 telegramId）
 *  4. 创建 UserStoreRole（将老板绑定到门店）
 *  5. 标记 StoreApplication 为 APPROVED
 *
 * 事务完成后（非事务，失败不回滚）：
 *  6. 通过 Telegram Bot API 向申请人发送通知："已通过，请重新打开进入系统"
 *
 * 客户收到通知后，在 Telegram 内重新打开 Mini App，
 * /api/auth/telegram 按 telegramId 查到新建的 User，直接登录。
 *
 * Ops-admin only.
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'
import { sendAndLogMessage, WELCOME_TEXT } from '@/lib/telegram'

// 审批通过通知 + 欢迎消息合并成一条，减少打扰
const NOTIFY_TEXT =
  '你的开店申请已通过！请返回 Telegram，重新打开店小二助手进入系统。\n' +
  'ការស្នើសុំបើកហាងរបស់អ្នកត្រូវបានអនុម័តហើយ! សូមត្រឡប់ទៅ Telegram ហើយបើក店小二助手ម្ដងទៀតដើម្បីចូលប្រព័ន្ធ។\n\n' +
  WELCOME_TEXT

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await params

  const app = await prisma.storeApplication.findUnique({ where: { id } })
  if (!app) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (app.status !== 'PENDING') {
    return NextResponse.json({ error: 'NOT_PENDING', message: '该申请已处理' }, { status: 409 })
  }

  const storeCode = 'ST' + crypto.randomBytes(4).toString('hex').toUpperCase()

  // ── 事务：建商户 + 门店 + 老板账号 + 角色绑定 ────────────────────────────────
  const { tenant, store, user } = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: app.storeName } })

    const store = await tx.store.create({
      data: { tenantId: tenant.id, code: storeCode, name: app.storeName },
    })

    // 直接创建已绑定 telegramId 的老板 User，无需二次绑定
    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        username: 'owner',
        displayName: app.ownerName,
        role: 'OWNER',
        telegramId: app.telegramId,
        status: 'ACTIVE',
      },
    })

    await tx.userStoreRole.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        storeId: store.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    })

    await tx.storeApplication.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        tenantId: tenant.id,
      },
    })

    return { tenant, store, user }
  })

  // ── 通知申请人 + 欢迎消息（失败不影响审批结果）──────────────────────────
  const { ok: notified } = await sendAndLogMessage({
    recipientTelegramId: app.telegramId,
    text: NOTIFY_TEXT,
    tenantId: tenant.id,
    sentBy: 'SYSTEM',
  }).catch((e) => { console.error('[approve] notify failed:', e); return { ok: false } })

  return NextResponse.json({
    ok: true,
    tenantId: tenant.id,
    storeName: store.name,
    userId: user.id,
    notified,
  }, { status: 201 })
}
