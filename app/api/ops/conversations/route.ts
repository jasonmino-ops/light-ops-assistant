/**
 * GET /api/ops/conversations
 *
 * 返回客户会话列表（按运营优先级排序）。
 * 每个会话代表一个与 bot 交互过的客户，包含最新消息预览。
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkOpsAuth, hasOpsRole } from '@/lib/ops-auth'
import { prisma } from '@/lib/prisma'

const CUSTOMER_MESSAGE_LIMIT = 300
const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

type ConversationRow = {
  telegramId: string
  displayName: string | null
  senderName: string | null
  tenantId: string | null
  tenantName: string | null
  lastMessage: string
  lastAt: string
  messageCount: number
  sessionState: string | null
  leadContext: {
    id: string
    storeName: string
    ownerName: string
    source: string
    campaign: string | null
    inviteCode: string | null
    status: string
    stage: string | null
    identitySource: 'APPLICANT' | 'SUPPORT'
  } | null
}

type LeadContextRow = NonNullable<ConversationRow['leadContext']>

function statePriority(sessionState: string | null) {
  if (sessionState === 'awaiting_human') return 0
  if (sessionState === 'human_active') return 1
  return 2
}

function sortActive(a: ConversationRow, b: ConversationRow) {
  const pa = statePriority(a.sessionState)
  const pb = statePriority(b.sessionState)
  if (pa !== pb) return pa - pb
  return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()
}

function sortByLastAtDesc(a: ConversationRow, b: ConversationRow) {
  return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()
}

export async function GET(req: NextRequest) {
  const opsRole = await checkOpsAuth(req)
  if (!opsRole || !hasOpsRole(opsRole, 'OPS_ADMIN')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  // 并发拉取消息列表和支持会话状态
  const [messages, supportSessions] = await Promise.all([
    prisma.telegramMessage.findMany({
      where: { channel: 'MERCHANT', sentBy: 'CUSTOMER' },
      orderBy: { createdAt: 'desc' },
      take: CUSTOMER_MESSAGE_LIMIT,
      select: {
        recipientTelegramId: true,
        senderName: true,
        content: true,
        tenantId: true,
        createdAt: true,
      },
    }),
    prisma.supportSession.findMany({
      select: { telegramId: true, sessionState: true },
    }),
  ])

  const sessionStateMap = new Map(supportSessions.map((s) => [s.telegramId, s.sessionState]))
  const telegramIds = Array.from(new Set(messages.map((message) => message.recipientTelegramId)))
  const tenantIds = Array.from(new Set(messages.map((m) => m.tenantId).filter(Boolean) as string[]))
  const [tenants, canonicalLeads, supportTokens] = await Promise.all([
    tenantIds.length > 0 ? prisma.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, name: true },
      }) : [],
    telegramIds.length > 0 ? prisma.salesLead.findMany({
      where: { telegramId: { in: telegramIds } },
      orderBy: { lastActivityAt: 'desc' },
      include: { firstInvite: { select: { code: true } } },
    }) : [],
    telegramIds.length > 0 ? prisma.salesLeadContextToken.findMany({
      where: {
        purpose: 'SUPPORT',
        consumedAt: { not: null },
        consumedByTelegramId: { in: telegramIds },
      },
      orderBy: { consumedAt: 'desc' },
      include: {
        salesLead: { include: { firstInvite: { select: { code: true } } } },
      },
    }) : [],
  ])
  const tenantNameMap = new Map(tenants.map((tenant) => [tenant.id, tenant.name]))
  const leadContextMap = new Map<string, LeadContextRow>()
  for (const lead of canonicalLeads) {
    if (!lead.telegramId || leadContextMap.has(lead.telegramId)) continue
    leadContextMap.set(lead.telegramId, {
      id: lead.id,
      storeName: lead.storeName,
      ownerName: lead.ownerName,
      source: lead.firstSourceChannel,
      campaign: lead.firstCampaign,
      inviteCode: lead.firstInvite?.code ?? null,
      status: lead.status,
      stage: null,
      identitySource: 'APPLICANT',
    })
  }
  for (const token of supportTokens) {
    const telegramId = token.consumedByTelegramId
    if (!telegramId || leadContextMap.has(telegramId)) continue
    const lead = token.salesLead
    leadContextMap.set(telegramId, {
      id: lead.id,
      storeName: lead.storeName,
      ownerName: lead.ownerName,
      source: lead.firstSourceChannel,
      campaign: lead.firstCampaign,
      inviteCode: lead.firstInvite?.code ?? null,
      status: lead.status,
      stage: token.contextStage,
      identitySource: 'SUPPORT',
    })
  }

  // 按 telegramId 聚合，保留最新消息作为预览
  const map = new Map<string, ConversationRow>()

  for (const m of messages) {
    const tid = m.recipientTelegramId
    const senderName = m.senderName ?? null
    if (!map.has(tid)) {
      map.set(tid, {
        telegramId: tid,
        displayName: senderName,
        senderName,
        tenantId: m.tenantId ?? null,
        tenantName: m.tenantId ? tenantNameMap.get(m.tenantId) ?? null : null,
        lastMessage: m.content,
        lastAt: m.createdAt.toISOString(),
        messageCount: 1,
        sessionState: sessionStateMap.get(tid) ?? null,
        leadContext: leadContextMap.get(tid) ?? null,
      })
    } else {
      const entry = map.get(tid)!
      entry.messageCount++
      // 已按 createdAt desc 排序，第一条即最新，不需再比较
    }
  }

  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS)
  const activeConversations: ConversationRow[] = []
  const archivedConversations: ConversationRow[] = []

  for (const conversation of map.values()) {
    const lastAt = new Date(conversation.lastAt)
    const protectedByHumanState =
      conversation.sessionState === 'awaiting_human' ||
      conversation.sessionState === 'human_active'
    // 新客户消息会更新 TelegramMessage.createdAt；超过 30 天的普通会话会自然重新进入当前会话。
    if (protectedByHumanState || lastAt >= cutoff) {
      activeConversations.push(conversation)
    } else {
      archivedConversations.push(conversation)
    }
  }

  activeConversations.sort(sortActive)
  archivedConversations.sort(sortByLastAtDesc)

  return NextResponse.json({
    activeConversations,
    archivedConversations,
    counts: {
      active: activeConversations.length,
      archived: archivedConversations.length,
      awaitingHuman: activeConversations.filter((row) => row.sessionState === 'awaiting_human').length,
      humanActive: activeConversations.filter((row) => row.sessionState === 'human_active').length,
    },
  })
}
