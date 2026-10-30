'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useWorkMode } from '@/app/components/WorkModeProvider'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import { formatMoney } from '@/lib/currency'
import type { ProfitPeriod, SalesProfit } from '@/lib/inventory-profit/contract'
import {
  inventoryProfitError,
  telegramPresenceHeaders,
  TELEGRAM_PRESENCE_REQUIRED,
} from '@/lib/inventory-profit/client'
import styles from '../inventory-profit.module.css'

const DEV_CTX = process.env.NODE_ENV !== 'production' ? OWNER_CTX : undefined
const PERIODS: Array<{ value: ProfitPeriod; label: string }> = [
  { value: 'TODAY', label: '今日' },
  { value: 'WEEK', label: '本周' },
  { value: 'MONTH', label: '本月' },
]

type ProfitResponse = {
  asOf: string
  data: SalesProfit
}

export default function SalesProfitPage() {
  const { realRole, currencyCode } = useWorkMode()
  const [period, setPeriod] = useState<ProfitPeriod>('TODAY')
  const [result, setResult] = useState<ProfitResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const presence = telegramPresenceHeaders()
    if (!presence) {
      setResult(null)
      setError(TELEGRAM_PRESENCE_REQUIRED)
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const response = await apiFetch(`/api/inventory-profit/sales-profit?period=${period}`, {
        cache: 'no-store',
        headers: presence,
      }, DEV_CTX)
      if (!response.ok) throw new Error(await inventoryProfitError(response))
      setResult(await response.json() as ProfitResponse)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '数据暂时无法更新')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    if (realRole === 'OWNER') void load()
  }, [realRole, load])

  if (realRole !== 'OWNER') {
    return <main className={styles.page}><div className={styles.shell}><p className={styles.error}>仅老板可使用</p></div></main>
  }

  const profit = result?.data ?? null
  const metrics = profit ? [
    { label: '净销售额', value: formatMoney(profit.netSales, currencyCode) },
    { label: '销售成本', value: profit.costOfGoodsSold === null ? '—' : formatMoney(profit.costOfGoodsSold, currencyCode) },
    { label: '销售毛利', value: profit.grossProfit === null ? '—' : formatMoney(profit.grossProfit, currencyCode) },
    { label: '销售毛利率', value: profit.grossMarginRate === null ? '—' : `${(profit.grossMarginRate * 100).toFixed(1)}%` },
    { label: '成本覆盖率', value: `${(profit.costCoverageRate * 100).toFixed(1)}%` },
  ] : []

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <Link href="/dashboard" className={styles.back}>‹ 返回老板概览</Link>
            <h1 className={styles.title}>销售利润</h1>
            <p className={styles.subtitle}>成本口径：每日定期加权平均成本</p>
          </div>
        </header>

        <div className={styles.tabs} aria-label="查看周期">
          {PERIODS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={styles.tab}
              aria-pressed={period === item.value}
              disabled={loading}
              onClick={() => setPeriod(item.value)}
            >
              {item.label}
            </button>
          ))}
          <button type="button" className={styles.secondary} disabled={loading} onClick={() => void load()}>
            {loading ? '更新中…' : '重新加载'}
          </button>
        </div>

        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        {profit && result ? (
          <>
            <div className={styles.grid} aria-live="polite">
              {metrics.map((metric) => (
                <section key={metric.label} className={styles.card}>
                  <div className={styles.metricLabel}>{metric.label}</div>
                  <div className={styles.metricValue}>{metric.value}</div>
                </section>
              ))}
            </div>
            {profit.costCoverageRate < 1 ? (
              <p className={styles.notice}>成本数据未完全覆盖，不计算销售成本、销售毛利和毛利率。</p>
            ) : null}
            <p className={styles.asOf}>数据截至：{new Date(result.asOf).toLocaleString()}</p>
          </>
        ) : null}
      </div>
    </main>
  )
}
