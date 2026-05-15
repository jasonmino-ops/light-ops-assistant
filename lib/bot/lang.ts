/**
 * lib/bot/lang.ts — 顾客 bot 回复语言决议（阶段一，不接 LLM）。
 *
 * 优先级：
 *   1) 文本可判断 → detectTextLang(text)
 *   2) StoreCustomerContact.telegramLanguageCode
 *   3) Telegram msg.from.language_code
 *   4) 'zh'
 *
 * detectTextLang 规则：
 *   - 含 Khmer Unicode (U+1780..U+17FF) → km
 *   - 含中日韩统一表意 (U+4E00..U+9FFF) → zh
 *   - 拉丁字母占比明显 或 命中英文业务关键词 → en
 *   - 否则 null（太短 / 仅数字 / 仅 emoji / 仅 #0017）
 */

import type { Lang } from './intent'

const RE_KM = /[ក-៿]/
const RE_ZH = /[一-鿿]/
const RE_LATIN_WORD = /[A-Za-z]{2,}/g

// 简短的英文业务 / 寒暄关键词（小写比较），命中可视为 en
const EN_HINTS = [
  'hi', 'hello', 'hey', 'thanks', 'thank', 'bye', 'good',
  'order', 'menu', 'price', 'coupon', 'refund', 'cancel', 'return',
  'open', 'close', 'where', 'how', 'when', 'time', 'address', 'delivery', 'pickup',
  'help', 'human', 'agent', 'staff',
] as const

export function detectTextLang(raw: string): Lang | null {
  const text = (raw ?? '').trim()
  if (text.length === 0) return null

  if (RE_KM.test(text)) return 'km'
  if (RE_ZH.test(text)) return 'zh'

  // 拉丁字母词数 vs 文本长度（不含空格）
  const words = text.match(RE_LATIN_WORD) ?? []
  const letters = words.join('').length
  const nonSpace = text.replace(/\s/g, '').length

  // 短消息：尝试关键词命中
  const lower = text.toLowerCase()
  for (const k of EN_HINTS) {
    if (lower.split(/\W+/).includes(k)) return 'en'
  }

  // 长一些的文本：英文字母占非空白字符 ≥ 60%，且有 ≥1 个长度≥2 的单词
  if (words.length > 0 && letters / Math.max(1, nonSpace) >= 0.6) return 'en'

  return null
}

export type ResolveReplyLangInput = {
  text:         string | null | undefined
  isText:       boolean
  contactLang:  string | null | undefined
  telegramLang: string | null | undefined
}

function normalizeAny(v: string | null | undefined): Lang | null {
  const s = (v ?? '').toLowerCase()
  if (!s) return null
  if (s === 'zh' || s.startsWith('zh-') || s.startsWith('zh_')) return 'zh'
  if (s === 'en' || s.startsWith('en-') || s.startsWith('en_')) return 'en'
  if (s === 'km' || s.startsWith('km-') || s.startsWith('kh') || s === 'km_kh') return 'km'
  return null
}

export function resolveReplyLang(input: ResolveReplyLangInput): Lang {
  if (input.isText && input.text) {
    const d = detectTextLang(input.text)
    if (d) return d
  }
  return normalizeAny(input.contactLang) ?? normalizeAny(input.telegramLang) ?? 'zh'
}
