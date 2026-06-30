'use client'

import { useEffect, useMemo, useState } from 'react'

type ApiStatus = {
  status?: string
  scope?: string
  generatedAt?: string
  assets?: {
    stores?: AssetList
    products?: AssetList
    sales?: AssetList<SaleItem>
    customerOrders?: AssetList<CustomerOrderItem>
    paymentMethodStats?: {
      groups?: PaymentMethodGroup[]
    }
    memberStats?: {
      total?: number
      byStatus?: { status: string; count: number }[]
      balanceExposure?: boolean
      ledgerExposure?: boolean
    }
    telegramEntryStatus?: StatusObject
    inviteBindBotEntryStatus?: StatusObject
    deviceStatus?: StatusObject
    printerStatus?: StatusObject
    posStatus?: StatusObject
    offlineSyncStatus?: StatusObject
  }
  warnings?: string[]
  error?: string
  message?: string
}

type AssetList<T = unknown> = {
  total?: number
  returned?: number
  items?: T[]
}

type SaleItem = {
  orderNo: string | null
  saleType: string
  status: string
  lineAmount: number
  createdAt: string
}

type CustomerOrderItem = {
  orderNo: string
  status: string
  paymentStatus: string
  totalAmount: number
  createdAt: string
  paidAt: string | null
}

type PaymentMethodGroup = {
  paymentMethod: string
  paymentStatus: string
  count: number
  amount: number
}

type StatusObject = {
  status?: string
  message?: string
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; data: ApiStatus }
  | { status: 'error'; statusCode?: number; message: string }

type CheckTone = 'pass' | 'pending' | 'readonly' | 'fail'

const todayKey = new Date().toLocaleDateString('en-CA')

function sameLocalDay(value: string | null | undefined) {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  return date.toLocaleDateString('en-CA') === todayKey
}

function money(value: number) {
  return `$${value.toFixed(2)}`
}

function sumTodaySales(sales: SaleItem[]) {
  return sales
    .filter((sale) => sale.saleType === 'SALE' && sale.status === 'COMPLETED' && sameLocalDay(sale.createdAt))
    .reduce((sum, sale) => sum + (Number(sale.lineAmount) || 0), 0)
}

function sumTodayCustomerOrders(orders: CustomerOrderItem[]) {
  return orders
    .filter((order) => order.status === 'COMPLETED' && order.paymentStatus === 'PAID' && sameLocalDay(order.paidAt ?? order.createdAt))
    .reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0)
}

function countTodayOrders(sales: SaleItem[], orders: CustomerOrderItem[]) {
  const saleOrderNos = new Set(
    sales
      .filter((sale) => sale.saleType === 'SALE' && sale.status === 'COMPLETED' && sameLocalDay(sale.createdAt))
      .map((sale) => sale.orderNo || `sale:${sale.createdAt}:${sale.lineAmount}`),
  )
  const customerOrderNos = new Set(
    orders
      .filter((order) => order.status === 'COMPLETED' && order.paymentStatus === 'PAID' && sameLocalDay(order.paidAt ?? order.createdAt))
      .map((order) => order.orderNo),
  )
  return saleOrderNos.size + customerOrderNos.size
}

function statusTone(status?: string): CheckTone {
  if (status === 'pending_real_device_validation') return 'pending'
  if (status === 'placeholder_only') return 'readonly'
  if (status) return 'pass'
  return 'fail'
}

function getErrorText(data: ApiStatus, statusCode: number) {
  return data.message || data.error || `接口请求失败，HTTP ${statusCode}`
}

export default function MinoBosAssetsCheckPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  async function load() {
    setState({ status: 'loading' })
    try {
      const response = await fetch('/api/mino-bos/business-assets', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      const data = await response.json().catch(() => ({} as ApiStatus))
      if (!response.ok) {
        setState({ status: 'error', statusCode: response.status, message: getErrorText(data, response.status) })
        return
      }
      setState({ status: 'ok', data })
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : '无法连接只读资产接口' })
    }
  }

  useEffect(() => { load() }, [])

  const data = state.status === 'ok' ? state.data : null
  const assets = data?.assets
  const sales = assets?.sales?.items ?? []
  const customerOrders = assets?.customerOrders?.items ?? []

  const summary = useMemo(() => {
    const todaySales = sumTodaySales(sales)
    const todayCustomerOrderSales = sumTodayCustomerOrders(customerOrders)
    return {
      todaySalesAmount: todaySales + todayCustomerOrderSales,
      todayOrderCount: countTodayOrders(sales, customerOrders),
    }
  }, [sales, customerOrders])

  return (
    <main style={s.page}>
      <section style={s.header}>
        <div>
          <p style={s.eyebrow}>Batch 3C Internal Check</p>
          <h1 style={s.title}>Mino BOS Business Assets Read-only Check</h1>
        </div>
        <button style={s.refreshButton} onClick={load} disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Loading' : 'Refresh'}
        </button>
      </section>

      {state.status === 'error' && (
        <section style={{ ...s.panel, borderColor: '#ef4444' }}>
          <StatusBadge tone="fail" label="FAIL" />
          <h2 style={s.panelTitle}>接口请求失败</h2>
          <p style={s.errorText}>{state.message}</p>
          {state.statusCode ? <p style={s.muted}>HTTP status: {state.statusCode}</p> : null}
        </section>
      )}

      {state.status === 'loading' && (
        <section style={s.panel}>
          <StatusBadge tone="pending" label="PENDING" />
          <h2 style={s.panelTitle}>正在读取只读资产接口</h2>
          <p style={s.muted}>GET /api/mino-bos/business-assets</p>
        </section>
      )}

      {data && (
        <>
          <section style={s.gridThree}>
            <InfoCard label="status" value={data.status ?? 'missing'} tone={data.status === 'ok' ? 'pass' : 'fail'} />
            <InfoCard label="scope" value={data.scope ?? 'missing'} tone={data.scope === 'read_only' ? 'readonly' : 'fail'} />
            <InfoCard label="generatedAt" value={data.generatedAt ?? 'missing'} tone={data.generatedAt ? 'pass' : 'fail'} />
          </section>

          <section style={s.panel}>
            <h2 style={s.panelTitle}>核心资产只读接入状态</h2>
            <div style={s.checkGrid}>
              <CheckRow name="Store" detail={`${assets?.stores?.total ?? 0} total / ${assets?.stores?.returned ?? 0} returned`} tone="readonly" />
              <CheckRow name="Product" detail={`${assets?.products?.total ?? 0} total / ${assets?.products?.returned ?? 0} returned`} tone="readonly" />
              <CheckRow name="SaleRecord" detail={`${assets?.sales?.total ?? 0} total / ${assets?.sales?.returned ?? 0} returned`} tone="readonly" />
              <CheckRow name="Customer order" detail={`${assets?.customerOrders?.total ?? 0} total / ${assets?.customerOrders?.returned ?? 0} returned`} tone="readonly" />
            </div>
          </section>

          <section style={s.panel}>
            <h2 style={s.panelTitle}>聚合统计</h2>
            <div style={s.metricGrid}>
              <Metric label="今日销售额" value={money(summary.todaySalesAmount)} />
              <Metric label="今日订单数" value={String(summary.todayOrderCount)} />
              <Metric label="商品数量" value={String(assets?.products?.total ?? 0)} />
              <Metric label="顾客订单数量" value={String(assets?.customerOrders?.total ?? 0)} />
              <Metric label="会员数量统计" value={String(assets?.memberStats?.total ?? 0)} />
            </div>

            <div style={s.subsection}>
              <h3 style={s.subTitle}>支付方式分布</h3>
              {(assets?.paymentMethodStats?.groups?.length ?? 0) > 0 ? (
                <div style={s.table}>
                  {assets?.paymentMethodStats?.groups?.map((group) => (
                    <div key={`${group.paymentMethod}:${group.paymentStatus}`} style={s.tableRow}>
                      <span>{group.paymentMethod} / {group.paymentStatus}</span>
                      <span>{group.count} orders</span>
                      <span>{money(Number(group.amount) || 0)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={s.muted}>暂无支付方式统计</p>
              )}
            </div>

            <div style={s.subsection}>
              <h3 style={s.subTitle}>会员状态统计</h3>
              {(assets?.memberStats?.byStatus?.length ?? 0) > 0 ? (
                <div style={s.table}>
                  {assets?.memberStats?.byStatus?.map((group) => (
                    <div key={group.status} style={s.tableRow}>
                      <span>{group.status}</span>
                      <span>{group.count} members</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={s.muted}>暂无会员状态统计</p>
              )}
            </div>
          </section>

          <section style={s.panel}>
            <h2 style={s.panelTitle}>占位状态</h2>
            <div style={s.checkGrid}>
              <CheckRow name="Telegram binding" detail={assets?.telegramEntryStatus?.status ?? 'missing'} tone={statusTone(assets?.telegramEntryStatus?.status)} />
              <CheckRow name="Invite / Bind / Bot entry" detail={assets?.inviteBindBotEntryStatus?.status ?? 'missing'} tone={statusTone(assets?.inviteBindBotEntryStatus?.status)} />
            </div>
          </section>

          <section style={s.panel}>
            <h2 style={s.panelTitle}>Pending Real Device Validation</h2>
            <div style={s.checkGrid}>
              <CheckRow name="Device" detail={assets?.deviceStatus?.status ?? 'missing'} tone={statusTone(assets?.deviceStatus?.status)} />
              <CheckRow name="Printer" detail={assets?.printerStatus?.status ?? 'missing'} tone={statusTone(assets?.printerStatus?.status)} />
              <CheckRow name="POS" detail={assets?.posStatus?.status ?? 'missing'} tone={statusTone(assets?.posStatus?.status)} />
              <CheckRow name="Offline sync" detail={assets?.offlineSyncStatus?.status ?? 'missing'} tone={statusTone(assets?.offlineSyncStatus?.status)} />
            </div>
          </section>
        </>
      )}

      <section style={s.panel}>
        <h2 style={s.panelTitle}>风险提示</h2>
        <div style={s.riskGrid}>
          {[
            '本页面只读',
            '不写回店小二',
            '不修改订单',
            '不修改支付状态',
            '不读取会员余额',
            '不读取支付凭证',
            '设备状态等待真实设备验证',
          ].map((item) => (
            <div key={item} style={s.riskItem}>
              <StatusBadge tone="readonly" label="READ-ONLY" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

function InfoCard(props: { label: string; value: string; tone: CheckTone }) {
  return (
    <section style={s.infoCard}>
      <StatusBadge tone={props.tone} label={props.tone === 'readonly' ? 'READ-ONLY' : props.tone.toUpperCase()} />
      <div style={s.infoLabel}>{props.label}</div>
      <div style={s.infoValue}>{props.value}</div>
    </section>
  )
}

function CheckRow(props: { name: string; detail: string; tone: CheckTone }) {
  return (
    <div style={s.checkRow}>
      <StatusBadge tone={props.tone} label={props.tone === 'readonly' ? 'READ-ONLY' : props.tone.toUpperCase()} />
      <div>
        <div style={s.checkName}>{props.name}</div>
        <div style={s.muted}>{props.detail}</div>
      </div>
    </div>
  )
}

function Metric(props: { label: string; value: string }) {
  return (
    <div style={s.metric}>
      <div style={s.metricLabel}>{props.label}</div>
      <div style={s.metricValue}>{props.value}</div>
    </div>
  )
}

function StatusBadge(props: { tone: CheckTone; label: string }) {
  const palette = {
    pass: { bg: '#dcfce7', color: '#166534' },
    pending: { bg: '#fef3c7', color: '#92400e' },
    readonly: { bg: '#dbeafe', color: '#1e40af' },
    fail: { bg: '#fee2e2', color: '#991b1b' },
  }[props.tone]

  return <span style={{ ...s.badge, background: palette.bg, color: palette.color }}>{props.label}</span>
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f8fafc',
    color: '#111827',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'flex-start',
    maxWidth: 1120,
    width: '100%',
    margin: '0 auto',
  },
  eyebrow: { margin: 0, fontSize: 12, color: '#64748b', fontWeight: 700 },
  title: { margin: '4px 0 0', fontSize: 24, lineHeight: 1.2 },
  refreshButton: {
    border: '1px solid #cbd5e1',
    background: '#fff',
    borderRadius: 8,
    padding: '8px 12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  gridThree: {
    maxWidth: 1120,
    width: '100%',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
  },
  panel: {
    maxWidth: 1120,
    width: '100%',
    margin: '0 auto',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 16,
  },
  panelTitle: { margin: '8px 0 12px', fontSize: 16 },
  infoCard: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 16,
    minHeight: 116,
  },
  infoLabel: { marginTop: 12, color: '#64748b', fontSize: 12, fontWeight: 700 },
  infoValue: { marginTop: 6, fontSize: 15, fontWeight: 700, wordBreak: 'break-word' },
  checkGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 10,
  },
  checkRow: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 12,
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
  },
  checkName: { fontWeight: 700, marginBottom: 4 },
  metricGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 10,
  },
  metric: { border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 },
  metricLabel: { color: '#64748b', fontSize: 12, fontWeight: 700 },
  metricValue: { marginTop: 6, fontSize: 20, fontWeight: 800 },
  subsection: { marginTop: 16 },
  subTitle: { margin: '0 0 8px', fontSize: 14 },
  table: { border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' },
  tableRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto',
    gap: 12,
    padding: '10px 12px',
    borderBottom: '1px solid #e2e8f0',
    fontSize: 13,
  },
  riskGrid: { display: 'grid', gap: 8 },
  riskItem: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    padding: '3px 7px',
    fontSize: 11,
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },
  muted: { color: '#64748b', fontSize: 12, margin: 0, wordBreak: 'break-word' },
  errorText: { color: '#991b1b', fontWeight: 700 },
}
