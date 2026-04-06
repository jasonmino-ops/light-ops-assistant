/**
 * GET /api/ops/conversations
 *
 * 返回客户会话列表（按最近消息时间倒序）。
 * 每个会话代表一个与 bot 交互过的客户，包含最新消息预览。
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkOpsAuth } from '@/lib/ops-auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  // 拉取最近 300 条客户消息，在 JS 侧按 telegramId 聚合
  const messages = await prisma.telegramMessage.findMany({
    where: { sentBy: 'CUSTOMER' },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: {
      recipientTelegramId: true,
      senderName: true,
      content: true,
      tenantId: true,
      createdAt: true,
    },
  })

  // 按 telegramId 聚合，保留最新消息作为预览
  const map = new Map<string, {
    telegramId: string
    senderName: string | null
    tenantId: string | null
    lastMessage: string
    lastAt: string
    messageCount: number
  }>()

  for (const m of messages) {
    const tid = m.recipientTelegramId
    if (!map.has(tid)) {
      map.set(tid, {
        telegramId: tid,
        senderName: m.senderName ?? null,
        tenantId: m.tenantId ?? null,
        lastMessage: m.content,
        lastAt: m.createdAt.toISOString(),
        messageCount: 1,
      })
    } else {
      const entry = map.get(tid)!
      entry.messageCount++
      // 已按 createdAt desc 排序，第一条即最新，不需再比较
    }
  }

  return NextResponse.json(Array.from(map.values()))
}
