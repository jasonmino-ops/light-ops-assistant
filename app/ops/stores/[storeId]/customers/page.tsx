'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

type Customer = {
  telegramId: string
  telegramUsername: string | null
  telegramFirstName: string | null
  telegramLastName: string | null
  telegramLanguageCode: string | null
  status: 'active' | 'flagged' | 'revoked' | string
  opsNote: string | null
  firstBoundAt: string
  lastSeenAt: string
  totalOrders: number
  totalSpent: number
  lastOrderAt: string | null
}

type Resp = {
  store:    { id: string; code: string; name: string }
  tenant:   { id: string; name: string }
  role:     'SUPER_ADMIN' | 'OPS_ADMIN' | 'BD'
  customers: Customer[]
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function statusLabel(s: string) {
  if (s === 'flagged') return '⚠️ 异常'
  if (s === 'revoked') return '🚫 已解绑'
  return '✅ 正常'
}

export default function OpsCustomersPage() {
  const params  = useParams<{ storeId: string }>()
  const storeId = params?.storeId ?? ''
  const [data, setData]       = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState('')

  async function load() {
    setLoading(true); setErr('')
    try {
      const r = await fetch(`/api/ops/stores/${encodeURIComponent(storeId)}/customers`, { cache: 'no-store' })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) setErr(b?.error ?? 'LOAD_FAILED')
      else setData(b)
    } catch { setErr('NETWORK') }
    finally { setLoading(false) }
  }
  useEffect(() => { if (storeId) load() }, [storeId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(c: Customer, body: { opsNote?: string; status?: string; reason?: string }) {
    const r = await fetch(`/api/ops/stores/${encodeURIComponent(storeId)}/customers/${encodeURIComponent(c.telegramId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const b = await r.json().catch(() => ({}))
    if (!r.ok) { alert(b?.error ?? 'FAIL'); return }
    await load()
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <Link href={data ? `/ops/${data.tenant.id}` : '/ops'} style={s.backLink}>← 返回商户详情</Link>
      </div>
      <div style={s.body}>
        {loading && <div style={s.muted}>加载中…</div>}
        {err && <div style={s.err}>{err === 'FORBIDDEN' ? '无权限' : err === 'STORE_NOT_FOUND' ? '门店不存在' : `加载失败：${err}`}</div>}
        {data && (
          <>
            <div style={s.card}>
              <div style={s.cardRow}><span style={s.k}>商户</span><span style={s.v}>{data.tenant.name}</span></div>
              <div style={s.cardRow}><span style={s.k}>门店</span><span style={s.v}>{data.store.name}</span></div>
              <div style={s.cardRow}><span style={s.k}>storeCode</span><span style={{ ...s.v, fontFamily: 'monospace' }}>{data.store.code}</span></div>
              <div style={s.cardRow}><span style={s.k}>storeId</span><span style={{ ...s.v, fontFamily: 'monospace', fontSize: 11 }}>{data.store.id}</span></div>
              <div style={s.cardRow}><span style={s.k}>数据范围</span><span style={s.v}>仅当前商户 · {data.customers.length} 位顾客</span></div>
            </div>

            {data.customers.length === 0 && (
              <div style={s.muted}>该门店暂无绑定顾客</div>
            )}

            <div style={s.list}>
              {data.customers.map((c) => (
                <CustomerRow key={c.telegramId} c={c} onPatch={patch} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CustomerRow({ c, onPatch }: {
  c: Customer
  onPatch: (c: Customer, body: { opsNote?: string; status?: string; reason?: string }) => Promise<void>
}) {
  const [note, setNote] = useState(c.opsNote ?? '')
  const [reason, setReason] = useState('')
  const name = c.telegramFirstName || c.telegramUsername || c.telegramId
  return (
    <div style={s.row}>
      <div style={s.rowTop}>
        <span style={s.name}>{name}</span>
        {c.telegramUsername && <span style={s.uname}>@{c.telegramUsername}</span>}
        <span style={s.tg}>TG {c.telegramId}</span>
        <span style={c.status === 'active' ? s.tagOk : c.status === 'flagged' ? s.tagWarn : s.tagOff}>
          {statusLabel(c.status)}
        </span>
      </div>
      <div style={s.rowMeta}>
        订单 {c.totalOrders} · 累计 ${c.totalSpent.toFixed(2)} · 最近下单 {fmt(c.lastOrderAt)} · 首次绑定 {fmt(c.firstBoundAt)}
      </div>

      <div style={s.editRow}>
        <input
          style={s.input}
          placeholder="OPS 备注（仅运营可见）"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
        />
        <button style={s.btn} onClick={() => onPatch(c, { opsNote: note })}>保存备注</button>
      </div>

      <div style={s.editRow}>
        <input
          style={s.input}
          placeholder="原因 / 备注（写入 audit）"
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 200))}
        />
        {c.status !== 'flagged' && (
          <button style={s.btnWarn} onClick={() => onPatch(c, { status: 'flagged', reason })}>⚠️ 标记异常</button>
        )}
        {c.status === 'flagged' && (
          <button style={s.btn} onClick={() => onPatch(c, { status: 'active', reason })}>取消异常</button>
        )}
        {c.status !== 'revoked' ? (
          <button style={s.btnDanger} onClick={() => {
            if (!confirm('确认解除该顾客与本店的错误绑定？')) return
            onPatch(c, { status: 'revoked', reason })
          }}>🚫 解除绑定</button>
        ) : (
          <button style={s.btn} onClick={() => onPatch(c, { status: 'active', reason })}>恢复绑定</button>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page:   { minHeight: '100dvh', background: '#1a1a22', color: '#fff' },
  header: { padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  backLink: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textDecoration: 'none' },
  body:   { padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 12, maxWidth: 720, margin: '0 auto' },
  muted:  { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  err:    { fontSize: 13, color: '#ff7875', background: 'rgba(255,77,79,0.12)', border: '1px solid rgba(255,77,79,0.3)', borderRadius: 8, padding: '8px 12px' },
  card:   { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column' as const, gap: 6 },
  cardRow:{ display: 'flex', justifyContent: 'space-between', fontSize: 13 },
  k:      { color: 'rgba(255,255,255,0.6)' },
  v:      { color: '#fff', fontWeight: 600 },
  list:   { display: 'flex', flexDirection: 'column' as const, gap: 10 },
  row:    { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column' as const, gap: 8 },
  rowTop: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, gap: 8 },
  name:   { fontSize: 14, fontWeight: 700 },
  uname:  { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  tg:     { fontSize: 11, fontFamily: 'monospace' as const, color: 'rgba(255,255,255,0.4)' },
  rowMeta:{ fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  editRow:{ display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  input:  { flex: 1, minWidth: 180, padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#fff', fontSize: 12 },
  btn:    { fontSize: 12, fontWeight: 600, color: '#fff', background: '#1677ff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' },
  btnWarn:{ fontSize: 12, fontWeight: 600, color: '#fff', background: '#fa8c16', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' },
  btnDanger:{ fontSize: 12, fontWeight: 600, color: '#fff', background: '#cf1322', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' },
  tagOk:  { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'rgba(82,196,26,0.15)', color: '#73d13d' },
  tagWarn:{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'rgba(250,140,22,0.15)', color: '#ffa940' },
  tagOff: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'rgba(207,19,34,0.18)', color: '#ff7875' },
}
