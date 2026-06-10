'use client'

import { useEffect, useState, CSSProperties } from 'react'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import { publicUrl } from '@/lib/public-url'

const publicLink = (path: string) => publicUrl(path)

// ── Types ────────────────────────────────────────────────────────────────────

type Creator = {
  id: string; name: string; displayName: string | null
  tiktokHandle: string | null; phone: string | null; note: string | null; status: string
  preferredLang: string | null
  dashboardToken: string | null; dashboardTokenCreatedAt: string | null
}

type CampaignLink = {
  id: string; code: string
  creatorId: string | null; creatorName: string | null; tiktokHandle: string | null
  videoTitle: string | null
  targetUrl: string | null
  viewCount: number; clickCount: number
  commissionType: string | null; commissionValue: number | null
  settlementStatus: string
  settledAt: string | null; settledNote: string | null
  attributedOrderCount: number; attributedSalesAmount: number
  estimatedCommission: number
  landingRisk: string | null
  createdAt: string
}

type MarketingPageOption = {
  id: string
  slug: string
  status: string
  title: string | null
}

type AnalyticsSort = 'sales' | 'orders' | 'clicks'
type AnalyticsFilter = 'all' | 'official' | 'creator'

// ── Copy templates ────────────────────────────────────────────────────────────

const ZH_TPL = (url: string) =>
  `想看菜单/下单，点主页链接进入 E-Life。也可以评论"菜单"，我们发你店铺入口。\n🔗 ${url}`
const EN_TPL = (url: string) =>
  `Menu and order link are in bio. Comment "menu" and we'll send you the shop link.\n🔗 ${url}`

// ── Material templates (trilingual) ──────────────────────────────────────────

type MLang = 'zh' | 'en' | 'km'
const ML_LABELS: Record<MLang, string> = { zh: '中文', en: 'English', km: 'ខ្មែរ' }
const ML_LANGS: MLang[] = ['zh', 'en', 'km']

function matBio(lang: MLang): string {
  if (lang === 'en') return `👇 Order link is in my bio\nExclusive deals for TikTok fans`
  if (lang === 'km') return `👇 ចុចតំណភ្ជាប់ក្នុងជីវប្រវត្តិ\nការផ្តល់ជូនពិសេសសម្រាប់អ្នកតាម TikTok`
  return `👇 点主页链接进店下单\nTikTok 粉丝专享价`
}

function matComment(url: string, lang: MLang): string {
  if (lang === 'en') return `Want to order? 👇\nTap the link in bio — exclusive TikTok deal!\n🔗 ${url}`
  if (lang === 'km') return `ចង់ទិញ? 👇\nចុចតំណភ្ជាប់ — ការផ្តល់ជូន TikTok ពិសេស!\n🔗 ${url}`
  return `想买的宝子看这里 👇\n主页有下单链接，TikTok 粉丝专属价！\n🔗 ${url}`
}

function matDM(url: string, lang: MLang): string {
  if (lang === 'en') return `Hi! Thanks for your interest ❤️\nClick here to order: ${url}\nFeel free to ask if you have any questions 😊`
  if (lang === 'km') return `សួស្ដី! អរគុណសម្រាប់ការចាប់អារម្មណ៍ ❤️\nចុចទីនេះដើម្បីបញ្ជាទិញ: ${url} 😊`
  return `你好！感谢关注 ❤️\n下单直接点这个链接：${url}\n有问题随时找我 😊`
}

function matScript(url: string, lang: MLang): string {
  if (lang === 'en') return `【Script Template】\n\nHook (0-3s):\nShow product / scene to grab attention\n\nIntro (3-15s):\n"Today I'm recommending… (describe product)"\n"Great quality — lots of repeat buyers"\n\nCTA (final 3s):\n"Order via link in bio — exclusive TikTok deal!"\n\nPinned comment:\n${url}`
  if (lang === 'km') return `【គំរូស្គ្រីបវីដេអូ】\n\nការបើក (0-3s):\nបង្ហាញផលិតផល ទាក់ទាញការចាប់អារម្មណ៍\n\nការណែនាំ (3-15s):\n"ថ្ងៃនេះខ្ញុំចង់ណែនាំ… (ណែនាំផលិតផល)"\n"គុណភាពល្អ អ្នកច្រើននាក់ទិញម្តងទៀត"\n\nCTA (3s ចុងក្រោយ):\n"ចុចតំណភ្ជាប់ / Link: ${url}"\n\nMuted comment:\n${url}`
  return `【视频脚本模板】\n\n开场（0-3秒）：\n展示产品或使用场景，吸引眼球\n\n介绍（3-15秒）：\n"今天给大家推荐一款…（产品介绍）"\n"口感 / 效果很好，很多人回购"\n\n行动引导（最后3秒）：\n"主页链接直接下单，TikTok 粉丝专属价！"\n\n置顶评论：\n${url}`
}

// ── Commission helpers ────────────────────────────────────────────────────────

function commLabel(type: string | null, value: number | null): string {
  if (!type || value == null) return '无佣金'
  if (type === 'percent') return `${value}%/单`
  return `$${value.toFixed(2)}/单`
}

function commissionValueLabel(type: string | null, value: number | null): string {
  if (!type || value == null) return '未设置'
  if (type === 'percent') return `${value}%`
  if (type === 'fixed') return `$${value.toFixed(2)}/单`
  return '未设置'
}

function settlementLabel(status: string): string {
  return status === 'settled' ? '已结算' : '待结算'
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CampaignPage() {
  // data
  const [creators, setCreators] = useState<Creator[]>([])
  const [links,    setLinks]    = useState<CampaignLink[]>([])
  const [marketingPages, setMarketingPages] = useState<MarketingPageOption[]>([])

  // creator form
  const [addCreatorOpen,  setAddCreatorOpen]  = useState(false)
  const [cName,           setCName]           = useState('')
  const [cTiktok,         setCTiktok]         = useState('')
  const [cPhone,          setCPhone]          = useState('')
  const [cNote,           setCNote]           = useState('')
  const [cLang,           setCLang]           = useState('')
  const [addingCreator,   setAddingCreator]   = useState(false)
  const [creatorError,    setCreatorError]    = useState<string | null>(null)

  // link form
  const [selCreatorId,    setSelCreatorId]    = useState('')
  const [manualName,      setManualName]      = useState('')
  const [videoTitle,      setVideoTitle]      = useState('')
  const [commType,        setCommType]        = useState<'percent' | 'fixed'>('percent')
  const [commValue,       setCommValue]       = useState('')
  const [landingType,     setLandingType]     = useState<'menu' | 'product'>('menu')
  const [marketingPageId, setMarketingPageId] = useState('')
  const [creating,        setCreating]        = useState(false)
  const [newLink,         setNewLink]         = useState<(CampaignLink & { shortUrl: string }) | null>(null)
  const [createError,     setCreateError]     = useState<string | null>(null)

  // settle
  const [settlingId,   setSettlingId]   = useState<string | null>(null)
  const [settleNote,   setSettleNote]   = useState('')
  const [settlingBusy, setSettlingBusy] = useState(false)

  // dashboard token
  const [tokenBusyId, setTokenBusyId] = useState<string | null>(null)

  // material drawer
  const [materialLink, setMaterialLink] = useState<CampaignLink | null>(null)
  const [materialLang, setMaterialLang] = useState<MLang>('zh')

  // copy
  const [copied, setCopied] = useState<string | null>(null)
  const [editingLandingId, setEditingLandingId] = useState<string | null>(null)
  const [editLandingType, setEditLandingType] = useState<'menu' | 'product'>('menu')
  const [editMarketingPageId, setEditMarketingPageId] = useState('')
  const [landingSavingId, setLandingSavingId] = useState<string | null>(null)
  const [landingError, setLandingError] = useState<string | null>(null)
  const [analyticsSort, setAnalyticsSort] = useState<AnalyticsSort>('sales')
  const [analyticsFilter, setAnalyticsFilter] = useState<AnalyticsFilter>('all')
  const [openMoreId, setOpenMoreId] = useState<string | null>(null)

  async function loadAll() {
    const [rc, rl, rp] = await Promise.all([
      apiFetch('/api/creators',       undefined, OWNER_CTX),
      apiFetch('/api/campaign-links', undefined, OWNER_CTX),
      apiFetch('/api/marketing-product-pages', undefined, OWNER_CTX),
    ])
    if (rc.ok) { const d = await rc.json(); setCreators(d.creators ?? []) }
    if (rl.ok) { const d = await rl.json(); setLinks(d.links ?? []) }
    if (rp.ok) {
      const d = await rp.json()
      setMarketingPages((d.pages ?? []).filter((p: MarketingPageOption) => p.status === 'PUBLISHED'))
    }
  }

  useEffect(() => { loadAll() }, [])

  // ── Add creator ─────────────────────────────────────────────────────────────

  async function handleAddCreator() {
    if (!cName.trim()) { setCreatorError('博主名称不能为空'); return }
    setAddingCreator(true); setCreatorError(null)
    try {
      const r = await apiFetch('/api/creators', {
        method: 'POST',
        body: JSON.stringify({ name: cName.trim(), tiktokHandle: cTiktok.trim(), phone: cPhone.trim(), note: cNote.trim(), preferredLang: cLang || undefined }),
      }, OWNER_CTX)
      const d = await r.json()
      if (r.ok) {
        setCName(''); setCTiktok(''); setCPhone(''); setCNote('')
        setAddCreatorOpen(false); setCLang('')
        loadAll()
      } else { setCreatorError(d.message ?? d.error ?? '新增失败') }
    } catch { setCreatorError('网络错误，请重试') }
    finally { setAddingCreator(false) }
  }

  // ── Create link ─────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (landingType === 'product' && !marketingPageId) {
      setCreateError('请选择营销页')
      return
    }
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
      if (landingType === 'product') {
        const page = marketingPages.find((p) => p.id === marketingPageId)
        if (page) body.targetUrl = `/p/${page.slug}`
      }
      const r = await apiFetch('/api/campaign-links', { method: 'POST', body: JSON.stringify(body) }, OWNER_CTX)
      const d = await r.json()
      if (r.ok) {
        setNewLink(d); setSelCreatorId(''); setManualName(''); setVideoTitle(''); setCommValue('')
        setLandingType('menu'); setMarketingPageId('')
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

  async function handleGenerateToken(creatorId: string) {
    setTokenBusyId(creatorId)
    try {
      const r = await apiFetch(`/api/creators/${creatorId}/dashboard-token`, { method: 'POST' }, OWNER_CTX)
      if (r.ok) { loadAll() }
    } catch { /* silent */ }
    finally { setTokenBusyId(null) }
  }

  function pageByTargetUrl(targetUrl: string | null): MarketingPageOption | null {
    if (!targetUrl?.startsWith('/p/')) return null
    const slug = targetUrl.slice(3).split(/[?#]/)[0]
    return marketingPages.find((p) => p.slug === slug) ?? null
  }

  function beginLandingEdit(link: CampaignLink) {
    const page = pageByTargetUrl(link.targetUrl)
    setEditingLandingId(link.id)
    setEditLandingType(page ? 'product' : 'menu')
    setEditMarketingPageId(page?.id ?? '')
    setLandingError(null)
  }

  async function saveLanding(linkId: string) {
    if (editLandingType === 'product' && !editMarketingPageId) {
      setLandingError('请选择营销页')
      return
    }
    setLandingSavingId(linkId); setLandingError(null)
    const page = marketingPages.find((p) => p.id === editMarketingPageId)
    const targetUrl = editLandingType === 'product' && page ? `/p/${page.slug}` : ''
    try {
      const r = await apiFetch(`/api/campaign-links/${linkId}`, {
        method: 'PATCH',
        body: JSON.stringify({ targetUrl }),
      }, OWNER_CTX)
      const d = await r.json()
      if (r.ok) {
        setEditingLandingId(null); setEditMarketingPageId(''); setEditLandingType('menu')
        loadAll()
      } else {
        setLandingError(d.message ?? d.error ?? '保存失败')
      }
    } catch { setLandingError('网络错误，请重试') }
    finally { setLandingSavingId(null) }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key); setTimeout(() => setCopied(null), 2200)
    })
  }

  function landingLabel(targetUrl: string | null): string {
    return targetUrl?.startsWith('/p/') ? '营销页' : '菜单页'
  }

  function landingDisplay(link: CampaignLink, page: MarketingPageOption | null): string {
    if (!link.targetUrl) return '菜单页'
    if (link.targetUrl.startsWith('/menu')) return '菜单页'
    if (link.targetUrl.startsWith('/p/')) return page ? `营销页：${page.title || page.slug}` : `营销页：${link.targetUrl}`
    return link.targetUrl
  }

  function sourceTypeLabel(link: CampaignLink): string {
    return link.creatorId || link.creatorName ? '博主推广' : '官方推广'
  }

  function isCreatorPromotion(link: CampaignLink): boolean {
    return !!(link.creatorId || link.creatorName)
  }

  function ctr(link: CampaignLink): string {
    if (link.viewCount <= 0) return '0.0%'
    return `${((link.clickCount / link.viewCount) * 100).toFixed(1)}%`
  }

  function avgOrderValue(link: CampaignLink): string {
    if (link.attributedOrderCount <= 0) return '$0.00'
    return `$${(link.attributedSalesAmount / link.attributedOrderCount).toFixed(2)}`
  }

  const filteredAnalyticsLinks = links.filter((lk) => {
    if (analyticsFilter === 'creator') return isCreatorPromotion(lk)
    if (analyticsFilter === 'official') return !isCreatorPromotion(lk)
    return true
  })

  const analyticsLinks = [...filteredAnalyticsLinks].sort((a, b) => {
    if (analyticsSort === 'orders') return b.attributedOrderCount - a.attributedOrderCount
    if (analyticsSort === 'clicks') return b.clickCount - a.clickCount
    return b.attributedSalesAmount - a.attributedSalesAmount
  })

  const analyticsTotals = filteredAnalyticsLinks.reduce((acc, lk) => {
    acc.sales += lk.attributedSalesAmount
    acc.orders += lk.attributedOrderCount
    acc.commission += lk.estimatedCommission
    acc.views += lk.viewCount
    acc.clicks += lk.clickCount
    if (lk.settlementStatus !== 'settled') acc.unsettled += lk.estimatedCommission
    return acc
  }, { sales: 0, orders: 0, commission: 0, unsettled: 0, views: 0, clicks: 0 })

  // ── Styles ──────────────────────────────────────────────────────────────────

  const s: Record<string, CSSProperties> = {
    page:     { padding: '16px 14px 72px', maxWidth: 960, margin: '0 auto', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', background: '#f6f7f8', minHeight: '100dvh' },
    topBar:   { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' as const },
    h1:       { fontSize: 24, fontWeight: 800, margin: '0 0 6px', color: '#111827', letterSpacing: 0 },
    desc:     { fontSize: 13, color: '#6b7280', margin: 0, lineHeight: 1.6 },
    sectionTitle: { fontSize: 16, fontWeight: 800, color: '#111827', margin: '0 0 4px' },
    sectionHint: { fontSize: 12, color: '#9ca3af', lineHeight: 1.5 },
    card:     { background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: '16px', marginBottom: 14, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' },
    cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
    label:    { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 },
    input:    { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' as const, outline: 'none' },
    select:   { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' as const, outline: 'none', background: '#fff' },
    row:      { display: 'flex', alignItems: 'center', gap: 8 },
    formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 },
    fullSpan: { gridColumn: '1 / -1' },
    creatorGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 },
    creatorCard: { border: '1px solid #edf0f3', borderRadius: 8, padding: 12, background: '#fbfcfd' },
    btn:      { padding: '10px 20px', background: '#07c160', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
    btnSm:    { padding: '6px 14px', background: '#07c160', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
    btnGhost: { padding: '6px 14px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, cursor: 'pointer' },
    btnCopy:  { padding: '5px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0 },
    btnSettle:{ padding: '4px 10px', background: '#fff', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' as const },
    sortBtn:  { padding: '5px 10px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 14, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const },
    tableWrap:{ overflowX: 'auto' as const, border: '1px solid #e5e7eb', borderRadius: 8 },
    table:    { width: '100%', minWidth: 820, borderCollapse: 'collapse' as const, fontSize: 12 },
    th:       { textAlign: 'left' as const, padding: '9px 10px', background: '#f9fafb', color: '#6b7280', fontWeight: 700, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' as const },
    td:       { padding: '10px', borderBottom: '1px solid #f3f4f6', color: '#374151', verticalAlign: 'top' as const },
    metricGrid:{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 12 },
    metricBox:{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px' },
    metricLabel:{ fontSize: 11, color: '#6b7280', marginBottom: 4 },
    metricValue:{ fontSize: 18, color: '#111827', fontWeight: 800 },
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
    linkCard: { border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, background: '#fff', marginBottom: 10 },
    linkCode: { fontSize: 16, fontWeight: 800, color: '#07c160', letterSpacing: '0.03em' },
    linkStats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))', gap: 8, marginTop: 10 },
    linkStatBox: { background: '#f9fafb', borderRadius: 8, padding: '8px 10px', border: '1px solid #edf0f3' },
    linkStatLabel: { fontSize: 10, color: '#9ca3af', marginBottom: 2 },
    linkStatValue: { fontSize: 13, fontWeight: 800, color: '#111827' },
    riskBox: { marginTop: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontSize: 12, fontWeight: 700 },
    moreWrap: { width: '100%', marginTop: 10 },
    moreMenu: { width: '100%', boxSizing: 'border-box' as const, background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 10, boxShadow: '0 8px 22px rgba(15,23,42,0.12)', padding: 8 },
    moreItem: { display: 'block', width: '100%', textAlign: 'left' as const, padding: '10px 12px', border: 0, borderBottom: '1px solid #e2e8f0', borderRadius: 6, background: 'transparent', color: '#334155', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
    tips: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, color: '#4b5563', fontSize: 13, lineHeight: 1.8 },
  }

  function badge(settled: boolean): CSSProperties {
    return {
      display: 'inline-block', padding: '2px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600,
      background: settled ? '#f0fdf4' : '#fef9c3',
      color:      settled ? '#15803d' : '#854d0e',
    }
  }

  function matLangBtn(active: boolean): CSSProperties {
    return {
      padding: '3px 8px', fontSize: 11, fontWeight: 600, borderRadius: 12,
      border: '1px solid', cursor: 'pointer',
      background:  active ? '#07c160' : '#f3f4f6',
      color:       active ? '#fff'    : '#6b7280',
      borderColor: active ? '#07c160' : '#e5e7eb',
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      <div style={s.topBar}>
        <div>
          <h1 style={s.h1}>TikTok 推广管理</h1>
          <p style={s.desc}>创建推广短链，追踪点击、订单、销售额和佣金。</p>
        </div>
        <button
          style={s.btn}
          onClick={() => document.getElementById('create-campaign-link')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          + 新建推广短链
        </button>
      </div>

      {/* ── 1. 博主管理 ─────────────────────────────────────────────────── */}
      <div style={s.card}>
        <div style={s.cardHead}>
          <div>
            <div style={s.sectionTitle}>博主管理</div>
            <div style={s.sectionHint}>维护博主资料和对外看板链接。</div>
          </div>
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
            <div style={{ ...s.halfRow, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={s.label}>备注</label>
                <input style={s.input} placeholder="可选" value={cNote} onChange={(e) => setCNote(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={s.label}>默认语言</label>
                <select style={s.select} value={cLang} onChange={(e) => setCLang(e.target.value)}>
                  <option value="">未设置</option>
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                  <option value="km">ខ្មែរ</option>
                </select>
              </div>
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
          <div style={s.creatorGrid}>
            {creators.map((c) => (
              <div key={c.id} style={s.creatorCard}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#111827' }}>{c.name}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 5 }}>
                  {c.tiktokHandle ? `@${c.tiktokHandle}` : '未填写 TikTok'}
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 3 }}>{c.phone || '未填写电话'}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginTop: 10 }}>
                  {!c.dashboardToken ? (
                    <button style={s.btnSm} onClick={() => handleGenerateToken(c.id)} disabled={tokenBusyId === c.id}>
                      {tokenBusyId === c.id ? '生成中…' : '生成看板链接'}
                    </button>
                  ) : (
                    <>
                      <button style={s.btnSm} onClick={() => copy(publicLink(`/creator/p/${c.dashboardToken}`), `tk-${c.id}`)}>
                        {copied === `tk-${c.id}` ? '已复制 ✓' : '复制看板链接'}
                      </button>
                      <button style={s.btnGhost} onClick={() => handleGenerateToken(c.id)} disabled={tokenBusyId === c.id}>
                        {tokenBusyId === c.id ? '重置中…' : '重置'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 2. 生成短链 ─────────────────────────────────────────────────── */}
      <div id="create-campaign-link" style={s.card}>
        <div style={s.cardHead}>
          <div>
            <div style={s.sectionTitle}>生成推广短链</div>
            <div style={s.sectionHint}>选择博主、佣金和落地页，生成可投放的 /v 短链。</div>
          </div>
        </div>

        <div style={s.formGrid}>
          <div>
            <label style={s.label}>选择博主</label>
            <select style={s.select} value={selCreatorId} onChange={(e) => { setSelCreatorId(e.target.value); setManualName('') }}>
              <option value="">── 手动输入 ──</option>
              {creators.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.tiktokHandle ? ` (@${c.tiktokHandle})` : ''}</option>
              ))}
            </select>
          </div>
          {!selCreatorId && (
          <div>
            <label style={s.label}>临时博主名称（选填）</label>
            <input style={s.input} placeholder="如：@达人名" value={manualName} onChange={(e) => setManualName(e.target.value)} />
          </div>
          )}
          <div>
            <label style={s.label}>视频标题备注（选填）</label>
            <input style={s.input} placeholder="如：5月新品推荐视频" value={videoTitle} onChange={(e) => setVideoTitle(e.target.value)} />
          </div>
          <div>
            <label style={s.label}>佣金类型</label>
            <select style={s.select} value={commType} onChange={(e) => setCommType(e.target.value as 'percent' | 'fixed')}>
              <option value="percent">百分比（%）</option>
              <option value="fixed">固定金额（$/单）</option>
            </select>
          </div>
          <div>
            <label style={s.label}>佣金数值（选填）</label>
            <input style={s.input} placeholder={commType === 'percent' ? '如：5' : '如：1.00'} value={commValue} onChange={(e) => setCommValue(e.target.value)} type="number" min="0" step="0.01" />
          </div>
          <div style={s.fullSpan}>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>
              {commType === 'percent' ? '预计佣金 = 成交金额 × 填入百分比 / 100' : '预计佣金 = 成交单数 × 填入金额'}
            </div>
          </div>
          <div>
            <label style={s.label}>落地页类型</label>
            <select style={s.select} value={landingType} onChange={(e) => { setLandingType(e.target.value as 'menu' | 'product'); setMarketingPageId('') }}>
              <option value="menu">菜单页</option>
              <option value="product">营销页</option>
            </select>
          </div>
          {landingType === 'product' && (
            <div>
              <label style={s.label}>选择营销页</label>
              <select style={s.select} value={marketingPageId} onChange={(e) => setMarketingPageId(e.target.value)}>
                <option value="">请选择已发布营销页</option>
                {marketingPages.map((p) => (
                  <option key={p.id} value={p.id}>{p.title || p.slug} · /p/{p.slug}</option>
                ))}
              </select>
              {marketingPages.length === 0 && (
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>暂无已发布营销页，请先到商品页发布营销页。</div>
              )}
            </div>
          )}
        </div>

        {createError && <div style={s.error}>{createError}</div>}
        <div style={{ marginTop: 14 }}>
          <button style={s.btn} onClick={handleCreate} disabled={creating}>
            {creating ? '生成中…' : '生成短链'}
          </button>
        </div>
      </div>

      {/* 新建结果 */}
      {newLink && (() => {
        const fullUrl = publicLink(`/v/${newLink.code}`)
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

      {/* ── 3. 推广效果看板 ─────────────────────────────────────────────── */}
      <div style={{ ...s.card, marginTop: 8 }}>
        <div style={{ ...s.row, justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <div style={{ ...s.sectionTitle, marginBottom: 4 }}>📈 推广效果看板</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>按现有短链和已归因顾客订单统计，不含时间筛选。</div>
          </div>
          <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, justifyContent: 'flex-end' }}>
              {([
                ['all', '全部'],
                ['official', '官方推广'],
                ['creator', '博主推广'],
              ] as [AnalyticsFilter, string][]).map(([key, label]) => (
                <button
                  key={key}
                  style={{
                    ...s.sortBtn,
                    background: analyticsFilter === key ? '#111827' : '#f3f4f6',
                    borderColor: analyticsFilter === key ? '#111827' : '#d1d5db',
                    color: analyticsFilter === key ? '#fff' : '#374151',
                  }}
                  onClick={() => setAnalyticsFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, justifyContent: 'flex-end' }}>
              {([
                ['sales', '销售额最高'],
                ['orders', '订单最多'],
                ['clicks', '点击最多'],
              ] as [AnalyticsSort, string][]).map(([key, label]) => (
                <button
                  key={key}
                  style={{
                    ...s.sortBtn,
                    background: analyticsSort === key ? '#07c160' : '#f3f4f6',
                    borderColor: analyticsSort === key ? '#07c160' : '#d1d5db',
                    color: analyticsSort === key ? '#fff' : '#374151',
                  }}
                  onClick={() => setAnalyticsSort(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {analyticsLinks.length === 0 ? (
          <div style={{ fontSize: 13, color: '#9ca3af' }}>暂无推广短链，生成后会在这里显示效果数据。</div>
        ) : (
          <>
            <div style={s.metricGrid}>
              <div style={s.metricBox}>
                <div style={s.metricLabel}>总销售额</div>
                <div style={s.metricValue}>${analyticsTotals.sales.toFixed(2)}</div>
              </div>
              <div style={s.metricBox}>
                <div style={s.metricLabel}>总订单数</div>
                <div style={s.metricValue}>{analyticsTotals.orders}</div>
              </div>
              <div style={s.metricBox}>
                <div style={s.metricLabel}>预计佣金总额</div>
                <div style={s.metricValue}>${analyticsTotals.commission.toFixed(2)}</div>
              </div>
              <div style={s.metricBox}>
                <div style={s.metricLabel}>待结算佣金</div>
                <div style={s.metricValue}>${analyticsTotals.unsettled.toFixed(2)}</div>
              </div>
              <div style={s.metricBox}>
                <div style={s.metricLabel}>曝光总量</div>
                <div style={s.metricValue}>{analyticsTotals.views}</div>
              </div>
              <div style={s.metricBox}>
                <div style={s.metricLabel}>点击总量</div>
                <div style={s.metricValue}>{analyticsTotals.clicks}</div>
              </div>
            </div>
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>推广名称</th>
                    <th style={s.th}>来源</th>
                    <th style={s.th}>曝光</th>
                    <th style={s.th}>点击</th>
                    <th style={s.th}>CTR</th>
                    <th style={s.th}>订单</th>
                    <th style={s.th}>销售额</th>
                    <th style={s.th}>客单价</th>
                    <th style={s.th}>佣金</th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsLinks.map((lk) => {
                    const name = lk.videoTitle || lk.creatorName || `/v/${lk.code}`
                    const hasCommission = !!lk.commissionType && lk.commissionValue != null
                    return (
                      <tr key={lk.id}>
                        <td style={s.td}>
                          <div style={{ fontWeight: 700, color: '#111827' }}>{name}</div>
                          <div style={{ color: '#9ca3af', marginTop: 2 }}>/v/{lk.code} · {landingLabel(lk.targetUrl)}</div>
                        </td>
                        <td style={s.td}>
                          <div>{sourceTypeLabel(lk)}</div>
                          {lk.creatorName && <div style={{ color: '#9ca3af', marginTop: 2 }}>{lk.creatorName}</div>}
                        </td>
                        <td style={s.td}>{lk.viewCount}</td>
                        <td style={s.td}>{lk.clickCount}</td>
                        <td style={s.td}>{ctr(lk)}</td>
                        <td style={s.td}>{lk.attributedOrderCount}</td>
                        <td style={s.td}>${lk.attributedSalesAmount.toFixed(2)}</td>
                        <td style={s.td}>{avgOrderValue(lk)}</td>
                        <td style={s.td}>
                          {hasCommission ? (
                            <>
                              <div>${lk.estimatedCommission.toFixed(2)}</div>
                              <div style={{ color: '#9ca3af', marginTop: 2 }}>
                                {commissionValueLabel(lk.commissionType, lk.commissionValue)} · {settlementLabel(lk.settlementStatus)}
                              </div>
                            </>
                          ) : '未设置'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ── 推广素材弹层 ────────────────────────────────────────────────── */}
      {materialLink && (() => {
        const matUrl = publicLink(`/v/${materialLink.code}`)
        const sections: { title: string; key: string; tpl: string }[] = [
          { title: 'TikTok 主页 Bio 文案',  key: 'bio',     tpl: matBio(materialLang) },
          { title: '视频置顶评论文案',       key: 'comment', tpl: matComment(matUrl, materialLang) },
          { title: '私信人工回复模板',       key: 'dm',      tpl: matDM(matUrl, materialLang) },
          { title: '博主拍摄脚本模板',       key: 'script',  tpl: matScript(matUrl, materialLang) },
        ]
        const qrHint =
          materialLang === 'en' ? 'Screenshot QR code and share with followers' :
          materialLang === 'km' ? 'ថតរូបខូដ QR ហើយចែករំលែកដល់អ្នកតាម' :
          '截图二维码，粉丝扫码直接进店下单'
        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 999, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
            onClick={(e) => { if (e.target === e.currentTarget) setMaterialLink(null) }}
          >
            <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', maxHeight: '88dvh', overflowY: 'auto' }}>
              {/* 标题栏 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>📱 推广素材 · /v/{materialLink.code}</div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {ML_LANGS.map((l) => (
                    <button key={l} style={matLangBtn(l === materialLang)} onClick={() => setMaterialLang(l)}>{ML_LABELS[l]}</button>
                  ))}
                  <button style={{ marginLeft: 8, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#9ca3af', lineHeight: 1, padding: 0 }} onClick={() => setMaterialLink(null)}>✕</button>
                </div>
              </div>

              <div style={{ padding: '16px' }}>
                {/* 推广短链 */}
                <div style={{ ...s.row, background: '#f3f4f6', borderRadius: 8, padding: '7px 10px', marginBottom: 12 }}>
                  <span style={{ flex: 1, fontSize: 12, color: '#374151', fontFamily: 'ui-monospace,monospace', overflow: 'hidden', whiteSpace: 'nowrap' as const, display: 'block' }}>{matUrl}</span>
                  <button style={s.btnCopy} onClick={() => copy(matUrl, 'm:url')}>{copied === 'm:url' ? '已复制 ✓' : '复制'}</button>
                </div>

                {/* 二维码 */}
                <div style={{ textAlign: 'center' as const, marginBottom: 16 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(matUrl)}`}
                    alt="QR Code"
                    width={160} height={160}
                    style={{ borderRadius: 8, border: '1px solid #e5e7eb' }}
                  />
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>{qrHint}</div>
                </div>

                {/* 四段文案 */}
                {sections.map(({ title, key, tpl }) => (
                  <div key={key} style={{ marginBottom: 16 }}>
                    <div style={{ ...s.row, justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{title}</div>
                      <button style={s.btnCopy} onClick={() => copy(tpl, `m:${key}`)}>{copied === `m:${key}` ? '已复制 ✓' : '复制'}</button>
                    </div>
                    <div style={s.tplBox}>{tpl}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── 5. 历史短链 ─────────────────────────────────────────────────── */}
      <div style={{ ...s.card, marginTop: 8 }}>
        <div style={s.cardHead}>
          <div>
            <div style={s.sectionTitle}>历史短链</div>
            <div style={s.sectionHint}>复制推广入口、查看效果，并处理落地页和结算状态。</div>
          </div>
        </div>
        {links.length === 0 ? (
          <div style={{ fontSize: 13, color: '#9ca3af' }}>暂无推广短链，生成第一条后会显示在这里</div>
        ) : (
          links.map((lk) => {
            const fullUrl   = publicLink(`/v/${lk.code}`)
            const isSettled = lk.settlementStatus === 'settled'
            const isSettling = settlingId === lk.id
            const landingPage = pageByTargetUrl(lk.targetUrl)
            const isEditingLanding = editingLandingId === lk.id
            const isMoreOpen = openMoreId === lk.id

            return (
              <div key={lk.id} style={s.linkCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' as const }}>
                  <div>
                    <div style={s.linkCode}>/v/{lk.code}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                      落地页：{landingDisplay(lk, landingPage)}
                    </div>
                    {lk.landingRisk && <div style={s.riskBox}>落地页异常，请重新选择营销页</div>}
                    {lk.creatorName && (
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        博主：{lk.creatorName}{lk.tiktokHandle ? ` (@${lk.tiktokHandle})` : ''}
                      </div>
                    )}
                    {lk.videoTitle && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>视频：{lk.videoTitle}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const }}>
                    <span style={badge(isSettled)}>{isSettled ? '已结算' : '未结算'}</span>
                    <button style={s.btnSm} onClick={() => copy(fullUrl, lk.code)}>
                      {copied === lk.code ? '已复制 ✓' : '复制链接'}
                    </button>
                    <button style={{ ...s.btnCopy, background: '#eff6ff', borderColor: '#bfdbfe', color: '#1d4ed8' }}
                      onClick={() => { setMaterialLink(lk); setMaterialLang('zh') }}>
                      素材
                    </button>
                    <button
                      style={{
                        ...s.btnGhost,
                        ...(isMoreOpen ? { background: '#111827', borderColor: '#111827', color: '#fff' } : {}),
                      }}
                      onClick={() => setOpenMoreId(isMoreOpen ? null : lk.id)}
                    >
                      {isMoreOpen ? '收起 ↑' : '更多 ↓'}
                    </button>
                  </div>
                </div>
                {isMoreOpen && (
                  <div style={s.moreWrap}>
                    <div style={s.moreMenu}>
                      <button style={s.moreItem} onClick={() => { copy(fullUrl, `tt-anchor:${lk.code}`); setOpenMoreId(null) }}>
                        复制 TikTok 锚点链接
                      </button>
                      <button style={s.moreItem} onClick={() => { copy(fullUrl, `bio:${lk.code}`); setOpenMoreId(null) }}>
                        复制 Bio 链接
                      </button>
                      <button style={s.moreItem} onClick={() => { copy(fullUrl, `tg:${lk.code}`); setOpenMoreId(null) }}>
                        复制 Telegram 链接
                      </button>
                      <button style={{ ...s.moreItem, ...(isSettled ? { borderBottom: 0 } : {}) }} onClick={() => { beginLandingEdit(lk); setOpenMoreId(null) }}>
                        修改落地页
                      </button>
                      {!isSettled && (
                        <button style={{ ...s.moreItem, borderBottom: 0 }} onClick={() => { setSettlingId(lk.id); setSettleNote(''); setOpenMoreId(null) }}>
                          标记已结算
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div style={s.linkStats}>
                  <div style={s.linkStatBox}><div style={s.linkStatLabel}>浏览</div><div style={s.linkStatValue}>{lk.viewCount}</div></div>
                  <div style={s.linkStatBox}><div style={s.linkStatLabel}>点击</div><div style={s.linkStatValue}>{lk.clickCount}</div></div>
                  <div style={s.linkStatBox}><div style={s.linkStatLabel}>订单</div><div style={s.linkStatValue}>{lk.attributedOrderCount}</div></div>
                  <div style={s.linkStatBox}><div style={s.linkStatLabel}>销售额</div><div style={s.linkStatValue}>${lk.attributedSalesAmount.toFixed(2)}</div></div>
                  <div style={s.linkStatBox}><div style={s.linkStatLabel}>佣金</div><div style={s.linkStatValue}>${lk.estimatedCommission.toFixed(2)}</div></div>
                </div>
                {isEditingLanding && (
                  <div style={{ background: '#f9fafb', borderRadius: 8, padding: 10, marginTop: 6 }}>
                    <div style={{ ...s.halfRow, marginBottom: 8 }}>
                      <div style={{ flex: 1 }}>
                        <label style={s.label}>落地页类型</label>
                        <select style={s.select} value={editLandingType} onChange={(e) => { setEditLandingType(e.target.value as 'menu' | 'product'); setEditMarketingPageId('') }}>
                          <option value="menu">菜单页</option>
                          <option value="product">营销页</option>
                        </select>
                      </div>
                      {editLandingType === 'product' && (
                        <div style={{ flex: 1 }}>
                          <label style={s.label}>营销页</label>
                          <select style={s.select} value={editMarketingPageId} onChange={(e) => setEditMarketingPageId(e.target.value)}>
                            <option value="">请选择</option>
                            {marketingPages.map((p) => (
                              <option key={p.id} value={p.id}>{p.title || p.slug}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    {landingError && <div style={s.error}>{landingError}</div>}
                    <div style={s.row}>
                      <button style={s.btnSm} onClick={() => saveLanding(lk.id)} disabled={landingSavingId === lk.id}>
                        {landingSavingId === lk.id ? '保存中…' : '保存落地页'}
                      </button>
                      <button style={s.btnGhost} onClick={() => setEditingLandingId(null)}>取消</button>
                    </div>
                  </div>
                )}
                <div style={{ ...s.stat, marginTop: 8 }}>
                  佣金规则：{commLabel(lk.commissionType, lk.commissionValue)}
                </div>
                {!isSettled && isSettling && (
                  <div style={{ marginTop: 6 }}>
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
      <div style={s.tips}>
        <div>TikTok 锚点链接用于 Spark Ads 或锚点授权。</div>
        <div>Bio 链接适合放主页。</div>
        <div>Telegram 链接适合发给博主或群推广。</div>
      </div>
    </div>
  )
}
