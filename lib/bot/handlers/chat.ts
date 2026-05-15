/**
 * lib/bot/handlers/chat.ts — 第二层：闲聊/寒暄 处理器（模板池随机回复）。
 */
import type { Lang, ChatKind } from '../intent'
import { TPL, pickRandom, fill } from '../templates'

export function chatReply(kind: ChatKind, lang: Lang, storeName: string): string {
  const pool = TPL.chat[kind][lang]
  const raw  = pickRandom(pool)
  return fill(raw, { store: storeName })
}
