'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch, STAFF_CTX, OWNER_CTX } from '@/lib/api'
import { useLocale } from '@/app/components/LangProvider'
import { useWorkMode } from '@/app/components/WorkModeProvider'
import OrderDetailSheet from '@/app/components/OrderDetailSheet'
import CheckoutSheet from '@/app/components/CheckoutSheet'

// ─── Types ────────────────────────────────────────────────────────────────────

type CustomerOrderItem = {
  productId: string
  name: string
  spec: string | null
  price: number
  quantity: number
  lineAmount: number
}

type CustomerOrderRecord = {
  id: string
  orderNo: string
  storeCode: string
  customerTelegramId: string | null
  items: CustomerOrderItem[]
  totalAmount: number
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED'
  paymentStatus: 'UNPAID' | 'PAID'
  paymentMethod: string | null
  paidAt: string | null
  createdAt: string
}

type Summary = {
  saleCount: number
  refundCount: number
  netAmount: number
  cashSaleAmount?: number
  khqrSaleAmount?: number
}

type RecordItem = {
  id: string
  recordNo: string
  orderNo: string | null
  productNameSnapshot: string
  specSnapshot: string | null
  quantity: number
  lineAmount: number
  saleType: 'SALE' | 'REFUND'
  refundReason: string | null
  createdAt: string
  paymentMethod?: 'CASH' | 'KHQR' | null
  paymentStatus?: string | null
}

type OrderGroup = {
  kind: 'order'
  orderNo: string
  createdAt: string
  items: RecordItem[]
  totalAmount: number
  paymentMethod?: 'CASH' | 'KHQR' | null
  paymentStatus?: string | null
}

type RefundEntry = {
  kind: 'refund'
  item: RecordItem
}

type CustomerOrderEntry = {
  kind: 'customer_order'
  orderNo: string
  createdAt: string
  itemSummary: string
  totalAmount: number
  paymentMethod: string | null
}

type DisplayEntry = OrderGroup | RefundEntry | CustomerOrderEntry

// ─── Utils ────────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

const ORDER_COLORS = ['#1677ff', '#52c41a', '#fa8c16', '#722ed1']

function buildItemSummary(items: RecordItem[]): string {
  return items.map((i) => `${i.productNameSnapshot}×${i.quantity}`).join('、')
}

function buildSaleEntries(items: RecordItem[]): DisplayEntry[] {
  const groupMap = new Map<string, OrderGroup>()
  const refunds: RefundEntry[] = []

  for (const item of items) {
    if (item.saleType === 'SALE') {
      const key = item.orderNo ?? item.recordNo
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          kind: 'order', orderNo: key, createdAt: item.createdAt, items: [], totalAmount: 0,
          paymentMethod: item.paymentMethod ?? null,
          paymentStatus: item.paymentStatus ?? null,
        })
      }
      const g = groupMap.get(key)!
      g.items.push(item)
      g.totalAmount += item.lineAmount
    } else {
      refunds.push({ kind: 'refund', item })
    }
  }

  const all: DisplayEntry[] = [...groupMap.values(), ...refunds]
  all.sort((a, b) => {
    const at = a.kind === 'order' ? a.createdAt : a.kind === 'customer_order' ? a.createdAt : a.item.createdAt
    const bt = b.kind === 'order' ? b.createdAt : b.kind === 'customer_order' ? b.createdAt : b.item.createdAt
    return bt.localeCompare(at)
  })
  return all
}

function mergeEntries(saleEntries: DisplayEntry[], paidCustomerOrders: CustomerOrderRecord[]): DisplayEntry[] {
  const coEntries: CustomerOrderEntry[] = paidCustomerOrders.map((o) => ({
    kind: 'customer_order' as const,
    orderNo: o.orderNo,
    createdAt: o.paidAt ?? o.createdAt,
    itemSummary: buildOrderItemSummary(o.items),
    totalAmount: o.totalAmount,
    paymentMethod: o.paymentMethod,
  }))

  const all = [...saleEntries, ...coEntries]
  all.sort((a, b) => {
    const at = a.kind === 'order' ? a.createdAt : a.kind === 'customer_order' ? a.createdAt : a.item.createdAt
    const bt = b.kind === 'order' ? b.createdAt : b.kind === 'customer_order' ? b.createdAt : b.item.createdAt
    return bt.localeCompare(at)
  })
  return all.slice(0, 5)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { t, lang, setLang } = useLocale()
  const { realRole, isOwnerInStaffMode, enterStaffMode, exitStaffMode } = useWorkMode()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [entries, setEntries] = useState<DisplayEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [storeName, setStoreName] = useState<string | null>(null)
  const [selectedOrderNo, setSelectedOrderNo] = useState<string | null>(null)
  const [checkoutOrder, setCheckoutOrder] = useState<{ orderNo: string; totalAmount: number } | null>(null)
  const [loadKey, setLoadKey] = useState(0)
  const [customerOrders, setCustomerOrders] = useState<CustomerOrderRecord[]>([])
  const [ordersKey, setOrdersKey] = useState(0)
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null)
  const [customerCheckout, setCustomerCheckout] = useState<{ id: string; orderNo: string; totalAmount: number } | null>(null)

  useEffect(() => {
    const today = todayStr()
    const params = new URLSearchParams({ dateFrom: today, dateTo: today, pageSize: '30' })

    Promise.all([
      apiFetch(`/api/records?${params}`, undefined, STAFF_CTX).then((res) => res.json()),
      apiFetch('/api/me', { cache: 'no-store' }, STAFF_CTX).then((res) => res.json()),
      // OWNER 额外加载今日已付款顾客订单，用于叠加概览与最近记录
      realRole === 'OWNER'
        ? apiFetch(`/api/customer-orders?paymentStatus=PAID&dateFrom=${today}`, undefined, OWNER_CTX)
            .then((r) => r.json())
            .catch(() => [])
        : Promise.resolve([]),
    ])
      .then(([data, me, paidOrdersRaw]) => {
        const paidOrders = (Array.isArray(paidOrdersRaw) ? paidOrdersRaw : []) as CustomerOrderRecord[]

        // 叠加顾客订单到今日概览
        if (paidOrders.length > 0) {
          const coTotal   = paidOrders.reduce((s, o) => s + o.totalAmount, 0)
          const coCash    = paidOrders.filter((o) => o.paymentMethod === 'CASH').reduce((s, o) => s + o.totalAmount, 0)
          const coQR      = paidOrders.filter((o) => o.paymentMethod === 'QR').reduce((s, o) => s + o.totalAmount, 0)
          const base: Summary = data.summary ?? { saleCount: 0, refundCount: 0, netAmount: 0 }
          setSummary({
            saleCount:      base.saleCount + paidOrders.length,
            refundCount:    base.refundCount,
            netAmount:      base.netAmount + coTotal,
            cashSaleAmount: (base.cashSaleAmount ?? 0) + coCash,
            khqrSaleAmount: (base.khqrSaleAmount ?? 0) + coQR,
          })
        } else {
          setSummary(data.summary)
        }

        setEntries(mergeEntries(buildSaleEntries(data.items ?? []), paidOrders))
        setStoreName(me.storeName ?? me.tenantName ?? null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [loadKey, realRole])

  // 加载顾客订单（仅 OWNER 可见）
  useEffect(() => {
    if (realRole !== 'OWNER') return
    apiFetch('/api/customer-orders?status=PENDING,CONFIRMED,COMPLETED', undefined, OWNER_CTX)
      .then((r) => r.json())
      .then((data) => setCustomerOrders(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [ordersKey, realRole])

  // 顾客订单自动刷新：页面重新可见时立刻刷新 + 每 30 秒后台轮询
  useEffect(() => {
    if (realRole !== 'OWNER') return
    function onVisible() {
      if (!document.hidden) setOrdersKey((k) => k + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => setOrdersKey((k) => k + 1), 30_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [realRole])

  async function updateOrderStatus(id: string, status: string) {
    setUpdatingOrderId(id)
    try {
      await apiFetch(`/api/customer-orders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }, OWNER_CTX)
      setOrdersKey((k) => k + 1)
    } catch (e) {
      console.error('更新顾客订单状态失败', e)
    } finally {
      setUpdatingOrderId(null)
    }
  }

  async function handleCustomerOrderPay(id: string, method: 'CASH' | 'KHQR') {
    const res = await apiFetch(`/api/customer-orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMethod: method === 'KHQR' ? 'QR' : 'CASH' }),
    }, OWNER_CTX)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? '收款登记失败')
    }
  }

  return (
    <main style={s.page}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
      {/* ── Brand header ── */}
      <div style={s.brandBar}>
        <div style={s.brandLeft}>
          <span style={s.brandIcon}>🏪</span>
          <div style={s.brandTextBlock}>
            <div style={s.brandTitle}>{storeName ?? 'E-Shop'}</div>
            <div style={s.brandSub}>E-Shop 店小二助手</div>
          </div>
        </div>
        <div style={s.brandRight}>
          <button style={s.switchBtn} onClick={() => setLang(lang === 'zh' ? 'km' : 'zh')}>
            {t('home.langBtn')}
          </button>
          {realRole === 'OWNER' && (
            <div style={s.modeRow}>
              <span style={s.modeLabelText}>
                {isOwnerInStaffMode ? t('home.modeLabelStaff') : t('home.modeLabelOwner')}
              </span>
              <button
                style={isOwnerInStaffMode ? s.switchBtn : { ...s.switchBtn, ...s.modeBtnOwner }}
                onClick={isOwnerInStaffMode ? exitStaffMode : enterStaffMode}
              >
                {isOwnerInStaffMode ? t('home.exitStaffModeBtn') : t('home.enterStaffModeBtn')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Today summary ── */}
      <div style={s.summaryCard}>
        <div style={s.summaryTitle}>{t('home.todaySummary')}</div>
        {loading ? (
          <div style={s.summarySkeletonWrap}>
            <div style={s.summarySkeleton} />
            <div style={s.summarySkeletonRow}>
              <div style={{ ...s.summarySkeleton, flex: 1, height: 32 }} />
              <div style={{ ...s.summarySkeleton, flex: 1, height: 32 }} />
            </div>
          </div>
        ) : (
          <>
            <div style={s.netRow}>
              <span style={s.netLabel}>{t('home.netIncome')}</span>
              <span style={{
                ...s.netAmount,
                color: (summary?.netAmount ?? 0) >= 0 ? '#52c41a' : '#ff4d4f',
              }}>
                ${(summary?.netAmount ?? 0).toFixed(2)}
              </span>
            </div>
            {((summary?.cashSaleAmount ?? 0) > 0 || (summary?.khqrSaleAmount ?? 0) > 0) && (
              <div style={s.payBreakRow}>
                <span style={s.payBreakItem}>💵 ${(summary?.cashSaleAmount ?? 0).toFixed(2)}</span>
                <span style={s.payBreakSep}>·</span>
                <span style={s.payBreakItem}>📱 KHQR ${(summary?.khqrSaleAmount ?? 0).toFixed(2)}</span>
              </div>
            )}
            <div style={s.summaryGrid}>
              <SummaryCell label={t('home.sale')} value={String(summary?.saleCount ?? 0)} unit={t('home.unit')} />
              <div style={s.summaryDivider} />
              <SummaryCell label={t('home.refund')} value={String(summary?.refundCount ?? 0)} unit={t('home.unit')} />
            </div>
          </>
        )}
      </div>

      {/* ── Quick actions ── */}
      <div style={s.sectionTitle}>{t('home.quickActions')}</div>
      <div style={s.actionGrid}>
        <ActionBtn href="/sale" icon="💰" label={t('home.sale')} color="#1677ff" />
        <ActionBtn href="/refund" icon="↩️" label={t('home.refund')} color="#ff4d4f" />
        <ActionBtn href="/records" icon="📋" label={t('home.records')} color="#fa8c16" />
      </div>

      {/* ── 顾客订单区（仅 OWNER 可见，常驻显示） ── */}
      {realRole === 'OWNER' && (() => {
        const actionableCount = customerOrders.length
        return (
          <div style={s.coSection}>
            <div style={s.coSectionHeader}>
              <span style={s.coSectionTitle}>顾客订单</span>
              {actionableCount > 0 && (
                <span style={s.coBadge}>{actionableCount}</span>
              )}
            </div>
            {actionableCount === 0 ? (
              <div style={s.coEmpty}>暂无待处理订单</div>
            ) : (
              customerOrders.map((order) => (
                <CustomerOrderCard
                  key={order.id}
                  order={order}
                  updating={updatingOrderId === order.id}
                  onConfirm={() => updateOrderStatus(order.id, 'CONFIRMED')}
                  onComplete={() => updateOrderStatus(order.id, 'COMPLETED')}
                  onCancel={() => updateOrderStatus(order.id, 'CANCELLED')}
                  onCollect={() => setCustomerCheckout({ id: order.id, orderNo: order.orderNo, totalAmount: order.totalAmount })}
                />
              ))
            )}
          </div>
        )
      })()}

      {/* ── Recent records ── */}
      <div style={s.sectionHeader}>
        <span style={s.sectionTitle}>{t('home.recentRecords')}</span>
        <Link href="/records" style={s.viewAll}>{t('home.viewAll')}</Link>
      </div>

      {loading && (
        <div style={s.recentSkeletonWrap}>
          {[52, 44, 52].map((h, i) => (
            <div key={i} style={{ ...s.summarySkeleton, height: h, borderRadius: 10, margin: '0 12px 8px' }} />
          ))}
        </div>
      )}

      {!loading && entries.length === 0 && (
        <div style={s.emptyHint}>{t('home.noRecordsToday')}</div>
      )}

      {entries.map((entry, i) =>
        entry.kind === 'order' ? (
          <OrderCard
            key={entry.orderNo}
            group={entry}
            index={i}
            tagSale={t('home.tagSale')}
            itemCountUnit={t('home.itemCountUnit')}
            checkoutBtn={t('sale.checkoutBtn')}
            onOpen={() => setSelectedOrderNo(entry.orderNo)}
            onCheckout={entry.paymentMethod === null
              ? () => setCheckoutOrder({ orderNo: entry.orderNo, totalAmount: entry.totalAmount })
              : undefined}
          />
        ) : entry.kind === 'customer_order' ? (
          <CustomerOrderEntryCard key={entry.orderNo} entry={entry} />
        ) : (
          <RefundCard key={entry.item.id + '-' + i} item={entry.item} tagRefund={t('home.tagRefund')} />
        )
      )}

      <OrderDetailSheet
        orderNo={selectedOrderNo}
        onClose={() => setSelectedOrderNo(null)}
      />

      {checkoutOrder && (
        <CheckoutSheet
          orderNo={checkoutOrder.orderNo}
          totalAmount={checkoutOrder.totalAmount}
          onSuccess={() => { setCheckoutOrder(null); setLoadKey((k) => k + 1) }}
          onClose={() => setCheckoutOrder(null)}
        />
      )}

      {customerCheckout && (
        <CheckoutSheet
          orderNo={customerCheckout.orderNo}
          totalAmount={customerCheckout.totalAmount}
          onSuccess={() => {
            setCustomerCheckout(null)
            setOrdersKey((k) => k + 1)
            setLoadKey((k) => k + 1)  // 触发概览 + 最近记录刷新
          }}
          onClose={() => setCustomerCheckout(null)}
          onOverridePay={(method) => handleCustomerOrderPay(customerCheckout.id, method)}
        />
      )}
    </main>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCell({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div style={s.summaryCell}>
      <div style={s.summaryCellValue}>{value}<span style={s.summaryUnit}>{unit}</span></div>
      <div style={s.summaryCellLabel}>{label}</div>
    </div>
  )
}

function ActionBtn({ href, icon, label, color }: {
  href: string; icon: string; label: string; color: string
}) {
  return (
    <Link href={href} style={{ ...s.actionBtn, borderColor: color + '33' }}>
      <span style={{ ...s.actionIcon, background: color + '15' }}>{icon}</span>
      <span style={{ ...s.actionLabel, color }}>{label}</span>
    </Link>
  )
}

function OrderCard({ group, index, tagSale, itemCountUnit, checkoutBtn, onOpen, onCheckout }: {
  group: OrderGroup; index: number; tagSale: string; itemCountUnit: string
  checkoutBtn: string; onOpen?: () => void; onCheckout?: () => void
}) {
  const isPending = group.paymentMethod === null
  const accent = isPending ? '#fa8c16' : ORDER_COLORS[index % ORDER_COLORS.length]
  const isSingle = group.items.length === 1
  return (
    <div
      style={{ ...s.recentCard, borderLeft: `3px solid ${accent}`, cursor: 'pointer', ...(isPending ? s.recentCardPending : {}) }}
      onClick={onOpen}
    >
      <div style={s.recentLeft}>
        <div style={s.recentTagRow}>
          <span style={s.tagSale}>{tagSale}</span>
          {isPending && <span style={s.tagPending}>待收款</span>}
        </div>
        <div style={s.recentProduct}>
          {isSingle
            ? group.items[0].productNameSnapshot +
              (group.items[0].specSnapshot ? ` · ${group.items[0].specSnapshot}` : '')
            : buildItemSummary(group.items)}
        </div>
        <div style={s.recentMeta}>
          {group.orderNo} · {fmtTime(group.createdAt)}
          {!isSingle && (
            <span style={s.itemCount}> · {group.items.length}{itemCountUnit}</span>
          )}
        </div>
      </div>
      <div style={s.recentRight}>
        <div style={{ ...s.recentAmount, color: '#1a1a1a' }}>
          +${group.totalAmount.toFixed(2)}
        </div>
        {isPending && onCheckout && (
          <button
            style={s.checkoutBtn}
            onClick={(e) => { e.stopPropagation(); onCheckout() }}
          >
            {checkoutBtn}
          </button>
        )}
      </div>
    </div>
  )
}

function RefundCard({ item, tagRefund }: { item: RecordItem; tagRefund: string }) {
  return (
    <div style={{ ...s.recentCard, ...s.recentCardRefund }}>
      <div style={s.recentLeft}>
        <span style={s.tagRefund}>{tagRefund}</span>
        <div style={s.recentProduct}>
          {item.productNameSnapshot}
          {item.specSnapshot && <span style={s.recentSpec}> · {item.specSnapshot}</span>}
        </div>
        <div style={s.recentMeta}>{fmtTime(item.createdAt)}</div>
      </div>
      <div style={{ ...s.recentAmount, color: '#ff4d4f' }}>
        -${Math.abs(item.lineAmount).toFixed(2)}
      </div>
    </div>
  )
}

function CustomerOrderEntryCard({ entry }: { entry: CustomerOrderEntry }) {
  const payIcon = entry.paymentMethod === 'QR' ? '📱' : '💵'
  return (
    <div style={{ ...s.recentCard, borderLeft: '3px solid #722ed1' }}>
      <div style={s.recentLeft}>
        <div style={s.recentTagRow}>
          <span style={{ ...s.tagSale, background: '#f9f0ff', color: '#722ed1' }}>扫码单</span>
          <span style={{ fontSize: 13 }}>{payIcon}</span>
        </div>
        <div style={s.recentProduct}>{entry.itemSummary}</div>
        <div style={s.recentMeta}>{entry.orderNo} · {fmtTime(entry.createdAt)}</div>
      </div>
      <div style={{ ...s.recentAmount, color: '#722ed1' }}>+${entry.totalAmount.toFixed(2)}</div>
    </div>
  )
}

const CO_STATUS_COLOR: Record<string, string> = {
  PENDING:   '#fa8c16',
  CONFIRMED: '#52c41a',
  COMPLETED: '#8c8c8c',
  CANCELLED: '#ff4d4f',
}
const CO_STATUS_LABEL: Record<string, string> = {
  PENDING:   '待确认',
  CONFIRMED: '已确认',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
}

function buildOrderItemSummary(items: CustomerOrderItem[]): string {
  return items.map((i) => `${i.name}×${i.quantity}`).join('、')
}

function CustomerOrderCard({
  order, updating, onConfirm, onComplete, onCancel, onCollect,
}: {
  order: CustomerOrderRecord
  updating: boolean
  onConfirm: () => void
  onComplete: () => void
  onCancel: () => void
  onCollect: () => void
}) {
  const [showDetail, setShowDetail] = useState(false)
  const needsPay = order.status === 'COMPLETED' && order.paymentStatus === 'UNPAID'
  const color = needsPay ? '#fa8c16' : (CO_STATUS_COLOR[order.status] ?? '#8c8c8c')
  const label = needsPay ? '待收款' : (CO_STATUS_LABEL[order.status] ?? order.status)

  return (
    <div
      style={{ ...s.recentCard, borderLeft: `3px solid ${color}`, margin: '0 8px 8px', background: '#fff', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', gap: 0, cursor: 'pointer' }}
      onClick={() => setShowDetail((d) => !d)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={s.recentLeft}>
          <div style={s.recentTagRow}>
            <span style={{ ...s.tagSale, background: color + '15', color, border: `1px solid ${color}44` }}>
              {label}
            </span>
            {order.customerTelegramId && (
              <span style={s.coTgBadge}>TG</span>
            )}
          </div>
          <div style={s.recentProduct}>{buildOrderItemSummary(order.items)}</div>
          <div style={s.recentMeta}>
            {order.orderNo} · {fmtTime(order.createdAt)}
          </div>
          {!updating && (
            <div style={s.coActions} onClick={(e) => e.stopPropagation()}>
              {order.status === 'PENDING' && (
                <>
                  <button style={s.coConfirmBtn} onClick={onConfirm}>✓ 确认</button>
                  <button style={s.coCancelBtn} onClick={onCancel}>✗ 取消</button>
                </>
              )}
              {order.status === 'CONFIRMED' && (
                <>
                  <button style={s.coCompleteBtn} onClick={onComplete}>完成</button>
                  <button style={s.coCancelBtn} onClick={onCancel}>取消</button>
                </>
              )}
            </div>
          )}
          {updating && <div style={s.coUpdating}>处理中…</div>}
        </div>
        <div style={s.recentRight}>
          <div style={{ ...s.recentAmount, color: '#1a1a1a' }}>
            ${order.totalAmount.toFixed(2)}
          </div>
          {needsPay && !updating && (
            <button style={s.checkoutBtn} onClick={(e) => { e.stopPropagation(); onCollect() }}>去收款</button>
          )}
          <span style={s.coExpandArrow}>{showDetail ? '▴' : '▾'}</span>
        </div>
      </div>
      {showDetail && (
        <div style={s.coDetail}>
          <div style={s.coDetailMeta}>
            <span>{order.orderNo}</span>
            <span style={{ color: '#ddd' }}>·</span>
            <span>{new Date(order.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          {order.items.map((item) => (
            <div key={item.productId} style={s.coDetailItem}>
              <div style={s.coDetailItemName}>
                {item.name}
                {item.spec && <span style={s.coDetailItemSpec}> · {item.spec}</span>}
              </div>
              <div style={s.coDetailItemRight}>
                <span style={s.coDetailItemUnit}>${item.price.toFixed(2)}×{item.quantity}</span>
                <span style={s.coDetailItemLine}>${item.lineAmount.toFixed(2)}</span>
              </div>
            </div>
          ))}
          <div style={s.coDetailFooter}>
            <span style={s.coDetailTotalLabel}>合计</span>
            <span style={s.coDetailTotalAmt}>${order.totalAmount.toFixed(2)}</span>
          </div>
          {order.customerTelegramId && (
            <div style={s.coDetailTg}>顾客 TG ID：{order.customerTelegramId}</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 480,
    margin: '0 auto',
    padding: '0 0 16px',
  },
  brandBar: {
    background: '#1677ff',
    padding: '16px 16px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  brandLeft: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  },
  brandIcon: {
    fontSize: 36,
    lineHeight: 1,
    marginTop: 2,
  },
  brandTextBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: 800,
    color: '#fff',
    letterSpacing: '-0.3px',
    lineHeight: 1.2,
  },
  brandSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
    marginTop: 3,
    letterSpacing: '0.01em',
  },
  brandRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 6,
  },
  switchBtn: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
    background: 'rgba(255,255,255,0.15)',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: 12,
    padding: '4px 10px',
    cursor: 'pointer',
  },
  modeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  modeLabelText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: 600,
  },
  modeBtnOwner: {
    background: 'rgba(250,140,22,0.85)',
    border: '1px solid rgba(250,140,22,0.5)',
    color: '#fff',
  },
  summaryCard: {
    background: '#fff',
    margin: '0 12px',
    marginTop: -10,
    borderRadius: 14,
    padding: '16px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    marginBottom: 16,
  },
  summaryTitle: {
    fontSize: 12,
    color: '#8c8c8c',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 10,
  },
  summarySkeletonWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  summarySkeletonRow: {
    display: 'flex',
    gap: 10,
  },
  summarySkeleton: {
    height: 20,
    borderRadius: 6,
    background: '#e8e8e8',
    animation: 'pulse 1.2s ease-in-out infinite',
  },
  recentSkeletonWrap: {},
  netRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  payBreakRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingBottom: 12,
    borderBottom: '1px solid #f0f0f0',
  },
  payBreakItem: { fontSize: 12, color: '#8c8c8c' },
  payBreakSep: { fontSize: 12, color: '#d9d9d9' },
  netLabel: {
    fontSize: 14,
    color: '#8c8c8c',
  },
  netAmount: {
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  summaryGrid: {
    display: 'flex',
    alignItems: 'center',
  },
  summaryCell: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
  },
  summaryCellValue: {
    fontSize: 20,
    fontWeight: 600,
    color: '#1a1a1a',
  },
  summaryUnit: {
    fontSize: 12,
    fontWeight: 400,
    color: '#8c8c8c',
    marginLeft: 2,
  },
  summaryCellLabel: {
    fontSize: 12,
    color: '#8c8c8c',
  },
  summaryDivider: {
    width: 1,
    height: 32,
    background: '#e8e8e8',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 16px',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#1a1a1a',
    padding: '0 16px',
    marginBottom: 8,
    display: 'block',
  },
  viewAll: {
    fontSize: 13,
    color: '#1677ff',
    textDecoration: 'none',
  },
  actionGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: 10,
    padding: '0 12px',
    marginBottom: 20,
  },
  actionBtn: {
    background: '#fff',
    border: '1.5px solid',
    borderRadius: 12,
    padding: '14px 8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    textDecoration: 'none',
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: 600,
  },
  recentCard: {
    background: '#fff',
    margin: '0 12px 8px',
    borderRadius: 10,
    padding: '12px 14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  recentCardRefund: {
    background: '#fff1f0',
  },
  recentCardPending: {
    background: '#fffbe6',
    border: '1px solid #ffe58f',
  },
  recentLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    flex: 1,
    minWidth: 0,
  },
  recentRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 6,
    flexShrink: 0,
  },
  recentTagRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  tagPending: {
    fontSize: 10,
    fontWeight: 600,
    background: '#fff7e6',
    color: '#fa8c16',
    border: '1px solid #ffd591',
    padding: '1px 6px',
    borderRadius: 4,
  },
  checkoutBtn: {
    fontSize: 12,
    fontWeight: 700,
    color: '#fff',
    background: '#fa8c16',
    border: 'none',
    borderRadius: 6,
    padding: '4px 10px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  recentProduct: {
    fontSize: 15,
    fontWeight: 500,
    color: '#1a1a1a',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  recentSpec: {
    fontWeight: 400,
    color: '#8c8c8c',
  },
  recentMeta: {
    fontSize: 12,
    color: '#bbb',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  itemCount: {
    color: '#1677ff',
  },
  recentAmount: {
    fontSize: 17,
    fontWeight: 700,
    flexShrink: 0,
  },
  tagSale: {
    fontSize: 10,
    fontWeight: 600,
    background: '#e6f4ff',
    color: '#1677ff',
    padding: '1px 6px',
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  tagRefund: {
    fontSize: 10,
    fontWeight: 600,
    background: '#fff1f0',
    color: '#ff4d4f',
    border: '1px solid #ffccc7',
    padding: '1px 6px',
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  emptyHint: {
    textAlign: 'center',
    color: '#bbb',
    padding: '24px 0',
    fontSize: 14,
  },

  // 顾客订单区块
  coSection: {
    background: '#fff7e6',
    border: '1px solid #ffe58f',
    borderRadius: 14,
    margin: '0 12px 20px',
    padding: '12px 0 4px',
  },
  coSectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 16px',
    marginBottom: 8,
  },
  coSectionTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: '#ad6800',
  },
  coBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: '#fff',
    background: '#ff4d4f',
    borderRadius: 10,
    padding: '1px 7px',
    minWidth: 20,
    textAlign: 'center' as const,
    animation: 'pulse 1.8s ease-in-out infinite',
  },
  coEmpty: {
    textAlign: 'center' as const,
    color: '#ad6800',
    fontSize: 13,
    padding: '8px 0 12px',
    opacity: 0.6,
  },
  // 顾客订单操作区
  coActions: {
    display: 'flex',
    gap: 6,
    marginTop: 6,
  },
  coConfirmBtn: {
    fontSize: 12,
    fontWeight: 700,
    color: '#fff',
    background: '#52c41a',
    border: 'none',
    borderRadius: 6,
    padding: '4px 12px',
    cursor: 'pointer',
  },
  coCompleteBtn: {
    fontSize: 12,
    fontWeight: 700,
    color: '#fff',
    background: '#1677ff',
    border: 'none',
    borderRadius: 6,
    padding: '4px 12px',
    cursor: 'pointer',
  },
  coCancelBtn: {
    fontSize: 12,
    fontWeight: 600,
    color: '#ff4d4f',
    background: '#fff1f0',
    border: '1px solid #ffccc7',
    borderRadius: 6,
    padding: '4px 12px',
    cursor: 'pointer',
  },
  coTgBadge: {
    fontSize: 9,
    fontWeight: 700,
    color: '#1677ff',
    background: '#e6f4ff',
    border: '1px solid #91caff',
    borderRadius: 3,
    padding: '1px 4px',
    letterSpacing: '0.05em',
  },
  coUpdating: {
    fontSize: 11,
    color: '#fa8c16',
    marginTop: 6,
    animation: 'pulse 1.2s ease-in-out infinite',
  },
  coExpandArrow: {
    fontSize: 14,
    color: '#c0b090',
    lineHeight: 1,
    userSelect: 'none' as const,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  coDetail: {
    borderTop: '1px solid #f0f0f0',
    marginTop: 10,
    paddingTop: 10,
  },
  coDetailMeta: {
    display: 'flex',
    gap: 6,
    fontSize: 11,
    color: '#bbb',
    marginBottom: 8,
    alignItems: 'center',
  },
  coDetailItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
    borderBottom: '1px solid #f5f5f5',
  },
  coDetailItemName: {
    fontSize: 13,
    fontWeight: 500,
    color: '#1a1a1a',
    flex: 1,
    marginRight: 8,
  },
  coDetailItemSpec: {
    fontSize: 11,
    color: '#aaa',
    fontWeight: 400,
  },
  coDetailItemRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  coDetailItemUnit: {
    fontSize: 11,
    color: '#aaa',
  },
  coDetailItemLine: {
    fontSize: 13,
    fontWeight: 600,
    color: '#1a1a1a',
    minWidth: 52,
    textAlign: 'right' as const,
  },
  coDetailFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0 0',
  },
  coDetailTotalLabel: {
    fontSize: 12,
    color: '#8c8c8c',
  },
  coDetailTotalAmt: {
    fontSize: 16,
    fontWeight: 700,
    color: '#1a1a1a',
  },
  coDetailTg: {
    marginTop: 6,
    fontSize: 11,
    color: '#1677ff',
    background: '#e6f4ff',
    borderRadius: 4,
    padding: '3px 8px',
    display: 'inline-block',
  },
}
