'use client'

import { useRef, type Dispatch, type SetStateAction } from 'react'

// Input/display units only. Sales and offline records continue using the existing USD contract.
export type CashInputCurrency = 'USD' | 'KHR'
const hundred = BigInt(100)

function parseAmount(value: string, currency: CashInputCurrency): bigint | null {
  if (!(currency === 'KHR' ? /^\d{1,16}$/ : /^\d{1,16}(?:\.\d{1,2})?$/).test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  return currency === 'KHR' ? BigInt(whole) : BigInt(whole) * hundred + BigInt(fraction.padEnd(2, '0'))
}

function formatAmount(value: bigint, currency: CashInputCurrency) {
  return currency === 'KHR' ? `៛${value.toLocaleString('en-US')}` : `$${value / hundred}.${(value % hundred).toString().padStart(2, '0')}`
}

export function acceptCashInput(value: string, currency: CashInputCurrency) {
  return value === '' || (currency === 'USD' && /^\d{1,16}\.$/.test(value)) || parseAmount(value, currency) !== null
}

export function editCashInput(value: string, key: string, currency: CashInputCurrency) {
  if (key === 'clear') return ''
  if (key === 'backspace') return value.slice(0, -1)
  if (!/^[0-9.]$/.test(key)) return value
  const next = key === '.' && value === '' ? '0.' : value === '0' && key !== '.' ? key : value + key
  return acceptCashInput(next, currency) ? next : value
}

export function cashHelperQuote(orderAmount: number, rate: number, currency: CashInputCurrency, value: string) {
  if (!Number.isFinite(orderAmount) || orderAmount < 0 || !Number.isInteger(rate) || rate < 1000 || rate > 10000) return null
  // Keep the existing two-decimal USD display boundary; do not change cart totals or sale payloads.
  const cents = parseAmount(orderAmount.toFixed(2), 'USD')
  if (cents === null) return null
  // Nonnegative half-up rounding, entirely in integer units (including fractional KHR results).
  const khr = (cents * BigInt(rate) + BigInt(50)) / hundred
  const due = currency === 'KHR' ? khr : cents
  const received = parseAmount(value, currency)
  const sufficient = received !== null && received >= due
  const change = sufficient ? received - due : BigInt(0)
  return { due, received, sufficient, usdDue: formatAmount(cents, 'USD'), khrDue: formatAmount(khr, 'KHR'), change: formatAmount(change, currency) }
}

export default function CashTenderPanel({ value, onChange, currency, onCurrencyChange, orderAmount, rate, disabled, lang }: {
  value: string
  onChange: Dispatch<SetStateAction<string>>
  currency: CashInputCurrency
  onCurrencyChange: (currency: CashInputCurrency) => void
  orderAmount: number
  rate: number
  disabled: boolean
  lang: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const quote = cashHelperQuote(orderAmount, rate, currency, value)
  const text = lang === 'en'
    ? { currency: 'Cash handed over', received: 'Cash received', due: 'Payable', reference: 'KHR reference', change: 'Change', clear: 'Clear', backspace: 'Backspace', keypad: 'Cash numpad', insufficient: 'Enter enough cash before confirming.', helper: 'KHR conversion helper · Sale recorded in USD' }
    : lang === 'km'
      ? { currency: 'សាច់ប្រាក់ទូទាត់', received: 'សាច់ប្រាក់បានទទួល', due: 'ត្រូវបង់', reference: 'តម្លៃយោង KHR', change: 'ប្រាក់អាប់', clear: 'សម្អាត', backspace: 'លុប', keypad: 'ក្ដារចុចលេខសាច់ប្រាក់', insufficient: 'សូមបញ្ចូលសាច់ប្រាក់ឱ្យគ្រប់ មុនបញ្ជាក់។', helper: 'ជំនួយប្តូរ KHR · ការលក់កត់ត្រាជា USD' }
      : { currency: '付款现金', received: '实收现金', due: '应付', reference: '参考柬币', change: '找零', clear: '清除', backspace: '退格', keypad: '现金数字键盘', insufficient: '请输入足够的实收现金后确认。', helper: 'KHR 换算助手 · 销售仍以 USD 记录' }
  const focusInput = () => inputRef.current?.focus({ preventScroll: true })
  const button = { minHeight: 48, minWidth: 48, border: '1px solid #cbd5e1', borderRadius: 9, background: '#fff', fontSize: 20, fontWeight: 700, touchAction: 'manipulation' as const, cursor: 'pointer' }
  return <section data-cash-tender-panel aria-label={text.received} onKeyDown={event => event.stopPropagation()}
    style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, padding: 10, border: '1px solid #e2e8f0', borderRadius: 10, background: '#f8fafc' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div>$1 = ៛{rate.toLocaleString('en-US')}</div>
      <div>{text.due}: <strong style={{ fontSize: 24 }}>{quote?.usdDue ?? '—'}</strong><br />{text.reference}: <strong>{quote?.khrDue ?? '—'}</strong></div>
      <div role="group" aria-label={text.currency} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {(['USD', 'KHR'] as const).map(code => <button key={code} type="button" disabled={disabled} aria-pressed={currency === code}
          onClick={() => { if (code !== currency) onCurrencyChange(code); focusInput() }} style={{ ...button, background: currency === code ? '#dbeafe' : '#fff' }}>{code}</button>)}
      </div>
      <label htmlFor="desktop-cash-tendered">{text.received} ({currency})</label>
      <input ref={inputRef} id="desktop-cash-tendered" type="text" inputMode="none" autoComplete="off" value={value} disabled={disabled}
        onChange={event => { const next = currency === 'USD' && event.target.value === '.' ? '0.' : event.target.value; if (acceptCashInput(next, currency)) onChange(next) }}
        aria-invalid={value !== '' && !quote?.sufficient} aria-describedby="cash-tender-status"
        style={{ width: '100%', boxSizing: 'border-box', height: 48, padding: '0 10px', fontSize: 22, borderRadius: 8, border: '1px solid #94a3b8' }} />
      {currency === 'KHR' && quote?.received !== null && quote?.received !== undefined && <div aria-label={text.received}>{formatAmount(quote.received, 'KHR')}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4, fontWeight: 800 }}><span>{text.change} ({currency})</span><output aria-live="polite">{quote?.change ?? '—'}</output></div>
      <div id="cash-tender-status" role="status" style={{ color: '#b91c1c', fontSize: 13 }}>{!quote?.sufficient ? text.insufficient : ''}</div>
      {currency === 'KHR' && <div style={{ fontSize: 12, color: '#64748b' }}>{text.helper}</div>}
    </div>
    <div role="group" aria-label={text.keypad} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, alignContent: 'start' }}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'backspace', ...(currency === 'USD' ? ['.'] : [])].map(key => <button type="button" key={key} disabled={disabled} style={{ ...button, ...(key === 'clear' ? { fontSize: 14 } : {}) }}
        aria-label={key === 'clear' ? text.clear : key === 'backspace' ? text.backspace : key}
        onClick={() => { onChange(previous => editCashInput(previous, key, currency)); focusInput() }}>{key === 'clear' ? text.clear : key === 'backspace' ? '⌫' : key}</button>)}
    </div>
  </section>
}
