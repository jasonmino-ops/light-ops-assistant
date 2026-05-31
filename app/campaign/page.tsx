'use client'

import { useEffect, useState, CSSProperties } from 'react'
import { apiFetch, OWNER_CTX } from '@/lib/api'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')

// ── Types ────────────────────────────────────────────────────────────────────

type Creator = {
  id: string; name: string; displayName: string | null
  tiktokHandle: string | null; phone: string | null; note: string | null; status: string
}

type CampaignLink = {
  id: string; code: string
  creatorId: string | null; creatorName: string | null; tiktokHandle: string | null
  videoTitle: string | null
  viewCount: number; clickCount: number
  commissionType: string | null; commissionValue: number | null
  settlementStatus: string
  settledAt: string | null; settledNote: string | null
  attributedOrderCount: number; attributedSalesAmount: number
  estimatedCommission: number
  createdAt: string
}

// ── Copy templates ────────────────────────────────────────────────────────────

const ZH_TPL = (url: string) =>
  `想看菜单/下单，点主页链接进入 E-Life。也可以评论"菜单"，我们发你店铺入口。\n🔗 ${url}`
const EN_TPL = (url: string) =>
  `Menu and order link are in bio. Comment "menu" and we'll send you the shop link.\n🔗 ${url}`

// ── Commission helpers ────────────────────────────────────────────────────────

function commLabel(type: string | null, value: number | null): string {
  if (!type || value == null) return '无佣金'
  if (type === 'percent') return `${value}%/单`
  return `$${value.toFixed(2)}/单`
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CampaignPage() {
  // data
  const [creators, setCreators] = useState<Creator[]>([])
  const [links,    setLinks]    = useState<CampaignLink[]>([])

  // creator form
  const [addCreatorOpen,  setAddCreatorOpen]  = useState(false)
  const [cName,           setCName]           = useState('')
  const [cTiktok,         setCTiktok]         = useState('')
  const [cPhone,          setCPhone]          = useState('')
  const [cNote,           setCNote]           = useState('')
  const [addingCreator,   setAddingCreator]   = useState(false)
  const [creatorError,    setCreatorError]    = useState<string | null>(null)

  // link form
  const [selCreatorId,    setSelCreatorId]    = useState('')
  const [manualName,      setManualName]      = useState('')
  const [videoTitle,      setVideoTitle]      = useState('')
  const [commType,        setCommType]        = useState<'percent' | 'fixed'>('percent')
  const [commValue,       setCommValue]       = useState('')
  const [creating,        setCreating]        = useState(false)
  const [newLink,         setNewLink]         = useState<(CampaignLink & { shortUrl: string }) | null>(null)
  const [createError,     setCreateError]     = useState<string | null>(null)

  // settle
  const [settlingId,   setSettlingId]   = useState<string | null>(null)
  const [settleNote,   setSettleNote]   = useState('')
  const [settlingBusy, setSettlingBusy] = useState(false)

  // copy
  const [copied, setCopied] = useState<string | null>(null)

  async function loadAll() {
    const [rc, rl] = await Promise.all([
      apiFetch('/api/creators',       undefined, OWNER_CTX),
      apiFetch('/api/campaign-links', undefined, OWNER_CTX),
    ])
    if (rc.ok) { const d = await rc.json(); setCreators(d.creators ?? []) }
    if (rl.ok) { const d = await rl.json(); setLinks(d.links ?? []) }
  }

  useEffect(() => { loadAll() }, [])

  // ── Add creator ─────────────────────────────────────────────────────────────

  async function handleAddCreator() {
    if (!cName.trim()) { setCreatorError('博主名称不能为空'); return }
    setAddingCreator(true); setCreatorError(null)
    try {
      const r = await apiFetch('/api/creators', {
        method: 'POST',
        body: JSON.stringify({ name: cName.trim(), tiktokHandle: cTiktok.trim(), phone: cPhone.trim(), note: cNote.trim() }),
      }, OWNER_CTX)
      const d = await r.json()
      if (r.ok) {
        setCName(''); setCTiktok(''); setCPhone(''); setCNote('')
        setAddCreatorOpen(false)
        loadAll()
      } else { setCreatorError(d.message ?? d.error ?? '新增失败') }
    } catch { setCreatorError('网络错误，请重试') }
    finally { setAddingCreator(false) }
  }

  // ── Create link ─────────────────────────────────────────────────────────────

  async function handleCreate() {
    setCreating(true); setCreateError(null); setNewLink(null)
    const commVal = parseFloat(commValue)
    try {
      const body: Record<string, unknown> = { videoTitle: videoTitle.trim() }
      if (selCreatorId)       body.creatorId      = selCreatorId
      else if (manualName.trim()) body.creatorName = manualName.trim()
      if (commValue.trim() && !isNaN(commVal) && commVal > 0) {
        body.commissionType  = commType
        body.commissionValue = commVal
      }
      const r = await apiFetch('/api/campaign-links', { method: 'POST', body: JSON.stringify(body) }, OWNER_CTX)
      const d = await r.json()
      if (r.ok) {
        setNewLink(d); setSelCreatorId(''); setManualName(''); setVideoTitle(''); setCommValue('')
        loadAll()
      } else { setCreateError(d.message ?? d.error ?? '创建失败') }
    } catch { setCreateError('网络错误，请重试') }
    finally { setCreating(false) }
  }

  // ── Settle ──────────────────────────────────────────────────────────────────

  async function handleSettle(linkId: string) {
    setSettlingBusy(true)
    try {
      const r = await apiFetch(`/api/campaign-links/${linkId}/settle`, {
        method: 'POST', body: JSON.stringify({ settledNote: settleNote.trim() }),
      }, OWNER_CTX)
      if (r.ok) { setSettlingId(null); setSettleNote(''); loadAll() }
    } catch { /* silent */ }
    finally { setSettlingBusy(false) }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key); setTimeout(() => setCopied(null), 2200)
    })
  }

  // ── Creator summary (frontend aggregation) ──────────────────────────────────

  const creatorSummary = (() => {
    const map = new Map<string, {
      creatorId: string | null; name: string; tiktokHandle: string | null
      linkCount: number; views: number; clicks: number
      orders: number; sales: number; commission: number; settled: number
    }>()
    for (const lk of links) {
      const key = lk.creatorId ?? lk.creatorName ?? '__anon__'
      if (key === '__anon__') continue
      const existing = map.get(key)
      const isSettled = lk.settlementStatus === 'settled'
      if (existing) {
        existing.linkCount++
        existing.views      += lk.viewCount
        existing.clicks     += lk.clickCount
        existing.orders     += lk.attributedOrderCount
        existing.sales      += lk.attributedSalesAmount
        existing.commission += lk.estimatedCommission
        if (isSettled) existing.settled += lk.estimatedCommission
      } else {
        map.set(key, {
          creatorId:   lk.creatorId,
          name:        lk.creatorName ?? '未知博主',
          tiktokHandle: lk.tiktokHandle,
          linkCount:   1,
          views:       lk.viewCount,
          clicks:      lk.clickCount,
          orders:      lk.attributedOrderCount,
          sales:       lk.attributedSalesAmount,
          commission:  lk.estimatedCommission,
          settled:     isSettled ? lk.estimatedCommission : 0,
        })
      }
    }
    return [...map.values()]
  })()

  // ── Styles ──────────────────────────────────────────────────────────────────

  const s: Record<string, CSSProperties> = {
    page:     { padding: '20px 16px 72px', maxWidth: 560, margin: '0 auto', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' },
    h1:       { fontSize: 20, fontWeight: 700, margin: '0 0 4px', color: '#111827' },
    desc:     { fontSize: 13, color: '#6b7280', margin: '0 0 20px', lineHeight: 1.6 },
    sectionTitle: { fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 12px' },
    card:     { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '16px', marginBottom: 16 },
    label:    { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 },
    input:    { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' as const, outline: 'none' },
    select:   { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' as const, outline: 'none', background: '#fff' },
    row:      { display: 'flex', alignItems: 'center', gap: 8 },
    btn:      { padding: '10px 20px', background: '#07c160', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
    btnSm:    { padding: '6px 14px', background: '#07c160', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
    btnGhost: { padding: '6px 14px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, cursor: 'pointer' },
    btnCopy:  { padding: '5px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0 },
    btnSettle:{ padding: '4px 10px', background: '#fff', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' as const },
    error:    { color: '#ef4444', fontSize: 13, marginTop: 8 },
    success:  { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 16, marginTop: 12 },
    divider:  { height: 1, background: '#e5e7eb', margin: '12px 0' },
    stat:     { fontSize: 11, color: '#9ca3af', marginTop: 3 },
    tplBox:   {
      background: '#f9fafb', borderRadius: 8, padding: '10px 12px',
      fontSize: 12, color: '#374151', whiteSpace: 'pre-wrap' as const,
      lineHeight: 1.6, wordBreak: 'break-word' as const, border: '1px solid #e5e7eb', marginBottom: 6,
    },
    halfRow:  { display: 'flex', gap: 8 },
  }

  function badge(settled: boolean): CSSProperties {
    return {
      display: 'inline-block', padding: '2px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600,
      background: settled ? '#f0fdf4' : '#fef9c3',
      color:      settled ? '#15803d' : '#854d0e',
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      <h1 style={s.h1}>📱 TikTok 推广管理</h1>
      <p style={s.desc}>管理博主档案、生成推广短链，查看成交与佣金数据，一键标记结算。</p>

      {/* ── 1. 博主管理 ─────────────────────────────────────────────────── */}
      <div style={s.card}>
        <div style={{ ...s.row, justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={s.sectionTitle}>👤 博主管理</div>
          <button style={s.btnSm} onClick={() => { setAddCreatorOpen(!addCreatorOpen); setCreatorError(null) }}>
            {addCreatorOpen ? '收起' : '+ 新增博主'}
          </button>
        </div>

        {addCreatorOpen && (
          <div style={{ background: '#f9fafb', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ marginBottom: 8 }}>
              <label style={s.label}>博主名称 *</label>
              <input style={s.input} placeholder="如：小红薯KOL" value={cName} onChange={(e) => setCName(e.target.value)} />
            </div>
            <div style={{ ...s.halfRow, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={s.label}>TikTok 账号</label>
                <input style={s.input} placeholder="@handle" value={cTiktok} onChange={(e) => setCTiktok(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={s.label}>联系电话</label>
                <input style={s.input} placeholder="可选" value={cPhone} onChange={(e) => setCPhone(e.target.value)} />
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={s.label}>备注</label>
              <input style={s.input} placeholder="可选" value={cNote} onChange={(e) => setCNote(e.target.value)} />
            </div>
            {creatorError && <div style={s.error}>{creatorError}</div>}
            <div style={{ ...s.row, marginTop: 10 }}>
              <button style={s.btnSm} onClick={handleAddCreator} disabled={addingCreator}>
                {addingCreator ? '保存中…' : '保存博主'}
              </button>
              <button style={s.btnGhost} onClick={() => setAddCreatorOpen(false)}>取消</button>
            </div>
          </div>
        )}

        {creators.length === 0 ? (
          <div style={{ fontSize: 13, color: '#9ca3af' }}>暂无博主，点击「新增博主」添加</div>
        ) : (
          creators.map((c, i) => (
            <div key={c.id} style={{
              borderBottom: i < creators.length - 1 ? '1px solid #f0f0f0' : 'none',
              paddingBottom: i < creators.length - 1 ? 10 : 0,
              marginBottom:  i < creators.length - 1 ? 10 : 0,
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{c.name}</div>
              {c.tiktokHandle && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>🎵 @{c.tiktokHandle}</div>}
              {c.phone        && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 1 }}>📞 {c.phone}</div>}
              {c.note         && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 1 }}>📝 {c.note}</div>}
            </div>
          ))
        )}
      </div>

      {/* ── 2. 生成短链 ─────────────────────────────────────────────────── */}
      <div style={s.card}>
        <div style={{ ...s.sectionTitle, marginBottom: 12 }}>🔗 生成推广短链</div>

        {/* 博主选择 */}
        <div style={{ marginBottom: 10 }}>
          <label style={s.label}>选择博主</label>
          <select style={s.select} value={selCreatorId} onChange={(e) => { setSelCreatorId(e.target.value); setManualName('') }}>
            <option value="">── 手动输入 ──</option>
            {creators.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.tiktokHandle ? ` (@${c.tiktokHandle})` : ''}</option>
            ))}
          </select>
        </div>
        {!selCreatorId && (
          <div style={{ marginBottom: 10 }}>
            <label style={s.label}>临时博主名称（选填）</label>
            <input style={s.input} placeholder="如：@达人名" value={manualName} onChange={(e) => setManualName(e.target.value)} />
          </div>
        )}
        <div style={{ marginBottom: 10 }}>
          <label style={s.label}>视频标题备注（选填）</label>
          <input style={s.input} placeholder="如：5月新品推荐视频" value={videoTitle} onChange={(e) => setVideoTitle(e.target.value)} />
        </div>

        {/* 佣金 */}
        <div style={{ ...s.halfRow, marginBottom: 4 }}>
          <div style={{ flex: 1 }}>
            <label style={s.label}>佣金类型</label>
            <select style={s.select} value={commType} onChange={(e) => setCommType(e.target.value as 'percent' | 'fixed')}>
              <option value="percent">百分比（%）</option>
              <option value="fixed">固定金额（$/单）</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={s.label}>佣金数值（选填）</label>
            <input style={s.input} placeholder={commType === 'percent' ? '如：5' : '如：1.00'} value={commValue} onChange={(e) => setCommValue(e.target.value)} type="number" min="0" step="0.01" />
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 12 }}>
          {commType === 'percent' ? '预计佣金 = 成交金额 × 填入百分比 / 100' : '预计佣金 = 成交单数 × 填入金额'}
        </div>

        {createError && <div style={s.error}>{createError}</div>}
        <button style={s.btn} onClick={handleCreate} disabled={creating}>
          {creating ? '生成中…' : '生成短链'}
        </button>
      </div>

      {/* 新建结果 */}
      {newLink && (() => {
        const fullUrl = `${APP_URL}/v/${newLink.code}`
        return (
          <div style={s.success}>
            <div style={{ fontSize: 13, color: '#15803d', fontWeight: 600, marginBottom: 10 }}>✅ 短链已生成</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#07c160', letterSpacing: '0.06em', marginBottom: 8 }}>/v/{newLink.code}</div>
            <div style={{ ...s.row, background: '#f3f4f6', borderRadius: 8, padding: '7px 10px', marginBottom: 12 }}>
              <span style={{ flex: 1, fontSize: 12, color: '#6b7280', fontFamily: 'ui-monospace,monospace', overflowX: 'auto' as const, whiteSpace: 'nowrap' as const, display: 'block' }}>
                {fullUrl}
              </span>
              <button style={s.btnCopy} onClick={() => copy(fullUrl, 'url')}>{copied === 'url' ? '已复制 ✓' : '复制链接'}</button>
            </div>
            <div style={s.divider} />
            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>置顶评论文案（中文）</div>
            <div style={s.tplBox}>{ZH_TPL(fullUrl)}</div>
            <div style={{ ...s.row, justifyContent: 'flex-end', marginBottom: 10 }}>
              <button style={s.btnCopy} onClick={() => copy(ZH_TPL(fullUrl), 'zh')}>{copied === 'zh' ? '已复制 ✓' : '复制中文'}</button>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>置顶评论文案（英文）</div>
            <div style={s.tplBox}>{EN_TPL(fullUrl)}</div>
            <div style={{ ...s.row, justifyContent: 'flex-end' }}>
              <button style={s.btnCopy} onClick={() => copy(EN_TPL(fullUrl), 'en')}>{copied === 'en' ? '已复制 ✓' : '复制英文'}</button>
            </div>
          </div>
        )
      })()}

      {/* ── 3. 博主汇总 ─────────────────────────────────────────────────── */}
      {creatorSummary.length > 0 && (
        <div style={{ ...s.card, marginTop: 8 }}>
          <div style={{ ...s.sectionTitle, marginBottom: 12 }}>📊 博主汇总</div>
          {creatorSummary.map((cs, i) => {
            const unsettled = +(cs.commission - cs.settled).toFixed(2)
            return (
              <div key={cs.creatorId ?? cs.name} style={{
                borderBottom: i < creatorSummary.length - 1 ? '1px solid #f0f0f0' : 'none',
                paddingBottom: i < creatorSummary.length - 1 ? 12 : 0,
                marginBottom:  i < creatorSummary.length - 1 ? 12 : 0,
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{cs.name}</div>
                {cs.tiktokHandle && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>🎵 @{cs.tiktokHandle}</div>}
                <div style={{ ...s.stat, marginTop: 6 }}>
                  🔗 {cs.linkCount} 条短链　👁 {cs.views} 浏览　🛒 {cs.clicks} 点击
                </div>
                <div style={{ ...s.stat, marginTop: 3 }}>
                  📦 {cs.orders} 单　💰 ${cs.sales.toFixed(2)} 成交
                </div>
                {cs.commission > 0 && (
                  <div style={{ ...s.stat, marginTop: 3 }}>
                    💵 预计佣金 ${cs.commission.toFixed(2)}
                    已结算 ${cs.settled.toFixed(2)}
                    <span style={{ color: unsettled > 0 ? '#b45309' : '#9ca3af' }}>
                      待结算 ${unsettled.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── 4. 历史短链 ─────────────────────────────────────────────────── */}
      <div style={{ ...s.card, marginTop: 8 }}>
        <div style={{ ...s.sectionTitle, marginBottom: 12 }}>📋 历史短链</div>
        {links.length === 0 ? (
          <div style={{ fontSize: 13, color: '#9ca3af' }}>暂无推广短链，生成第一条后会显示在这里</div>
        ) : (
          links.map((lk, i) => {
            const fullUrl   = `${APP_URL}/v/${lk.code}`
            const isSettled = lk.settlementStatus === 'settled'
            const isSettling = settlingId === lk.id

            return (
              <div key={lk.id} style={{
                borderBottom: i < links.length - 1 ? '1px solid #f0f0f0' : 'none',
                paddingBottom: i < links.length - 1 ? 14 : 0,
                marginBottom:  i < links.length - 1 ? 14 : 0,
              }}>
                {/* 码 + 复制 + 结算状态 */}
                <div style={{ ...s.row, justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#07c160', letterSpacing: '0.04em' }}>/v/{lk.code}</span>
                  <div style={s.row}>
                    <button style={s.btnCopy} onClick={() => copy(fullUrl, lk.code)}>
                      {copied === lk.code ? '已复制 ✓' : '复制'}
                    </button>
                    <span style={badge(isSettled)}>{isSettled ? '已结算' : '未结算'}</span>
                  </div>
                </div>

                {/* 博主 + 视频 */}
                {lk.creatorName && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                    👤 {lk.creatorName}{lk.tiktokHandle ? ` (@${lk.tiktokHandle})` : ''}
                  </div>
                )}
                {lk.videoTitle && (
                  <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>🎬 {lk.videoTitle}</div>
                )}

                {/* 统计 */}
                <div style={s.stat}>
                  👁 {lk.viewCount} 浏览　🛒 {lk.clickCount} 点击
                  📦 {lk.attributedOrderCount} 单　💰 ${lk.attributedSalesAmount.toFixed(2)}
                </div>

                {/* 佣金 */}
                <div style={{ ...s.stat, marginTop: 2 }}>
                  💵 佣金规则：{commLabel(lk.commissionType, lk.commissionValue)}
                  {lk.estimatedCommission > 0 && `　预计 $${lk.estimatedCommission.toFixed(2)}`}
                </div>

                {/* 结算操作 */}
                {!isSettled && (
                  <div style={{ marginTop: 6 }}>
                    {!isSettling ? (
                      <button style={s.btnSettle} onClick={() => { setSettlingId(lk.id); setSettleNote('') }}>
                        标记已结算
                      </button>
                    ) : (
                      <div style={{ background: '#f9fafb', borderRadius: 8, padding: 10, marginTop: 4 }}>
                        <input
                          style={{ ...s.input, fontSize: 13, marginBottom: 8 }}
                          placeholder="结算备注（选填）"
                          value={settleNote}
                          onChange={(e) => setSettleNote(e.target.value)}
                        />
                        <div style={s.row}>
                          <button style={s.btnSm} onClick={() => handleSettle(lk.id)} disabled={settlingBusy}>
                            {settlingBusy ? '处理中…' : '确认结算'}
                          </button>
                          <button style={s.btnGhost} onClick={() => setSettlingId(null)}>取消</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {isSettled && lk.settledAt && (
                  <div style={{ ...s.stat, marginTop: 3, color: '#15803d' }}>
                    ✓ 已结算于 {new Date(lk.settledAt).toLocaleDateString('zh-CN')}
                    {lk.settledNote ? `：${lk.settledNote}` : ''}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
