export const DEFAULT_CURRENCY_CODE = 'USD'
export const SUPPORTED_CURRENCY_CODES = ['USD', 'XAF'] as const

export type CurrencyCode = typeof SUPPORTED_CURRENCY_CODES[number]

export function normalizeCurrencyCode(value: string | null | undefined): CurrencyCode {
  const code = (value ?? '').trim().toUpperCase()
  return SUPPORTED_CURRENCY_CODES.includes(code as CurrencyCode) ? code as CurrencyCode : DEFAULT_CURRENCY_CODE
}

export function isSupportedCurrencyCode(value: string | null | undefined): value is CurrencyCode {
  const code = (value ?? '').trim().toUpperCase()
  return SUPPORTED_CURRENCY_CODES.includes(code as CurrencyCode)
}

export function isKhqrSupportedCurrency(value: string | null | undefined): boolean {
  return normalizeCurrencyCode(value) === 'USD'
}

export function formatMoney(value: number, currencyCode?: string | null): string {
  const code = normalizeCurrencyCode(currencyCode)
  const amount = Number(value || 0)
  if (code === 'XAF') {
    return `FCFA ${Math.round(amount).toLocaleString('en-US')}`
  }
  return `$${amount.toFixed(2)}`
}
