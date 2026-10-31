export const INVENTORY_PROFIT_UNAVAILABLE = '数据暂时无法更新'
export const TELEGRAM_PRESENCE_REQUIRED = '请从 Telegram 内打开店小二完成在场校验'

export function telegramPresenceHeaders(): HeadersInit | null {
  if (typeof window === 'undefined') return null
  const telegram = (window as Window & {
    Telegram?: { WebApp?: { initData?: string } }
  }).Telegram
  const initData = telegram?.WebApp?.initData?.trim()
  return initData ? { 'x-telegram-init-data': initData } : null
}

export async function inventoryProfitError(response: Response) {
  const body = await response.json().catch(() => null) as { error?: string; message?: string } | null
  if (response.status === 503) return INVENTORY_PROFIT_UNAVAILABLE
  if (body?.error?.startsWith('TELEGRAM_PRESENCE_')) return TELEGRAM_PRESENCE_REQUIRED
  if (response.status === 403) return '仅老板可使用'
  return body?.message ?? INVENTORY_PROFIT_UNAVAILABLE
}
