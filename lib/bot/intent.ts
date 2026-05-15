/**
 * lib/bot/intent.ts — 顾客 bot 纯规则意图分类器（阶段一，不调 LLM）。
 *
 * 输入：原始文本 + 顾客语言（zh|en|km）
 * 输出：{ layer, slot?, escalate, confidence, matchedKeyword? }
 *
 * 分流顺序（短路优先）：
 *   1) 风险关键词命中 → layer=3 escalate=true
 *   2) 业务关键词命中 → layer=1 + slot
 *   3) 闲聊/问候/感谢/告别/身份/确认 → layer=2 + chatKind
 *   4) 短消息（≤6 字 / 1 词）且未命中 → layer=2 GREETING fallback
 *   5) 其它（长句、未命中）→ layer=3 escalate=true（兜底转人工，避免冒进）
 *
 * 设计：所有判定 O(N) 字串匹配；不做正则回溯；不接入网络。
 */

import { RISK_KEYWORDS_ZH, BIZ_KEYWORDS_ZH, CHAT_KEYWORDS_ZH } from './keywords/zh'
import { RISK_KEYWORDS_EN, BIZ_KEYWORDS_EN, CHAT_KEYWORDS_EN } from './keywords/en'
import { RISK_KEYWORDS_KM, BIZ_KEYWORDS_KM, CHAT_KEYWORDS_KM } from './keywords/km'

export type Lang = 'zh' | 'en' | 'km'
export type IntentLayer = 1 | 2 | 3
export type BizSlot =
  | 'ORDER_STATUS' | 'PRODUCT' | 'PRICE' | 'COUPON'
  | 'HOURS' | 'ADDRESS' | 'DELIVERY' | 'MENU_LINK'
export type ChatKind = 'GREETING' | 'THANKS' | 'BYE' | 'WHO' | 'OK'

export type IntentResult = {
  layer:           IntentLayer
  slot?:           BizSlot
  chatKind?:       ChatKind
  escalate:        boolean
  confidence:      number  // 0..1
  matchedKeyword?: string
  source:          'RISK' | 'BIZ' | 'CHAT' | 'FALLBACK_SHORT' | 'FALLBACK_UNKNOWN'
}

/** 跨语言风险/业务/闲聊词典（按 lang 选） */
function dictFor(lang: Lang) {
  switch (lang) {
    case 'en': return { risk: RISK_KEYWORDS_EN, biz: BIZ_KEYWORDS_EN, chat: CHAT_KEYWORDS_EN }
    case 'km': return { risk: RISK_KEYWORDS_KM, biz: BIZ_KEYWORDS_KM, chat: CHAT_KEYWORDS_KM }
    default:   return { risk: RISK_KEYWORDS_ZH, biz: BIZ_KEYWORDS_ZH, chat: CHAT_KEYWORDS_ZH }
  }
}

/** 文本规范化：trim + 中英文小写（高棉语保持原状） */
function normalize(text: string): string {
  return text.trim().replace(/[A-Z]/g, (c) => c.toLowerCase())
}

/** 命中任意一个关键词 */
function findHit(text: string, words: readonly string[]): string | null {
  for (const w of words) if (w && text.includes(w)) return w
  return null
}

/** 命中业务槽位（先匹配的优先；保留命中词） */
function findBizSlot(text: string, biz: Record<string, string[]>): { slot: BizSlot; kw: string } | null {
  const order: BizSlot[] = ['ORDER_STATUS', 'PRICE', 'COUPON', 'HOURS', 'ADDRESS', 'DELIVERY', 'MENU_LINK', 'PRODUCT']
  for (const slot of order) {
    const words = biz[slot] ?? []
    const hit = findHit(text, words)
    if (hit) return { slot, kw: hit }
  }
  return null
}

/** 命中闲聊类型 */
function findChatKind(
  text: string,
  chat: Record<string, readonly string[]>,
): { kind: ChatKind; kw: string } | null {
  const order: ChatKind[] = ['GREETING', 'THANKS', 'BYE', 'WHO', 'OK']
  for (const kind of order) {
    const words = chat[kind] ?? []
    const hit = findHit(text, words)
    if (hit) return { kind, kw: hit }
  }
  return null
}

const SHORT_LIMIT = 6 // 文本长度 ≤ 6 视为"短问候/确认"候选

export function classifyIntent(rawText: string, lang: Lang): IntentResult {
  const text = normalize(rawText ?? '')
  if (text.length === 0) {
    return { layer: 2, chatKind: 'GREETING', escalate: false, confidence: 0.3, source: 'FALLBACK_SHORT' }
  }

  // 跨语言风险命中（任一字典）
  const allDicts: Lang[] = ['zh', 'en', 'km']
  for (const l of allDicts) {
    const { risk } = dictFor(l)
    const hit = findHit(text, risk)
    if (hit) {
      return { layer: 3, escalate: true, confidence: 0.95, matchedKeyword: hit, source: 'RISK' }
    }
  }

  const { biz, chat } = dictFor(lang)

  // 业务槽位
  const bizHit = findBizSlot(text, biz)
  if (bizHit) {
    return { layer: 1, slot: bizHit.slot, escalate: false, confidence: 0.85, matchedKeyword: bizHit.kw, source: 'BIZ' }
  }

  // 闲聊
  const chatHit = findChatKind(text, chat)
  if (chatHit) {
    return { layer: 2, chatKind: chatHit.kind, escalate: false, confidence: 0.8, matchedKeyword: chatHit.kw, source: 'CHAT' }
  }

  // 短文本兜底为问候
  if (text.length <= SHORT_LIMIT) {
    return { layer: 2, chatKind: 'GREETING', escalate: false, confidence: 0.4, source: 'FALLBACK_SHORT' }
  }

  // 兜底：长句未识别 → 转人工，避免冒进
  return { layer: 3, escalate: true, confidence: 0.2, source: 'FALLBACK_UNKNOWN' }
}
