/**
 * POST /api/webhook/merchant
 *
 * Telegram webhook for the merchant bot (TELEGRAM_BOT_TOKEN).
 * Forwards user messages to the configured FORWARD_CHAT_ID.
 *
 * 商品批量导入流程：
 *   文字触发：「新商品」/ "new good" / "new goods" → 引导文案
 *             → 用户发送管道格式清单 → 预览 → 「确认」→ 入库
 *   文件触发：发送 .xlsx 或 .csv 文件 → 自动解析（无需口令）→ 预览 → 「确认」→ 入库
 *   会话超时：30 分钟无操作自动失效
 *
 * Setup (run once after deploy):
 *   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
 *     -d "url=https://<domain>/api/webhook/merchant" \
 *     -d "secret_token=<MERCHANT_WEBHOOK_SECRET>"
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendAndLogMessage } from '@/lib/telegram'
import { parseProductTextLines, parseProductFile, isFileParseError } from '@/lib/product-import'
import type { TgImportRow, TgParseResult } from '@/lib/product-import'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const WEBHOOK_SECRET = process.env.MERCHANT_WEBHOOK_SECRET ?? ''
const FORWARD_CHAT_ID = process.env.FORWARD_CHAT_ID ?? ''

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TgMessage = Record<string, any>
type TgUpdate = { message?: TgMessage; [key: string]: unknown }

async function tgSend(method: string, body: object) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const IMPORT_TRIGGERS = new Set(['新商品', 'new good', 'new goods'])
const CONFIRM_WORDS   = new Set(['确认', 'confirm', 'yes', 'ok'])
const SESSION_TTL_MS  = 30 * 60 * 1000

const IMPORT_GUIDE = `📦 商品批量录入

请按以下格式，每行一个商品发送：
商品名称 | 条码 | 售价

示例：
苹果 | 123456789 | 3.5
可乐 | 987654321 | 2.0

────────────────
Please send one product per line:
Product Name | Barcode | Price

也可以直接发送 .xlsx 或 .csv 文件，系统自动识别中英文表头。
发送完整列表后，系统将显示预览，确认后正式导入。`

// ─── 辅助：查询用户 tenantId ──────────────────────────────────────────────────

async function lookupTenantId(telegramId: string): Promise<string | null> {
  try {
    const user = await prisma.user.findFirst({
      where: { telegramId },
      select: { tenantId: true },
    })
    return user?.tenantId ?? null
  } catch {
    return null
  }
}

// ─── 辅助：构建预览消息并更新 session ────────────────────────────────────────
//
// onNoValid:
//   'keep'   — 保留 session 在 AWAITING_DATA（文字导入允许用户改后重发）
//   'delete' — 删除 session（文件导入需重新上传文件）

async function buildAndSendPreview(
  parseResult: TgParseResult,
  senderId: string,
  chatId: string,
  tenantId: string,
  onNoValid: 'keep' | 'delete',
): Promise<void> {
  const { total, valid, fieldErrors, inFileDupes } = parseResult

  // 查询 DB 中已存在的条码
  let dbExistingBarcodes: string[] = []
  if (valid.length > 0) {
    try {
      const existing = await prisma.product.findMany({
        where: { tenantId, barcode: { in: valid.map((r) => r.barcode) } },
        select: { barcode: true },
      })
      dbExistingBarcodes = existing.map((p) => p.barcode)
    } catch { /* ignore */ }
  }

  const dbDupesSet  = new Set(dbExistingBarcodes)
  const importable  = valid.filter((r) => !dbDupesSet.has(r.barcode))
  const dbDupeCount = valid.length - importable.length

  let preview = `📦 商品导入预览\n\n`
  preview += `共 ${total} 行，可导入 ${importable.length} 条\n`
  if (fieldErrors.length  > 0) preview += `格式/字段错误：${fieldErrors.length} 条\n`
  if (inFileDupes.length  > 0) preview += `文件内重复条码：${inFileDupes.length} 条\n`
  if (dbDupeCount         > 0) preview += `数据库已存在（跳过）：${dbDupeCount} 条\n`

  if (importable.length > 0) {
    preview += `\n可导入商品：\n`
    preview += importable
      .slice(0, 10)
      .map((r, i) => `${i + 1}. ${r.name} | ${r.barcode} | ¥${r.sellPrice}`)
      .join('\n')
    if (importable.length > 10) preview += `\n…（共 ${importable.length} 条）`
    preview += `\n\n回复「确认」正式导入，回复其他内容取消。`

    // 无论文字还是文件来源，统一用 upsert 写 AWAITING_CONFIRM
    try {
      await prisma.productImportSession.upsert({
        where: { telegramId: senderId },
        create: {
          telegramId: senderId,
          tenantId,
          phase: 'AWAITING_CONFIRM',
          pendingRows: JSON.stringify(importable),
        },
        update: {
          tenantId,
          phase: 'AWAITING_CONFIRM',
          pendingRows: JSON.stringify(importable),
        },
      })
    } catch (e) {
      console.error('[webhook/import] preview session upsert failed:', e)
    }
  } else {
    preview += `\n没有可导入的商品，请检查后重新发送。`
    const allErrors = [
      ...fieldErrors.map((e) => `第 ${e.line} 行：${e.reason}`),
      ...inFileDupes.map((e) => `第 ${e.line} 行：${e.reason}`),
      ...valid.filter((r) => dbDupesSet.has(r.barcode)).map((r) => `条码 ${r.barcode}：数据库中已存在`),
    ]
    if (allErrors.length > 0) {
      preview += `\n\n${allErrors.slice(0, 8).join('\n')}`
    }
    if (onNoValid === 'delete') {
      try {
        await prisma.productImportSession.delete({ where: { telegramId: senderId } })
      } catch (e) {
        console.error('[webhook/import] session delete failed:', e)
      }
    }
  }

  const sendRes = await sendAndLogMessage({
    recipientTelegramId: chatId,
    text: preview,
    tenantId,
    sentBy: 'SYSTEM',
  })
  if (!sendRes.ok) {
    console.error('[webhook/import] preview send failed:', sendRes.error)
  }
}

// ─── 主处理器 ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const incomingSecret = req.headers.get('x-telegram-bot-api-secret-token')
  if (WEBHOOK_SECRET && incomingSecret !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  let update: TgUpdate
  try {
    update = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const message: TgMessage | undefined = update.message
  if (!message || !BOT_TOKEN) return NextResponse.json({ ok: true })

  if (message.web_app_data) return NextResponse.json({ ok: true })

  const text: string = message.text ?? ''
  if (text.startsWith('/')) return NextResponse.json({ ok: true })

  const senderId = String(message.from?.id ?? message.chat?.id ?? '')
  const chatId   = String(message.chat?.id ?? senderId)

  // ─── 文件导入：.xlsx / .csv ──────────────────────────────────────────────────
  if (senderId && message.document) {
    const doc      = message.document
    const fileName = (doc.file_name ?? '').toLowerCase()
    const mime     = (doc.mime_type ?? '').toLowerCase()
    const isXlsx   = mime.includes('spreadsheetml') || fileName.endsWith('.xlsx')
    const isCsv    = mime.includes('csv') || fileName.endsWith('.csv')

    if (isXlsx || isCsv) {
      const tenantId = await lookupTenantId(senderId)

      if (!tenantId) {
        await sendAndLogMessage({
          recipientTelegramId: chatId,
          text: '❌ 您的账号尚未绑定商户，无法导入商品。',
          sentBy: 'SYSTEM',
        })
        return NextResponse.json({ ok: true })
      }

      if ((doc.file_size ?? 0) > 2 * 1024 * 1024) {
        await sendAndLogMessage({
          recipientTelegramId: chatId,
          text: '❌ 文件太大，请上传 2MB 以内的文件。',
          tenantId,
          sentBy: 'SYSTEM',
        })
        return NextResponse.json({ ok: true })
      }

      // 从 Telegram 下载文件
      let fileBuffer: Buffer | null = null
      try {
        const fileInfoRes  = await tgSend('getFile', { file_id: doc.file_id })
        const fileInfo     = await fileInfoRes.json()
        const filePath: string = fileInfo.result?.file_path ?? ''
        if (!filePath) throw new Error('no file_path')
        const dlRes  = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`)
        fileBuffer   = Buffer.from(await dlRes.arrayBuffer())
      } catch {
        await sendAndLogMessage({
          recipientTelegramId: chatId,
          text: '❌ 文件下载失败，请重试。',
          tenantId,
          sentBy: 'SYSTEM',
        })
        return NextResponse.json({ ok: true })
      }

      const parseResult = parseProductFile(fileBuffer, doc.file_name ?? '')

      if (isFileParseError(parseResult)) {
        const errMsg = `❌ 无法识别文件格式：\n${parseResult.missing.map((m) => `  · ${m}`).join('\n')}`
        await sendAndLogMessage({ recipientTelegramId: chatId, text: errMsg, tenantId, sentBy: 'SYSTEM' })
        return NextResponse.json({ ok: true })
      }

      // 文件来源：无有效行时删除 session（不保留 AWAITING_DATA）
      await buildAndSendPreview(parseResult, senderId, chatId, tenantId, 'delete')
      return NextResponse.json({ ok: true })
    }
  }

  // ─── 文字导入流程 ─────────────────────────────────────────────────────────────
  if (senderId && message.text) {
    // 多空格归一化，兼容 "new  good" / "new  goods" 等写法
    const textNorm    = text.trim().toLowerCase().replace(/\s+/g, ' ')
    const textTrimmed = text.trim()

    // ── 触发口令检查（优先，不等待 DB 查询） ──────────────────────────────────
    if (IMPORT_TRIGGERS.has(textNorm)) {
      // 直接用 tgSend 回复，移除日志 DB 依赖，确保回复能送达
      const replyRes  = await tgSend('sendMessage', { chat_id: chatId, text: IMPORT_GUIDE })
      const replyBody = await replyRes.json().catch(() => null)
      if (!replyRes.ok || replyBody?.ok !== true) {
        console.error('[webhook/import] guide reply failed:', replyBody?.description ?? replyRes.status)
      }
      // session upsert 非阻断（DB 慢/未迁移均不影响已送出的回复）
      const tenantId = await lookupTenantId(senderId)
      try {
        await prisma.productImportSession.upsert({
          where: { telegramId: senderId },
          create: { telegramId: senderId, tenantId, phase: 'AWAITING_DATA' },
          update: { tenantId, phase: 'AWAITING_DATA', pendingRows: '[]' },
        })
      } catch (e) {
        console.error('[webhook/import] session upsert failed:', e)
      }
      return NextResponse.json({ ok: true })
    }

    // 非触发消息：查 tenantId 与 session
    const tenantId = await lookupTenantId(senderId)

    // ── 查询活跃 session ──────────────────────────────────────────────────────
    let session: {
      telegramId: string
      tenantId: string | null
      phase: string
      pendingRows: string
      updatedAt: Date
    } | null = null

    try {
      session = await prisma.productImportSession.findUnique({ where: { telegramId: senderId } })
    } catch (e) {
      console.error('[webhook/import] session lookup failed:', e)
    }

    const sessionActive = session && Date.now() - session.updatedAt.getTime() < SESSION_TTL_MS

    if (sessionActive) {
      // ── AWAITING_DATA：解析文字清单 → 预览 ──────────────────────────────────
      if (session!.phase === 'AWAITING_DATA') {
        const parseResult = parseProductTextLines(text)

        if (parseResult.total === 0) {
          // 空消息，fall through 到普通消息处理
        } else if (!tenantId) {
          await sendAndLogMessage({
            recipientTelegramId: chatId,
            text: '❌ 您的账号尚未绑定商户，无法导入商品。',
            sentBy: 'SYSTEM',
          })
          try { await prisma.productImportSession.delete({ where: { telegramId: senderId } }) } catch { /* ignore */ }
          return NextResponse.json({ ok: true })
        } else {
          // 文字来源：无有效行时保留 AWAITING_DATA（允许用户修改后重发）
          await buildAndSendPreview(parseResult, senderId, chatId, tenantId, 'keep')
          return NextResponse.json({ ok: true })
        }
      }

      // ── AWAITING_CONFIRM：「确认」→ 入库；其他 → 取消 ───────────────────────
      if (session!.phase === 'AWAITING_CONFIRM') {
        if (CONFIRM_WORDS.has(textNorm)) {
          let rows: TgImportRow[] = []
          try { rows = JSON.parse(session!.pendingRows) } catch { /* ignore */ }

          const tid = session!.tenantId ?? tenantId

          if (!tid || rows.length === 0) {
            await sendAndLogMessage({
              recipientTelegramId: chatId,
              text: '❌ 导入失败：商户信息丢失或无可导入商品，请重新发送「新商品」口令。',
              sentBy: 'SYSTEM',
            })
            try { await prisma.productImportSession.delete({ where: { telegramId: senderId } }) } catch { /* ignore */ }
            return NextResponse.json({ ok: true })
          }

          // 再次检查 DB（防止并发写入）
          const existingNow = await prisma.product.findMany({
            where: { tenantId: tid, barcode: { in: rows.map((r) => r.barcode) } },
            select: { barcode: true },
          })
          const existingSet = new Set(existingNow.map((p) => p.barcode))
          const toCreate    = rows.filter((r) => !existingSet.has(r.barcode))
          const skipped     = rows.length - toCreate.length

          let imported = 0
          if (toCreate.length > 0) {
            const result = await prisma.product.createMany({
              data: toCreate.map((r) => ({
                tenantId: tid,
                barcode:   r.barcode,
                name:      r.name,
                sellPrice: String(r.sellPrice),
              })),
              skipDuplicates: true,
            })
            imported = result.count
          }

          let reply = `✅ 导入完成！成功导入 ${imported} 条商品。`
          if (skipped > 0) reply += `\n（${skipped} 条因条码已存在已跳过）`

          const importRes = await sendAndLogMessage({ recipientTelegramId: chatId, text: reply, tenantId: tid, sentBy: 'SYSTEM' })
          if (!importRes.ok) console.error('[webhook/import] confirm reply failed:', importRes.error)
          try { await prisma.productImportSession.delete({ where: { telegramId: senderId } }) } catch (e) {
            console.error('[webhook/import] session delete failed:', e)
          }
          return NextResponse.json({ ok: true })
        } else {
          // 任何非确认回复 → 取消
          try { await prisma.productImportSession.delete({ where: { telegramId: senderId } }) } catch (e) {
            console.error('[webhook/import] session delete failed:', e)
          }
          const cancelRes = await sendAndLogMessage({
            recipientTelegramId: chatId,
            text: '已取消商品导入。',
            tenantId: tenantId ?? undefined,
            sentBy: 'SYSTEM',
          })
          if (!cancelRes.ok) console.error('[webhook/import] cancel reply failed:', cancelRes.error)
          return NextResponse.json({ ok: true })
        }
      }
    }
  }

  // ─── 普通消息：转发 + 入库 ──────────────────────────────────────────────────
  if (FORWARD_CHAT_ID && BOT_TOKEN) {
    try {
      await tgSend('forwardMessage', {
        chat_id:      FORWARD_CHAT_ID,
        from_chat_id: message.chat.id,
        message_id:   message.message_id,
      })
    } catch { /* ignore */ }
  }

  if (senderId) {
    const firstName: string = message.from?.first_name ?? ''
    const lastName:  string = message.from?.last_name ?? ''
    const username:  string = message.from?.username ?? ''
    const senderName =
      [firstName, lastName].filter(Boolean).join(' ') || (username ? `@${username}` : null)

    const msgContent: string =
      message.text || message.caption ||
      (message.photo    ? '[图片]'
        : message.sticker  ? '[贴纸]'
        : message.voice    ? '[语音]'
        : message.video    ? '[视频]'
        : message.document ? '[文件]'
        : '[其他消息]')

    const msgType: string =
      message.photo    ? 'IMAGE'
        : message.sticker  ? 'STICKER'
        : message.voice    ? 'VOICE'
        : message.video    ? 'VIDEO'
        : message.document ? 'FILE'
        : message.text     ? 'TEXT'
        : 'OTHER'

    let tenantId: string | null = null
    try {
      const user = await prisma.user.findFirst({
        where: { telegramId: senderId },
        select: { tenantId: true },
      })
      tenantId = user?.tenantId ?? null
    } catch (e) {
      console.error('[webhook] tenantId lookup failed:', e)
    }

    // 必须 await — Vercel serverless 函数 return 后 unawaited Promise 会被丢弃
    try {
      await prisma.telegramMessage.create({
        data: {
          recipientTelegramId: senderId,
          senderName,
          content: msgContent,
          messageType: msgType,
          tenantId,
          sentBy: 'CUSTOMER',
          status: 'RECEIVED',
        },
      })
    } catch (e) {
      console.error('[webhook] TelegramMessage insert failed:', e)
    }
  }

  return NextResponse.json({ ok: true })
}
