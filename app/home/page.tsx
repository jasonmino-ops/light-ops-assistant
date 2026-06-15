'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch, STAFF_CTX, OWNER_CTX } from '@/lib/api'
import { useLocale, type Lang } from '@/app/components/LangProvider'
import { useWorkMode } from '@/app/components/WorkModeProvider'
import CheckoutSheet from '@/app/components/CheckoutSheet'
import { publicUrl } from '@/lib/public-url'

// ─── Types ────────────────────────────────────────────────────────────────────

type CustomerOrderItem = {
  productId: string
  name: string
  spec: string | null
  price: number
  quantity: number
  lineAmount: number
  sugar?: string | null
}

type CustomerOrderRecord = {
  id: string
  orderNo: string
  storeCode: string
  customerTelegramId: string | null
  tableNo: string | null
  items: CustomerOrderItem[]
  totalAmount: number
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED'
  paymentStatus: 'UNPAID' | 'PAID'
  paymentMethod: string | null
  paidAt: string | null
  sourcePlatform: string | null
  campaignCode: string | null
  campaignIntent: string | null
  campaignLink: {
    creatorName: string | null
    videoTitle: string | null
    landingType: 'MARKETING_PAGE' | 'MENU'
  } | null
  createdAt: string
}

function sugarLabel(sugar: string, lang: Lang): string {
  const labelMap: Record<Lang, Record<string, string>> = {
    zh: {
      no_sugar: '无糖',
      '25': '微糖 25%',
      '50': '半糖 50%',
      '75': '少糖 75%',
      '100': '正常糖 100%',
    },
    en: {
      no_sugar: 'No sugar',
      '25': 'Light sugar 25%',
      '50': 'Half sugar 50%',
      '75': 'Less sugar 75%',
      '100': 'Regular sugar 100%',
    },
    km: {
      no_sugar: 'មិនដាក់ស្ករ',
      '25': 'ស្ករតិច 25%',
      '50': 'ស្ករពាក់កណ្តាល 50%',
      '75': 'ស្ករ 75%',
      '100': 'ស្ករធម្មតា 100%',
    },
  }
  const labels = labelMap[lang] ?? labelMap.zh
  if (sugar in labels) return labels[sugar as keyof typeof labels]
  return sugar
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
  source?: 'SALE_RECORD' | 'CUSTOMER_ORDER'
}

type OrderGroup = {
  kind: 'order'
  orderNo: string
  createdAt: string
  items: RecordItem[]
  totalAmount: number
  paymentMethod?: 'CASH' | 'KHQR' | null
  paymentStatus?: string | null
  source?: 'SALE_RECORD' | 'CUSTOMER_ORDER'
}

type RefundEntry = {
  kind: 'refund'
  item: RecordItem
}

type DisplayEntry = OrderGroup | RefundEntry

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
          source: item.source,
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
    const at = a.kind === 'order' ? a.createdAt : a.item.createdAt
    const bt = b.kind === 'order' ? b.createdAt : b.item.createdAt
    return bt.localeCompare(at)
  })
  return all
}

function isPendingCustomerOrder(order: CustomerOrderRecord): boolean {
  if (order.status === 'PENDING' || order.status === 'CONFIRMED') return true
  return order.status === 'COMPLETED' && order.paymentStatus === 'UNPAID'
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { t, lang, setLang } = useLocale()
  const {
    realRole, effectiveRole, isOwnerInStaffMode, enterStaffMode, exitStaffMode,
    storeName: contextStoreName,
    storeCode: contextStoreCode,
    tenantName: contextTenantName,
  } = useWorkMode()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [storeName, setStoreName] = useState<string | null>(null)
  const [loadKey, setLoadKey] = useState(0)
  const [customerOrders, setCustomerOrders] = useState<CustomerOrderRecord[]>([])
  const [ordersError, setOrdersError] = useState<string | null>(null)
  const [ordersKey, setOrdersKey] = useState(0)
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null)
  const [customerCheckout, setCustomerCheckout] = useState<{ id: string; orderNo: string; totalAmount: number } | null>(null)
  const [storeCode, setStoreCode] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [avatarFailed, setAvatarFailed] = useState(false)

  useEffect(() => {
    setStoreName(contextStoreName ?? contextTenantName ?? null)
    setStoreCode(contextStoreCode ?? null)
    setAvatarFailed(false)
  }, [contextStoreName, contextStoreCode, contextTenantName])

  useEffect(() => {
    const today = todayStr()
    const params = new URLSearchParams({ dateFrom: today, dateTo: today, pageSize: '30' })

    setLoading(true)
    setLoadError(null)
    apiFetch(`/api/records?${params}`, undefined, STAFF_CTX)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data) => {
        setSummary(data.summary)
      })
      .catch(() => {
        setLoadError(t('home.homeLoadFailed'))
        setSummary(null)
      })
      .finally(() => setLoading(false))
  }, [loadKey, realRole, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  // 加载顾客订单（仅 OWNER 可见）
  useEffect(() => {
    if (effectiveRole !== 'OWNER') {
      setCustomerOrders([])
      setOrdersError(null)
      return
    }
    setOrdersError(null)
    apiFetch('/api/customer-orders?status=PENDING,CONFIRMED,COMPLETED', undefined, OWNER_CTX)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => setCustomerOrders(Array.isArray(data) ? data : []))
      .catch(() => {
        setCustomerOrders([])
        setOrdersError(t('home.customerOrdersLoadFailed'))
      })
  }, [ordersKey, effectiveRole, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  // 顾客订单自动刷新：页面重新可见时立刻刷新 + 每 30 秒后台轮询
  useEffect(() => {
    if (effectiveRole !== 'OWNER') return
    function onVisible() {
      if (!document.hidden) setOrdersKey((k) => k + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => setOrdersKey((k) => k + 1), 30_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [effectiveRole])

  function copyLink(key: string, url: string) {
    const doFallback = () => {
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
      document.body.appendChild(ta)
      ta.focus(); ta.select()
      try { document.execCommand('copy') } catch {}
      document.body.removeChild(ta)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        setCopiedKey(key)
        setTimeout(() => setCopiedKey(null), 2000)
      }).catch(doFallback)
    } else {
      doFallback()
    }
  }

  const pendingCustomerOrders = customerOrders.filter(isPendingCustomerOrder)
  const pendingOrderCount = pendingCustomerOrders.length
  const pendingOrderAmount = pendingCustomerOrders.reduce((sum, order) => sum + order.totalAmount, 0)
  const displayStoreName = storeName ?? 'E-Shop'
  const storeInitial = displayStoreName.trim().slice(0, 1).toUpperCase() || '店'
  const desktopUrl = storeCode ? publicUrl(`/desktop?storeCode=${storeCode}&lang=${lang}`) : publicUrl(`/desktop?lang=${lang}`)
  const storeAvatarUrl = storeCode && !avatarFailed ? `/api/public/stores/${storeCode}/banner` : null

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
      throw new Error(body.error ?? t('home.collectFailed'))
    }
  }

  return (
    <main style={s.page}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
      {/* ── Brand header ── */}
      <div style={s.brandBar}>
        <div style={s.brandLeft}>
          <span style={s.brandAvatar}>
            {storeAvatarUrl ? (
              <img src={storeAvatarUrl} alt={displayStoreName} style={s.brandAvatarImg} onError={() => setAvatarFailed(true)} />
            ) : (
              storeInitial
            )}
          </span>
          <div style={s.brandTextBlock}>
            <div style={s.brandTitle}>{displayStoreName}</div>
            <div style={s.brandSub}>{t('home.brandSub')}</div>
          </div>
        </div>
        <div style={s.brandRight}>
          <LangDropdown lang={lang} setLang={setLang} />
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

      {/* ── Today operating hero ── */}
      <div style={s.summaryCard}>
        <div style={s.summaryTopRow}>
          <div style={s.summaryTitle}>{t('home.todaySummary')}</div>
          <Link href="/dashboard" style={s.summaryLink}>{t('home.viewDashboard')}</Link>
        </div>
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
            {loadError && <div style={s.errorHint}>{loadError}</div>}
            <div style={s.netRow}>
              <span style={s.netLabel}>{effectiveRole === 'OWNER' ? t('home.netIncome') : t('home.todaySales')}</span>
              <span style={{
                ...s.netAmount,
                color: (summary?.netAmount ?? 0) >= 0 ? '#52c41a' : '#ff4d4f',
              }}>
                ${(summary?.netAmount ?? 0).toFixed(2)}
              </span>
            </div>
            <div style={s.payBreakRow}>
              <span style={s.payBreakItem}>💵 CASH ${(summary?.cashSaleAmount ?? 0).toFixed(2)}</span>
              <span style={s.payBreakSep}>·</span>
              <span style={s.payBreakItem}>📱 KHQR ${(summary?.khqrSaleAmount ?? 0).toFixed(2)}</span>
              {effectiveRole === 'OWNER' && (
                <>
                  <span style={s.payBreakSep}>·</span>
                  <span style={s.payBreakItem}>{t('home.pendingAmount')} ${pendingOrderAmount.toFixed(2)}</span>
                </>
              )}
            </div>
            <div style={s.summaryGrid}>
              <SummaryCell label={t('home.sale')} value={String(summary?.saleCount ?? 0)} unit={t('home.unit')} />
              <div style={s.summaryDivider} />
              <SummaryCell label={t('home.refund')} value={String(summary?.refundCount ?? 0)} unit={t('home.unit')} />
              <div style={s.summaryDivider} />
              <SummaryCell label={t('home.pendingOrdersShort')} value={String(pendingOrderCount)} unit={t('home.unit')} />
            </div>
          </>
        )}
      </div>

      {/* ── Pending work ── */}
      <div style={s.workSection}>
        <div style={s.sectionHeader}>
          <span style={s.sectionTitleBare}>{t('home.pendingWork')}</span>
          {effectiveRole === 'OWNER' && pendingOrderCount > 0 && (
            <Link href="/cashier" style={s.viewAll}>{t('home.viewAll')}</Link>
          )}
        </div>
        {effectiveRole === 'OWNER' ? (
          ordersError ? (
            <div style={s.errorHint}>{ordersError}</div>
          ) : pendingOrderCount === 0 ? (
            <div style={s.workEmpty}>{t('home.noPendingWork')}</div>
          ) : (
            pendingCustomerOrders.slice(0, 1).map((order) => (
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
          )
        ) : (
          <div style={s.workEmpty}>{t('home.staffWorkHint')}</div>
        )}
      </div>

      {/* ── AI assistant ── */}
      <div style={s.aiHomeCard}>
        <div style={s.aiHomeText}>
          <div style={s.aiHomeEyebrow}>Beta</div>
          <div style={s.aiHomeTitle}>{t('home.aiStaffTitle')}</div>
          <div style={s.aiHomeSub}>{t('home.aiStaffSub')}</div>
        </div>
        <Link href={effectiveRole === 'OWNER' ? '/products' : '/sale'} style={s.aiHomeBtn}>
          {t('home.tryNow')}
        </Link>
      </div>

      {/* ── Quick actions ── */}
      <div style={s.sectionTitle}>{t('home.quickActions')}</div>
      <div style={s.actionGrid}>
        <ActionBtn href="/sale" icon="💰" label={t('home.sale')} color="#1677ff" />
        <ActionBtn href="/refund" icon="↩️" label={t('home.refund')} color="#ff4d4f" />
        <ActionBtn href="/records" icon="📋" label={t('home.records')} color="#fa8c16" />
        <CashierAction
          label={t('home.cashier')}
          openLabel={t('home.open')}
          copyLabel={copiedKey === 'cashier' ? '✓' : t('home.copy')}
          color="#722ed1"
          onOpen={() => window.open(desktopUrl, '_blank', 'noopener,noreferrer')}
          onCopy={() => copyLink('cashier', desktopUrl)}
        />
      </div>

      {effectiveRole === 'OWNER' && (
      <div style={s.ownerEntrySection}>
        <div style={s.sectionTitle}>{t('home.ownerCenter')}</div>
        <div style={s.ownerEntryGrid}>
          <OwnerEntry href="/products" icon="📦" label={t('home.products')} />
          <OwnerEntry href="/customers" icon="👥" label={t('home.customers')} />
          <OwnerEntry href="/invite" icon="🔗" label={t('home.inviteStaff')} />
          <OwnerEntry href="/dashboard" icon="📊" label={t('home.dashboard')} />
        </div>
      </div>
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
          overrideKhqrUrl={`/api/customer-orders/${customerCheckout.id}/khqr`}
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

function ActionBtn({ href, icon, label, color, onClick }: {
  href?: string; icon: string; label: string; color: string; onClick?: () => void
}) {
  const content = (
    <>
      <span style={{ ...s.actionIcon, background: color + '15' }}>{icon}</span>
      <span style={{ ...s.actionLabel, color }}>{label}</span>
    </>
  )
  if (onClick) {
    return (
      <button type="button" style={{ ...s.actionBtn, borderColor: color + '33' }} onClick={onClick}>
        {content}
      </button>
    )
  }
  return (
    <Link href={href ?? '#'} style={{ ...s.actionBtn, borderColor: color + '33' }}>
      {content}
    </Link>
  )
}

function CashierAction({ label, openLabel, copyLabel, color, onOpen, onCopy }: {
  label: string; openLabel: string; copyLabel: string; color: string; onOpen: () => void; onCopy: () => void
}) {
  return (
    <div style={{ ...s.actionBtn, borderColor: color + '33' }}>
      <span style={{ ...s.actionIcon, background: color + '15' }}>🖥️</span>
      <span style={{ ...s.actionLabel, color }}>{label}</span>
      <div style={s.actionMiniBtns}>
        <button type="button" style={s.actionMiniBtn} onClick={onCopy}>{copyLabel}</button>
        <button type="button" style={s.actionMiniBtnPrimary} onClick={onOpen}>{openLabel}</button>
      </div>
    </div>
  )
}

function OwnerEntry({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link href={href} style={s.ownerEntry}>
      <span style={s.ownerEntryIcon}>{icon}</span>
      <span style={s.ownerEntryLabel}>{label}</span>
    </Link>
  )
}

function OrderCard({ group, index, tagSale, itemCountUnit, checkoutBtn, customerOrderTag, pendingPay, onOpen, onCheckout }: {
  group: OrderGroup; index: number; tagSale: string; itemCountUnit: string
  checkoutBtn: string; customerOrderTag: string; pendingPay: string; onOpen?: () => void; onCheckout?: () => void
}) {
  const isPending = group.paymentMethod === null
  const accent = isPending ? '#fa8c16' : ORDER_COLORS[index % ORDER_COLORS.length]
  const isSingle = group.items.length === 1
  const isCustomerOrder = group.source === 'CUSTOMER_ORDER'
  return (
    <div
      style={{
        ...s.recentCard,
        borderLeft: `3px solid ${isCustomerOrder ? '#722ed1' : accent}`,
        cursor: onOpen ? 'pointer' : 'default',
        ...(isPending ? s.recentCardPending : {}),
      }}
      onClick={onOpen}
    >
      <div style={s.recentLeft}>
        <div style={s.recentTagRow}>
          <span style={isCustomerOrder ? s.tagCustomerOrder : s.tagSale}>
            {isCustomerOrder ? customerOrderTag : tagSale}
          </span>
          {isPending && <span style={s.tagPending}>{pendingPay}</span>}
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

// 国旗下拉：商户端只在 /home 渲染；选择持久化到 LangProvider 的 localStorage
function LangDropdown({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const [open, setOpen] = useState(false)
  const items: Array<{ code: Lang; flag: string; label: string }> = [
    { code: 'zh', flag: '🇨🇳', label: '中文' },
    { code: 'en', flag: '🇺🇸', label: 'English' },
    { code: 'km', flag: '🇰🇭', label: 'ខ្មែរ' },
  ]
  const current = items.find((i) => i.code === lang) ?? items[0]

  return (
    <div style={{ position: 'relative' as const }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          fontSize: 11, color: '#111827',
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 999, padding: '7px 10px', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' as const,
          boxShadow: '0 4px 14px rgba(15,23,42,0.06)',
        }}
      >
        <span>{current.flag}</span>
        <span>{current.label}</span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed' as const, inset: 0, zIndex: 50 }} />
          <div style={{
            position: 'absolute' as const, top: 'calc(100% + 4px)', right: 0, zIndex: 60,
            minWidth: 130, background: '#fff', border: '1px solid #e8e8e8',
            borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', padding: 4,
          }}>
            {items.map((it) => {
              const active = it.code === lang
              return (
                <button
                  key={it.code}
                  type="button"
                  onClick={() => {
                    if (it.code !== lang) setLang(it.code)
                    setOpen(false)
                  }}
                  style={{
                    width: '100%', textAlign: 'left' as const,
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', borderRadius: 6,
                    background: active ? '#e6f4ff' : 'transparent',
                    color: '#1a1a1a',
                    fontSize: 13, border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 16 }}>{it.flag}</span>
                  <span style={{ flex: 1 }}>{it.label}</span>
                  {active && <span style={{ color: '#1677ff' }}>✓</span>}
                </button>
              )
            })}
          </div>
        </>
      )}
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
  PENDING:   'home.statusPending',
  CONFIRMED: 'home.statusConfirmed',
  COMPLETED: 'home.statusCompleted',
  CANCELLED: 'home.statusCancelled',
}

function buildOrderItemSummary(items: CustomerOrderItem[]): string {
  return items.map((i) => `${i.name}×${i.quantity}`).join('、')
}

function sourcePlatformLabel(source: string | null): string {
  if (!source) return ''
  if (source.toLowerCase() === 'tiktok') return 'TikTok'
  if (source.toLowerCase() === 'facebook') return 'Facebook'
  if (source.toLowerCase() === 'telegram') return 'Telegram'
  return source
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
  const { t, lang } = useLocale()
  const [showDetail, setShowDetail] = useState(false)
  const needsPay = order.status === 'COMPLETED' && order.paymentStatus === 'UNPAID'
  const color = needsPay ? '#fa8c16' : (CO_STATUS_COLOR[order.status] ?? '#8c8c8c')
  const label = needsPay ? t('home.pendingPay') : (CO_STATUS_LABEL[order.status] ? t(CO_STATUS_LABEL[order.status]) : order.status)
  const hasCampaignSource = !!order.campaignCode || !!order.campaignLink
  const sourceLabel = sourcePlatformLabel(order.sourcePlatform)
  const landingLabel = order.campaignLink?.landingType === 'MARKETING_PAGE' ? t('home.landingMarketing') : t('home.landingMenu')

  return (
    <div
      style={{ ...s.recentCard, borderLeft: `3px solid ${color}`, margin: '0 0 4px', padding: '9px 11px', background: '#fff', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', gap: 0, cursor: 'pointer' }}
      onClick={() => setShowDetail((d) => !d)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={s.recentLeft}>
          <div style={s.recentTagRow}>
            <span style={{ ...s.tagSale, background: color + '15', color, border: `1px solid ${color}44` }}>
              {label}
            </span>
            {order.tableNo && (
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', borderRadius: 4, padding: '1px 7px', letterSpacing: 0.5 }}>
                🪑 {order.tableNo}
              </span>
            )}
            {order.customerTelegramId && (
              <span style={s.coTgBadge}>TG</span>
            )}
            {hasCampaignSource && (
              <span style={s.coSourceBadge}>📣 {sourceLabel || t('home.promotion')} / {landingLabel}</span>
            )}
          </div>
          <div style={s.recentProduct}>{buildOrderItemSummary(order.items)}</div>
          {hasCampaignSource && (
            <div style={s.coSourceLine}>
              {order.campaignLink?.creatorName && <span>{t('home.creator')}：{order.campaignLink.creatorName}</span>}
              {order.campaignCode && <span>{t('home.shortLink')}：{order.campaignCode}</span>}
            </div>
          )}
          <div style={s.recentMeta}>
            {order.orderNo} · {fmtTime(order.createdAt)}
          </div>
          {!updating && (
            <div style={s.coActions} onClick={(e) => e.stopPropagation()}>
              {order.status === 'PENDING' && (
                <>
                  <button style={s.coConfirmBtn} onClick={onConfirm}>{t('home.confirmAction')}</button>
                  <button style={s.coCancelBtn} onClick={onCancel}>{t('home.cancelAction')}</button>
                </>
              )}
              {order.status === 'CONFIRMED' && (
                <>
                  <button style={s.coCompleteBtn} onClick={onComplete}>{t('home.completeAction')}</button>
                  <button style={s.coCancelBtn} onClick={onCancel}>{t('home.cancel')}</button>
                </>
              )}
            </div>
          )}
          {updating && <div style={s.coUpdating}>{t('home.processing')}</div>}
        </div>
        <div style={s.recentRight}>
          <div style={{ ...s.recentAmount, color: '#1a1a1a' }}>
            ${order.totalAmount.toFixed(2)}
          </div>
          {needsPay && !updating && (
            <button style={s.checkoutBtn} onClick={(e) => { e.stopPropagation(); onCollect() }}>{t('home.collect')}</button>
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
            {order.tableNo && <span style={{ color: '#1d4ed8', fontWeight: 700 }}>· {t('home.tableNo')} {order.tableNo}</span>}
          </div>
          {order.items.map((item, idx) => (
            <div key={item.productId + idx} style={s.coDetailItem}>
              <div style={s.coDetailItemName}>
                {item.name}
                {item.spec && <span style={s.coDetailItemSpec}> · {item.spec}</span>}
                {item.sugar && <span style={s.coDetailItemSpec}> · {sugarLabel(item.sugar, lang)}</span>}
              </div>
              <div style={s.coDetailItemRight}>
                <span style={s.coDetailItemUnit}>${item.price.toFixed(2)}×{item.quantity}</span>
                <span style={s.coDetailItemLine}>${item.lineAmount.toFixed(2)}</span>
              </div>
            </div>
          ))}
          <div style={s.coDetailFooter}>
            <span style={s.coDetailTotalLabel}>{t('home.totalLabel')}</span>
            <span style={s.coDetailTotalAmt}>${order.totalAmount.toFixed(2)}</span>
          </div>
          {order.customerTelegramId && (
            <div style={s.coDetailTg}>{t('home.customerTgId')}：{order.customerTelegramId}</div>
          )}
          {hasCampaignSource && (
            <div style={s.coDetailSource}>
              <div>{t('home.source')}：{sourceLabel || t('home.promotion')} / {landingLabel}</div>
              {order.campaignLink?.creatorName && <div>{t('home.creator')}：{order.campaignLink.creatorName}</div>}
              {order.campaignCode && <div>{t('home.shortLink')}：{order.campaignCode}</div>}
              {order.campaignLink?.videoTitle && <div>{t('home.video')}：{order.campaignLink.videoTitle}</div>}
            </div>
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
    padding: '10px 12px 18px',
    background: '#f7f8fa',
    minHeight: '100vh',
  },
  brandBar: {
    background: 'transparent',
    padding: '2px 2px 10px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  brandLeft: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  },
  brandAvatar: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #111827 0%, #4b5563 100%)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    fontWeight: 900,
    boxShadow: '0 10px 24px rgba(15,23,42,0.16)',
    flexShrink: 0,
    overflow: 'hidden',
  },
  brandAvatarImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  brandTextBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: 800,
    color: '#111827',
    letterSpacing: '-0.3px',
    lineHeight: 1.2,
  },
  brandSub: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 3,
    letterSpacing: '0.01em',
  },
  brandRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 4,
  },
  switchBtn: {
    fontSize: 10,
    color: '#111827',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 999,
    padding: '6px 9px',
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(15,23,42,0.06)',
  },
  modeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  modeLabelText: {
    fontSize: 10,
    color: '#6b7280',
    fontWeight: 600,
  },
  modeBtnOwner: {
    background: '#fff7ed',
    border: '1px solid #fed7aa',
    color: '#c2410c',
  },
  summaryCard: {
    background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfeff 52%, #ffffff 100%)',
    margin: '0 0 12px',
    borderRadius: 22,
    padding: '15px 16px',
    boxShadow: '0 14px 30px rgba(20,184,166,0.11)',
    marginBottom: 12,
    border: '1px solid rgba(153,246,228,0.7)',
  },
  summaryTopRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  summaryTitle: {
    fontSize: 11,
    color: '#8c8c8c',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 6,
  },
  summaryLink: {
    fontSize: 11,
    fontWeight: 700,
    color: '#1677ff',
    textDecoration: 'none',
    marginBottom: 6,
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
    flexDirection: 'column',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  payBreakRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 9,
    paddingBottom: 9,
    borderBottom: '1px solid #f0f0f0',
  },
  payBreakItem: { fontSize: 11, color: '#8c8c8c' },
  payBreakSep: { fontSize: 12, color: '#d9d9d9' },
  netLabel: {
    fontSize: 12,
    color: '#8c8c8c',
  },
  netAmount: {
    fontSize: 36,
    fontWeight: 900,
    letterSpacing: '-0.02em',
    lineHeight: 1.05,
    marginTop: 4,
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
    fontSize: 16,
    fontWeight: 800,
    color: '#1a1a1a',
  },
  summaryUnit: {
    fontSize: 12,
    fontWeight: 400,
    color: '#8c8c8c',
    marginLeft: 2,
  },
  summaryCellLabel: {
    fontSize: 11,
    color: '#8c8c8c',
  },
  summaryDivider: {
    width: 1,
    height: 28,
    background: '#e8e8e8',
  },
  pendingAmountLine: {
    marginTop: 12,
    borderRadius: 14,
    background: '#fff7ed',
    color: '#9a3412',
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 700,
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 4px',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: '#1a1a1a',
    padding: '0 4px',
    marginBottom: 8,
    display: 'block',
  },
  sectionTitleBare: {
    fontSize: 13,
    fontWeight: 800,
    color: '#1a1a1a',
  },
  viewAll: {
    fontSize: 13,
    color: '#1677ff',
    textDecoration: 'none',
    fontWeight: 700,
  },
  actionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 7,
    padding: 0,
    marginBottom: 14,
  },
  workSection: {
    background: '#fff7ed',
    border: '1px solid #fed7aa',
    borderRadius: 20,
    padding: '10px 10px 6px',
    marginBottom: 10,
    boxShadow: '0 8px 20px rgba(154,52,18,0.05)',
  },
  workEmpty: {
    background: '#fff',
    borderRadius: 16,
    padding: '12px 13px',
    color: '#9a3412',
    fontSize: 13,
    lineHeight: 1.5,
    margin: '4px 0 6px',
  },
  aiHomeCard: {
    background: 'linear-gradient(135deg, #f5f3ff 0%, #eef2ff 55%, #ffffff 100%)',
    border: '1px solid rgba(196,181,253,0.7)',
    borderRadius: 22,
    padding: '15px 16px',
    marginBottom: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    boxShadow: '0 14px 30px rgba(124,58,237,0.12)',
  },
  aiHomeText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    minWidth: 0,
  },
  aiHomeEyebrow: {
    alignSelf: 'flex-start',
    fontSize: 10,
    color: '#6d28d9',
    background: 'rgba(124,58,237,0.10)',
    border: '1px solid rgba(167,139,250,0.32)',
    borderRadius: 999,
    padding: '3px 8px',
    fontWeight: 800,
  },
  aiHomeTitle: {
    fontSize: 18,
    fontWeight: 900,
    color: '#312e81',
    letterSpacing: '-0.2px',
  },
  aiHomeSub: {
    fontSize: 11,
    color: '#6b7280',
    lineHeight: 1.5,
  },
  aiHomeBtn: {
    flexShrink: 0,
    borderRadius: 999,
    background: '#4f46e5',
    color: '#fff',
    padding: '9px 12px',
    fontSize: 12,
    fontWeight: 800,
    textDecoration: 'none',
    boxShadow: '0 8px 18px rgba(79,70,229,0.18)',
  },
  shortcutSection: {
    marginBottom: 16,
  },
  shortcutRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 14px',
    background: '#fff',
    border: '1px solid rgba(229,231,235,0.9)',
    borderRadius: 20,
    boxShadow: '0 10px 24px rgba(15,23,42,0.06)',
  },
  shortcutLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    flex: 1,
  },
  shortcutIcon: {
    fontSize: 20,
    flexShrink: 0,
  },
  shortcutTextCol: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 1,
    minWidth: 0,
  },
  shortcutLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: '#111827',
  },
  shortcutHint: {
    fontSize: 10,
    color: '#2563eb',
  },
  shortcutUrl: {
    fontSize: 10,
    color: '#9ca3af',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    maxWidth: 180,
  },
  shortcutBtns: {
    display: 'flex',
    gap: 6,
    flexShrink: 0,
    marginLeft: 8,
  },
  shortcutBtn: {
    padding: '7px 10px',
    borderRadius: 999,
    border: '1px solid #d1d5db',
    background: '#f9fafb',
    color: '#374151',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
  },
  shortcutBtnOk: {
    padding: '7px 10px',
    borderRadius: 999,
    border: '1px solid #86efac',
    background: '#f0fdf4',
    color: '#15803d',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
  },
  actionBtn: {
    background: '#fff',
    border: '1px solid',
    borderRadius: 18,
    padding: '10px 5px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 5,
    textDecoration: 'none',
    boxShadow: '0 8px 18px rgba(15,23,42,0.04)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: 800,
    textAlign: 'center',
    lineHeight: 1.15,
  },
  actionMiniBtns: {
    display: 'flex',
    gap: 3,
    marginTop: 1,
    width: '100%',
  },
  actionMiniBtn: {
    flex: 1,
    minWidth: 0,
    border: '1px solid #e5e7eb',
    background: '#fff',
    color: '#4b5563',
    borderRadius: 999,
    padding: '3px 0',
    fontSize: 9,
    fontWeight: 800,
    cursor: 'pointer',
  },
  actionMiniBtnPrimary: {
    flex: 1,
    minWidth: 0,
    border: '1px solid #ddd6fe',
    background: '#f5f3ff',
    color: '#6d28d9',
    borderRadius: 999,
    padding: '3px 0',
    fontSize: 9,
    fontWeight: 800,
    cursor: 'pointer',
  },
  ownerEntrySection: {
    marginBottom: 16,
  },
  ownerEntryGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
    padding: 0,
  },
  ownerEntry: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: '#fff',
    border: '1px solid #edf0f2',
    borderRadius: 18,
    padding: '13px 12px',
    textDecoration: 'none',
    minWidth: 0,
    boxShadow: '0 8px 20px rgba(15,23,42,0.04)',
  },
  ownerEntryIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    background: '#f6f8fa',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    flexShrink: 0,
  },
  ownerEntryLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: '#111827',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  recentCard: {
    background: '#fff',
    margin: '0 0 10px',
    borderRadius: 18,
    padding: '12px 14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    border: '1px solid rgba(229,231,235,0.9)',
    boxShadow: '0 8px 18px rgba(15,23,42,0.04)',
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
  tagCustomerOrder: {
    fontSize: 10,
    fontWeight: 600,
    background: '#f9f0ff',
    color: '#722ed1',
    border: '1px solid #d3adf7',
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
  errorHint: {
    margin: '0 12px 10px',
    padding: '8px 10px',
    borderRadius: 8,
    background: '#fff1f0',
    border: '1px solid #ffccc7',
    color: '#cf1322',
    fontSize: 12,
    lineHeight: 1.5,
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
    marginTop: 4,
  },
  coConfirmBtn: {
    fontSize: 11,
    fontWeight: 700,
    color: '#fff',
    background: '#52c41a',
    border: 'none',
    borderRadius: 6,
    padding: '4px 10px',
    cursor: 'pointer',
  },
  coCompleteBtn: {
    fontSize: 11,
    fontWeight: 700,
    color: '#fff',
    background: '#1677ff',
    border: 'none',
    borderRadius: 6,
    padding: '4px 10px',
    cursor: 'pointer',
  },
  coCancelBtn: {
    fontSize: 11,
    fontWeight: 600,
    color: '#ff4d4f',
    background: '#fff1f0',
    border: '1px solid #ffccc7',
    borderRadius: 6,
    padding: '4px 10px',
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
  coSourceBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 4,
    padding: '1px 7px',
    fontSize: 10,
    fontWeight: 700,
    background: '#fff7ed',
    color: '#c2410c',
    border: '1px solid #fed7aa',
  },
  coSourceLine: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap' as const,
    marginTop: 2,
    fontSize: 10,
    color: '#c2410c',
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
  coDetailSource: {
    marginTop: 10,
    padding: '8px 10px',
    borderRadius: 6,
    background: '#fff7ed',
    color: '#9a3412',
    fontSize: 12,
    lineHeight: 1.6,
  },
}
