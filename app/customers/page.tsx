'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { apiFetch, OWNER_CTX } from '@/lib/api'

type Customer = {
  telegramId: string
  username: string | null
  displayName: string | null
  phone: string | null
  bound: boolean
  firstBoundAt: string | null
  lastActiveAt: string | null
  totalOrders: number
  totalSpent: number
  avgOrderValue: number
  lastOrderAt: string | null
  favoriteProductName: string | null
  favoriteProductCount: number
  tags: string[]
  customerLevel: 'NORMAL' | 'VIP'
  pointsBalance: number
  recentOrders: Array<{
    orderNo: string
    createdAt: string
    totalAmount: number
    status: string
    paymentStatus: string
    itemSummary: string
  }>
  topProducts: Array<{ name: string; count: number }>
}

type Overview = {
  totalCustomers: number
  boundCustomers: number
  todayBound: number
  monthActive: number
  totalSales: number
  repeatCustomers: number
}

type SortKey   = 'recent' | 'spent' | 'new'
type TagFilter = 'all' | '新客' | '老客' | '高价值' | '沉默'

export default function CustomersPage() {
  const [loading,   setLoading]   = useState(true)
  const [errMsg,    setErrMsg]    = useState('')
  const [overview,  setOverview]  = useState<Overview | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])

  const [search,    setSearch]    = useState('')
  const [sortKey,   setSortKey]   = useState<SortKey>('recent')
  const [tagFilter, setTagFilter] = useState<TagFilter>('all')
  const [selected,  setSelected]  = useState<Customer | null>(null)
  // Telegram 触达弹窗
  const [touchTarget, setTouchTarget] = useState<Customer | null>(null)
  const [toast, setToast]             = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    apiFetch('/api/customers', { cache: 'no-store' }, OWNER_CTX)
      .then((r) => r.json())
      .then((body) => {
        if (body?.error) {
          setErrMsg(body.message ?? body.error)
        } else {
          setOverview(body.overview)
          setCustomers(body.customers ?? [])
        }
      })
      .catch(() => setErrMsg('网络错误，请刷新重试'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const filtered = useMemo(() => {
    let list = customers
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((c) =>
        (c.displayName ?? '').toLowerCase().includes(q) ||
        (c.username    ?? '').toLowerCase().includes(q) ||
        c.telegramId.toLowerCase().includes(q),
      )
    }
    if (tagFilter !== 'all') {
      list = list.filter((c) => c.tags.includes(tagFilter))
    }
    list = [...list].sort((a, b) => {
      if (sortKey === 'spent')  return b.totalSpent - a.totalSpent
      if (sortKey === 'new') {
        const av = a.firstBoundAt ? new Date(a.firstBoundAt).getTime() : 0
        const bv = b.firstBoundAt ? new Date(b.firstBoundAt).getTime() : 0
        return bv - av
      }
      // recent (default)
      const av = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0
      const bv = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0
      return bv - av
    })
    return list
  }, [customers, search, sortKey, tagFilter])

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <Link href="/dashboard" style={s.back}>‹ 返回</Link>
        <span style={s.title}>顾客资产</span>
        <span style={{ width: 48 }} />
      </div>

      <div style={s.body}>
        {/* 经营总览 */}
        {overview && (
          <div style={s.overviewGrid}>
            <OverCell value={String(overview.totalCustomers)} label="总顾客" />
            <OverCell value={String(overview.boundCustomers)} label="已绑定" />
            <OverCell value={String(overview.todayBound)}     label="今日新增" />
            <OverCell value={String(overview.monthActive)}    label="本月活跃" />
            <OverCell value={`$${overview.totalSales.toFixed(2)}`} label="总消费" />
            <OverCell value={String(overview.repeatCustomers)} label="复购人数" />
          </div>
        )}

        {/* 私域功能入口（占位） */}
        <div style={s.opsRow}>
          {(['发券', 'Telegram 触达', '会员等级'] as const).map((name) => (
            <button key={name} type="button" style={s.opsBtn} onClick={() => alert('该功能开发中，敬请期待')}>
              {name}
            </button>
          ))}
        </div>

        {/* 搜索 + 筛选 */}
        <div style={s.filterCard}>
          <input
            style={s.searchInput}
            placeholder="搜索昵称 / 用户名 / Telegram ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={s.sortRow}>
            {([
              { k: 'recent', label: '最近活跃' },
              { k: 'spent',  label: '消费金额' },
              { k: 'new',    label: '新客' },
            ] as const).map((opt) => (
              <button
                key={opt.k}
                type="button"
                style={{ ...s.sortBtn, ...(sortKey === opt.k ? s.sortBtnOn : {}) }}
                onClick={() => setSortKey(opt.k)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div style={s.tagFilterRow}>
            {(['all', '新客', '老客', '高价值', '沉默'] as const).map((t) => (
              <button
                key={t}
                type="button"
                style={{ ...s.tagFilterBtn, ...(tagFilter === t ? s.tagFilterBtnOn : {}) }}
                onClick={() => setTagFilter(t)}
              >
                {t === 'all' ? '全部' : t}
              </button>
            ))}
          </div>
        </div>

        {/* 列表 */}
        {loading && <div style={s.centerMsg}>加载中…</div>}
        {!loading && errMsg && <div style={s.errMsg}>{errMsg}</div>}
        {!loading && !errMsg && (
          filtered.length === 0 ? (
            <div style={s.empty}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>👥</div>
              <div>{customers.length === 0 ? '暂无顾客数据' : '无匹配顾客'}</div>
            </div>
          ) : (
            <div style={s.list}>
              {filtered.map((c) => (
                <CustomerCard
                  key={c.telegramId}
                  c={c}
                  onClick={() => setSelected(c)}
                  onTouch={() => setTouchTarget(c)}
                />
              ))}
            </div>
          )
        )}
      </div>

      {/* 详情 Drawer */}
      {selected && (
        <Drawer
          c={selected}
          onClose={() => setSelected(null)}
          onTouch={() => { setTouchTarget(selected); setSelected(null) }}
        />
      )}

      {/* Telegram 触达弹窗 */}
      {touchTarget && (
        <TouchModal
          c={touchTarget}
          onClose={() => setTouchTarget(null)}
          onResult={(ok, text) => { setTouchTarget(null); setToast({ type: ok ? 'ok' : 'err', text }) }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{ ...s.toast, ...(toast.type === 'ok' ? s.toastOk : s.toastErr) }}>
          {toast.text}
        </div>
      )}
    </div>
  )
}

// ─── 子组件 ──────────────────────────────────────────────────────────────────

function OverCell({ value, label }: { value: string; label: string }) {
  return (
    <div style={s.overCell}>
      <div style={s.overValue}>{value}</div>
      <div style={s.overLabel}>{label}</div>
    </div>
  )
}

function CustomerCard({ c, onClick, onTouch }: { c: Customer; onClick: () => void; onTouch: () => void }) {
  const initial = (c.displayName || c.username || '?').slice(0, 1).toUpperCase()
  return (
    <div style={s.card} onClick={onClick}>
      <div style={s.cardRow}>
        <div style={s.avatar}>{initial}</div>
        <div style={s.info}>
          <div style={s.name}>
            {c.displayName || c.username || c.telegramId}
            {c.customerLevel === 'VIP' && <span style={s.vipBadge}>VIP</span>}
            {!c.bound && <span style={s.unboundBadge}>未绑定</span>}
          </div>
          <div style={s.meta}>
            {c.username ? `@${c.username}` : `TG ${c.telegramId.slice(-6)}`}
          </div>
        </div>
        <div style={s.cardRight}>
          <div style={s.spent}>${c.totalSpent.toFixed(2)}</div>
          <div style={s.orders}>{c.totalOrders} 单</div>
        </div>
      </div>
      <div style={s.tagsRow}>
        {c.tags.length > 0 ? c.tags.map((t) => <span key={t} style={tagStyle(t)}>{t}</span>) : <span style={s.noTag}>—</span>}
      </div>
      <div style={s.subRow}>
        <span>最近：{fmtDate(c.lastActiveAt)}</span>
        {c.favoriteProductName && <span>· 常购：{c.favoriteProductName}</span>}
        <span style={{ marginLeft: 'auto' }}>
          {c.bound ? (
            <button
              type="button"
              style={s.touchInlineBtn}
              onClick={(e) => { e.stopPropagation(); onTouch() }}
            >
              📨 触达
            </button>
          ) : (
            <span style={s.touchInlineDisabled}>未绑定 Telegram</span>
          )}
        </span>
      </div>
    </div>
  )
}

function Drawer({ c, onClose, onTouch }: { c: Customer; onClose: () => void; onTouch: () => void }) {
  return (
    <div style={s.drawerMask} onClick={onClose}>
      <div style={s.drawer} onClick={(e) => e.stopPropagation()}>
        <div style={s.drawerHeader}>
          <span style={s.drawerTitle}>{c.displayName || c.username || c.telegramId}</span>
          <button type="button" style={s.drawerClose} onClick={onClose} aria-label="关闭">✕</button>
        </div>

        <div style={s.drawerBody}>
          <Section title="基础资料">
            <Field k="Telegram ID" v={c.telegramId} />
            <Field k="用户名"       v={c.username ? `@${c.username}` : '—'} />
            <Field k="手机号"       v={c.phone || '—'} />
            <Field k="会员等级"     v={c.customerLevel === 'VIP' ? 'VIP' : '普通顾客'} />
            <Field k="积分"         v={String(c.pointsBalance)} />
            <Field k="首次绑定"     v={fmtDate(c.firstBoundAt)} />
            <Field k="最近活跃"     v={fmtDate(c.lastActiveAt)} />
            <Field k="绑定状态"     v={c.bound ? '已绑定' : '未绑定'} />
          </Section>

          <Section title="消费汇总">
            <Field k="累计订单"   v={`${c.totalOrders} 单`} />
            <Field k="累计消费"   v={`$${c.totalSpent.toFixed(2)}`} />
            <Field k="平均客单价" v={`$${c.avgOrderValue.toFixed(2)}`} />
            <Field k="最近订单"   v={fmtDate(c.lastOrderAt)} />
          </Section>

          <Section title="标签">
            {c.tags.length > 0
              ? c.tags.map((t) => <span key={t} style={{ ...tagStyle(t), marginRight: 6, marginBottom: 4, display: 'inline-block' }}>{t}</span>)
              : <span style={s.noTag}>暂无标签</span>}
          </Section>

          <Section title="常购商品 Top 3">
            {c.topProducts.length === 0
              ? <span style={s.noTag}>暂无</span>
              : c.topProducts.map((p, i) => (
                <div key={p.name} style={s.topRow}>
                  <span style={s.topRank}>{i + 1}</span>
                  <span style={s.topName}>{p.name}</span>
                  <span style={s.topCount}>{p.count} 件</span>
                </div>
              ))}
          </Section>

          <Section title={`订单历史（最近 ${c.recentOrders.length} 笔）`}>
            {c.recentOrders.length === 0
              ? <span style={s.noTag}>暂无</span>
              : c.recentOrders.map((o) => (
                <div key={o.orderNo} style={s.orderRow}>
                  <div style={s.orderTop}>
                    <span style={s.orderNo}>{o.orderNo}</span>
                    <span style={s.orderAmount}>${o.totalAmount.toFixed(2)}</span>
                  </div>
                  <div style={s.orderSub}>
                    <span>{fmtDate(o.createdAt)}</span>
                    <span> · {o.paymentStatus === 'PAID' ? '已付' : '未付'}</span>
                    <span> · {o.status === 'CANCELLED' ? '已取消' : o.status === 'COMPLETED' ? '已完成' : o.status === 'CONFIRMED' ? '已确认' : '待确认'}</span>
                  </div>
                  {o.itemSummary && <div style={s.orderItems}>{o.itemSummary}</div>}
                </div>
              ))}
          </Section>

          <Section title="可用优惠券">
            <span style={s.noTag}>暂无（功能开发中）</span>
          </Section>

          <div style={s.drawerActions}>
            <button type="button" style={{ ...s.drawerActionBtn, opacity: 0.5, cursor: 'not-allowed' }} onClick={() => alert('优惠券功能开发中')}>发送优惠券</button>
            {c.bound ? (
              <button type="button" style={{ ...s.drawerActionBtn, ...s.drawerActionPrimary }} onClick={onTouch}>📨 Telegram 触达</button>
            ) : (
              <button type="button" style={{ ...s.drawerActionBtn, opacity: 0.5, cursor: 'not-allowed' }} disabled title="该顾客未绑定 Telegram">📨 未绑定 Telegram</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={s.section}>
      <div style={s.sectionTitle}>{title}</div>
      <div style={s.sectionBody}>{children}</div>
    </div>
  )
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div style={s.fieldRow}>
      <span style={s.fieldK}>{k}</span>
      <span style={s.fieldV}>{v}</span>
    </div>
  )
}

// ─── Telegram 触达弹窗 ───────────────────────────────────────────────────────

type TemplateKey = 'THANK_YOU' | 'PROMO' | 'ORDER_CARE'

const TEMPLATE_LABELS: Record<TemplateKey, { name: string; preview: string }> = {
  THANK_YOU: {
    name: '感谢消费',
    preview: '感谢您选择本店！期待您再次光临 🌟',
  },
  PROMO: {
    name: '优惠提醒',
    preview: '近期有新活动，欢迎扫码查看最新菜单与优惠 🎉',
  },
  ORDER_CARE: {
    name: '订单关怀',
    preview: '您的最近订单一切顺利吗？如有任何问题请告诉我们 🙏',
  },
}

function TouchModal({
  c,
  onClose,
  onResult,
}: {
  c: Customer
  onClose: () => void
  onResult: (ok: boolean, text: string) => void
}) {
  const [tpl, setTpl]         = useState<TemplateKey>('THANK_YOU')
  const [sending, setSending] = useState(false)
  const [errMsg, setErrMsg]   = useState('')

  async function handleSend() {
    setSending(true)
    setErrMsg('')
    try {
      const r = await apiFetch('/api/customers/touch', {
        method: 'POST',
        body: JSON.stringify({ telegramId: c.telegramId, templateKey: tpl }),
      }, OWNER_CTX)
      const body = await r.json().catch(() => ({}))
      if (r.ok) {
        onResult(true, '已发送 ✓')
      } else if (r.status === 429) {
        onResult(false, body.message ?? '24 小时内已发送过同模板')
      } else {
        setErrMsg(body.message ?? body.error ?? '发送失败')
      }
    } catch {
      setErrMsg('网络错误，请重试')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={tm.mask} onClick={() => !sending && onClose()}>
      <div style={tm.modal} onClick={(e) => e.stopPropagation()}>
        <div style={tm.title}>📨 Telegram 触达</div>
        <div style={tm.subtitle}>
          收件人：{c.displayName || c.username || c.telegramId}
          {c.username && <span style={tm.subMeta}> · @{c.username}</span>}
        </div>

        <div style={tm.tplLabel}>选择模板</div>
        <div style={tm.tplRow}>
          {(Object.keys(TEMPLATE_LABELS) as TemplateKey[]).map((k) => (
            <button
              key={k}
              type="button"
              style={{ ...tm.tplBtn, ...(tpl === k ? tm.tplBtnOn : {}) }}
              onClick={() => setTpl(k)}
            >
              {TEMPLATE_LABELS[k].name}
            </button>
          ))}
        </div>

        <div style={tm.tplLabel}>消息预览</div>
        <div style={tm.preview}>{TEMPLATE_LABELS[tpl].preview}</div>
        <div style={tm.previewNote}>
          实际发送时模板会自动按顾客 Telegram 语言（zh / en / km）渲染并填入门店名。
        </div>

        {errMsg && <div style={tm.err}>{errMsg}</div>}

        <div style={tm.actions}>
          <button type="button" style={tm.cancelBtn} onClick={onClose} disabled={sending}>取消</button>
          <button type="button" style={tm.sendBtn} onClick={handleSend} disabled={sending}>
            {sending ? '发送中…' : '确认发送'}
          </button>
        </div>
      </div>
    </div>
  )
}

const tm: Record<string, React.CSSProperties> = {
  mask: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { width: '100%', maxWidth: 360, background: '#fff', borderRadius: 14, padding: '18px 16px', display: 'flex', flexDirection: 'column' as const, gap: 8 },
  title: { fontSize: 16, fontWeight: 700, color: '#1a1a1a' },
  subtitle: { fontSize: 12, color: '#666' },
  subMeta: { color: '#aaa', fontFamily: 'monospace' as const },
  tplLabel: { fontSize: 11, fontWeight: 700, color: '#888', marginTop: 6, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  tplRow: { display: 'flex', gap: 6 },
  tplBtn: { flex: 1, height: 34, fontSize: 12, fontWeight: 600, background: '#f5f5f5', color: '#666', border: 'none', borderRadius: 6, cursor: 'pointer' },
  tplBtnOn: { background: '#1677ff', color: '#fff' },
  preview: { fontSize: 13, color: '#1a1a1a', background: '#f7f8fa', borderRadius: 8, padding: '10px 12px', lineHeight: 1.5, border: '1px solid #ebebeb' },
  previewNote: { fontSize: 11, color: '#aaa', lineHeight: 1.4, marginTop: 2 },
  err: { fontSize: 12, color: '#cf1322', background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 6, padding: '6px 8px' },
  actions: { display: 'flex', gap: 8, marginTop: 8 },
  cancelBtn: { flex: 1, height: 38, fontSize: 14, color: '#666', background: '#f5f5f5', border: 'none', borderRadius: 8, cursor: 'pointer' },
  sendBtn: { flex: 2, height: 38, fontSize: 14, fontWeight: 700, color: '#fff', background: '#1677ff', border: 'none', borderRadius: 8, cursor: 'pointer' },
}

// ─── 工具 ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function tagStyle(tag: string): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
    border: '1px solid transparent',
  }
  if (tag === '新客')   return { ...base, background: '#e6f4ff', color: '#1677ff', borderColor: '#91caff' }
  if (tag === '老客')   return { ...base, background: '#f6ffed', color: '#52c41a', borderColor: '#b7eb8f' }
  if (tag === '高价值') return { ...base, background: '#fff7e6', color: '#fa8c16', borderColor: '#ffd591' }
  if (tag === '沉默')   return { ...base, background: '#fafafa', color: '#8c8c8c', borderColor: '#d9d9d9' }
  return base
}

// ─── 样式 ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f0f2f5', display: 'flex', flexDirection: 'column' },
  header: {
    background: '#1677ff',
    color: '#fff',
    padding: '14px 12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
  },
  back: { color: '#fff', textDecoration: 'none', fontSize: 14, width: 60 },
  title: { fontSize: 16, fontWeight: 700, color: '#fff' },
  body: { padding: '12px 12px 80px', maxWidth: 600, margin: '0 auto', width: '100%' },

  overviewGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: 8,
    background: '#fff',
    borderRadius: 12,
    padding: '12px 8px',
    marginBottom: 12,
  },
  overCell: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 4,
    padding: '8px 4px',
  },
  overValue: { fontSize: 18, fontWeight: 800, color: '#1a1a1a', letterSpacing: '-0.3px' },
  overLabel: { fontSize: 11, color: '#888' },

  opsRow: { display: 'flex', gap: 8, marginBottom: 12 },
  opsBtn: {
    flex: 1, height: 36, fontSize: 13, fontWeight: 600,
    background: '#fff', color: '#1677ff',
    border: '1px solid #91caff', borderRadius: 8, cursor: 'pointer',
  },

  filterCard: {
    background: '#fff', borderRadius: 12, padding: 12, marginBottom: 12,
    display: 'flex', flexDirection: 'column' as const, gap: 8,
  },
  searchInput: {
    height: 38, padding: '0 12px', border: '1px solid #e5e5e5',
    borderRadius: 8, fontSize: 14, outline: 'none', background: '#fafafa',
  },
  sortRow: { display: 'flex', gap: 6 },
  sortBtn: {
    flex: 1, height: 32, fontSize: 12, fontWeight: 600,
    background: '#f5f5f5', color: '#666', border: 'none', borderRadius: 6,
    cursor: 'pointer',
  },
  sortBtnOn: { background: '#1677ff', color: '#fff' },
  tagFilterRow: { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  tagFilterBtn: {
    height: 26, padding: '0 10px', fontSize: 11, fontWeight: 600,
    background: '#fafafa', color: '#888', border: '1px solid #e5e5e5',
    borderRadius: 13, cursor: 'pointer',
  },
  tagFilterBtnOn: { background: '#1677ff', color: '#fff', borderColor: '#1677ff' },

  list: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  card: {
    background: '#fff', borderRadius: 12, padding: 12, cursor: 'pointer',
    display: 'flex', flexDirection: 'column' as const, gap: 8,
  },
  cardRow: { display: 'flex', alignItems: 'center', gap: 10 },
  avatar: {
    width: 40, height: 40, borderRadius: '50%',
    background: 'linear-gradient(135deg, #69b1ff, #1677ff)',
    color: '#fff', fontSize: 16, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  info: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: 2 },
  name: {
    fontSize: 14, fontWeight: 700, color: '#1a1a1a',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
    display: 'flex', alignItems: 'center', gap: 6,
  },
  meta: { fontSize: 11, color: '#888', fontFamily: 'monospace' as const },
  vipBadge: {
    fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
    background: '#fff7e6', color: '#fa8c16', border: '1px solid #ffd591',
  },
  unboundBadge: {
    fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
    background: '#fafafa', color: '#999', border: '1px solid #d9d9d9',
  },
  cardRight: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', flexShrink: 0,
  },
  spent: { fontSize: 16, fontWeight: 800, color: '#1677ff', letterSpacing: '-0.3px' },
  orders: { fontSize: 11, color: '#888' },
  tagsRow: { display: 'flex', gap: 4, flexWrap: 'wrap' as const, minHeight: 18 },
  noTag: { fontSize: 11, color: '#bbb' },
  subRow: { fontSize: 11, color: '#888', display: 'flex', gap: 6, flexWrap: 'wrap' as const },

  centerMsg: { textAlign: 'center' as const, color: '#888', padding: '40px 20px', fontSize: 14 },
  errMsg: {
    background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 8,
    padding: 12, color: '#cf1322', fontSize: 13,
  },
  empty: {
    textAlign: 'center' as const, color: '#bbb', padding: '60px 20px',
    background: '#fff', borderRadius: 12, fontSize: 14,
  },

  // Drawer
  drawerMask: {
    position: 'fixed' as const, inset: 0,
    background: 'rgba(0,0,0,0.45)',
    zIndex: 200,
    display: 'flex', alignItems: 'flex-end',
  },
  drawer: {
    background: '#f5f5f5', width: '100%', maxWidth: 600, margin: '0 auto',
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    maxHeight: '88dvh', overflowY: 'auto' as const,
    display: 'flex', flexDirection: 'column' as const,
  },
  drawerHeader: {
    background: '#fff', padding: '14px 16px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    position: 'sticky' as const, top: 0, zIndex: 1,
    borderBottom: '1px solid #eee',
  },
  drawerTitle: { fontSize: 16, fontWeight: 700, color: '#1a1a1a' },
  drawerClose: {
    background: 'none', border: 'none', fontSize: 18, color: '#888',
    cursor: 'pointer', padding: '4px 8px',
  },
  drawerBody: {
    padding: '12px 12px 24px',
    display: 'flex', flexDirection: 'column' as const, gap: 12,
  },

  section: { background: '#fff', borderRadius: 12, padding: 12 },
  sectionTitle: {
    fontSize: 11, fontWeight: 700, color: '#888',
    letterSpacing: '0.04em', marginBottom: 10,
    textTransform: 'uppercase' as const,
  },
  sectionBody: { display: 'flex', flexDirection: 'column' as const, gap: 4 },

  fieldRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 0',
  },
  fieldK: { fontSize: 13, color: '#888' },
  fieldV: {
    fontSize: 13, color: '#1a1a1a', fontWeight: 600,
    maxWidth: '60%', textAlign: 'right' as const, wordBreak: 'break-all' as const,
  },

  topRow: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0',
  },
  topRank: {
    width: 22, height: 22, borderRadius: 4,
    background: '#fff7e6', color: '#fa8c16',
    fontSize: 12, fontWeight: 800,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  topName: { flex: 1, fontSize: 13, fontWeight: 600, color: '#1a1a1a' },
  topCount: { fontSize: 12, color: '#1677ff', fontWeight: 700 },

  orderRow: {
    padding: '8px 0', borderBottom: '1px solid #f5f5f5',
    display: 'flex', flexDirection: 'column' as const, gap: 3,
  },
  orderTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  orderNo: { fontSize: 12, color: '#1a1a1a', fontWeight: 600, fontFamily: 'monospace' as const },
  orderAmount: { fontSize: 14, fontWeight: 700, color: '#1677ff' },
  orderSub: { fontSize: 11, color: '#888', display: 'flex', gap: 4 },
  orderItems: { fontSize: 12, color: '#666', marginTop: 2 },

  drawerActions: { display: 'flex', gap: 8, marginTop: 4 },
  drawerActionBtn: {
    flex: 1, height: 40, fontSize: 13, fontWeight: 600,
    background: '#fff', color: '#1677ff',
    border: '1px solid #91caff', borderRadius: 8, cursor: 'pointer',
  },
  drawerActionPrimary: {
    background: '#1677ff', color: '#fff', borderColor: '#1677ff',
  },

  // ── 列表卡片内联触达按钮 ──
  touchInlineBtn: {
    fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 11,
    background: '#e6f4ff', color: '#1677ff', border: '1px solid #91caff',
    cursor: 'pointer', whiteSpace: 'nowrap' as const,
  },
  touchInlineDisabled: {
    fontSize: 11, color: '#bbb', fontWeight: 500,
  },

  // ── Toast ──
  toast: {
    position: 'fixed' as const,
    top: 'calc(env(safe-area-inset-top) + 16px)',
    left: '50%', transform: 'translateX(-50%)',
    maxWidth: 340, padding: '10px 16px',
    borderRadius: 10, fontSize: 13, fontWeight: 600,
    boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
    zIndex: 400,
  },
  toastOk: { background: '#52c41a', color: '#fff' },
  toastErr: { background: '#fa541c', color: '#fff' },
}
