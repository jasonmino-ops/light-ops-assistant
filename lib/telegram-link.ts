const FALLBACK_BOT_WARNING =
  '未配置 Telegram Bot username，无法生成绑定链接 / មិនបានកំណត់ Telegram Bot username ទេ មិនអាចបង្កើតតំណភ្ជាប់បាន'

export function normalizeTelegramBotUsername(
  ...candidates: Array<string | null | undefined>
): string {
  for (const raw of candidates) {
    const clean = (raw ?? '').trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '')
    if (clean) return clean
  }
  return ''
}

export function buildTelegramStartAppLink(
  botUsername: string | null | undefined,
  startParam: string,
): string | null {
  const bot = normalizeTelegramBotUsername(botUsername)
  const param = startParam.trim()
  if (!bot || !param) return null
  return `https://t.me/${bot}?startapp=${param}`
}

export function merchantBotWarning() {
  return FALLBACK_BOT_WARNING
}
