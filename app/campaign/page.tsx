'use client'

import { useEffect, useState, CSSProperties } from 'react'
import { apiFetch, OWNER_CTX } from '@/lib/api'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')

type CampaignLink = {
  id:             string
  code:           string
  sourcePlatform: string
  creatorName:    string | null
  videoTitle:     string | null
  targetUrl:      string
  viewCount:      number
  clickCount:     number
  attributedOrderCount:  number
  attributedSalesAmount: number
  createdAt:      string
}

const ZH_TEMPLATE = (shortUrl: string) =>
  `想看菜单/下单，点主页链接进入 E-Life。也可以评论"菜单"，我们发你店铺入口。\n🔗 ${shortUrl}`

const EN_TEMPLATE = (shortUrl: string) =>
  `Menu and order link are in bio. Comment "menu" and we'll send you the shop link.\n🔗 ${shortUrl}`

export default function CampaignPage() {
  const [links, setLinks]             = useState<CampaignLink[]>([])
  const [creatorName, setCreatorName] = useState('')
  const [videoTitle, setVideoTitle]   = useState('')
  const [creating, setCreating]       = useState(false)
  const [newLink, setNewLink]         = useState<(CampaignLink & { shortUrl: string }) | null>(null)
  const [copied, setCopied]           = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)

  async function loadLinks() {
    const r = await apiFetch('/api/campaign-links', undefined, OWNER_CTX)
    if (r.ok) {
      const d = await r.json()
      setLinks(d.links ?? [])
    }
  }

  useEffect(() => { loadLinks() }, [])

  async function handleCreate() {
    setCreating(true)
    setError(null)
    setNewLink(null)
    try {
      const r = await apiFetch(
        '/api/campaign-links',
        { method: 'POST', body: JSON.stringify({ creatorName: creatorName.trim(), videoTitle: videoTitle.trim() }) },
        OWNER_CTX,
      )
      const d = await r.json()
      if (r.ok) {
        setNewLink(d)
        setCreatorName('')
        setVideoTitle('')
        loadLinks()
      } else {
        setError(d.message ?? d.error ?? '创建失败')
      }
    } catch {
      setError('网络错误，请重试')
    } finally {
      setCreating(false)
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2200)
    })
  }

  const s: Record<string, CSSProperties> = {
    page:    { padding: '20px 16px 60px', maxWidth: 560, margin: '0 auto', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' },
    h1:      { fontSize: 20, fontWeight: 700, margin: '0 0 6px', color: '#111827' },
    desc:    { fontSize: 13, color: '#6b7280', margin: '0 0 20px', lineHeight: 1.6 },
    card:    { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '16px', marginBottom: 16 },
    label:   { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 },
    input:   { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' as const, outline: 'none' },
    btn:     { padding: '10px 20px', background: '#07c160', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 12 },
    btnCopy: { padding: '5px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0 },
    error:   { color: '#ef4444', fontSize: 13, marginTop: 8 },
    success: { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 16, marginTop: 16 },
    divider: { height: 1, background: '#e5e7eb', margin: '14px 0' },
    row:     { display: 'flex', alignItems: 'center', gap: 8 },
    stat:    { fontSize: 11, color: '#9ca3af', marginTop: 4 },
    empty:   { fontSize: 13, color: '#9ca3af', padding: '12px 0' },
    tplLabel:{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 },
    tplBox:  {
      background: '#f9fafb', borderRadius: 8, padding: '10px 12px',
      fontSize: 12, color: '#374151', whiteSpace: 'pre-wrap' as const,
      lineHeight: 1.6, wordBreak: 'break-word' as const,
      overflowWrap: 'break-word' as const,
      border: '1px solid #e5e7eb', marginBottom: 6,
    },
  }

  return (
    <div style={s.page}>
      <h1 style={s.h1}>📱 TikTok 推广短链</h1>
      <p style={s.desc}>
        给 TikTok 博主/达人生成专属推广短链，可放在主页、评论区或私信中，用于统计访问和点击效果。
      </p>

      {/* 创建表单 */}
      <div style={s.card}>
        <div style={{ marginBottom: 12 }}>
          <label style={s.label}>达人 / 博主名称（选填）</label>
          <input
            style={s.input}
            placeholder="如：@tiktok_creator"
            value={creatorName}
            onChange={(e) => setCreatorName(e.target.value)}
          />
        </div>
        <div>
          <label style={s.label}>视频标题备注（选填）</label>
          <input
            style={s.input}
            placeholder="如：5月新品推荐视频"
            value={videoTitle}
            onChange={(e) => setVideoTitle(e.target.value)}
          />
        </div>
        {error && <div style={s.error}>{error}</div>}
        <button style={s.btn} onClick={handleCreate} disabled={creating}>
          {creating ? '生成中…' : '生成短链'}
        </button>
      </div>

      {/* 新建结果 */}
      {newLink && (() => {
        const fullUrl = `${APP_URL}/v/${newLink.code}`
        return (
          <div style={s.success}>
            <div style={{ fontSize: 13, color: '#15803d', fontWeight: 600, marginBottom: 12 }}>
              ✅ 短链已生成
            </div>

            {/* 短码大字展示 */}
            <div style={{ fontSize: 24, fontWeight: 800, color: '#07c160', letterSpacing: '0.06em', marginBottom: 8 }}>
              /v/{newLink.code}
            </div>

            {/* 完整链接：横向滚动 + 复制 */}
            <div style={{ ...s.row, background: '#f3f4f6', borderRadius: 8, padding: '7px 10px', marginBottom: 14 }}>
              <span style={{
                flex: 1, fontSize: 12, color: '#6b7280',
                fontFamily: 'ui-monospace,monospace',
                overflowX: 'auto', whiteSpace: 'nowrap' as const,
                display: 'block',
              }}>
                {fullUrl}
              </span>
              <button style={s.btnCopy} onClick={() => copy(fullUrl, 'url')}>
                {copied === 'url' ? '已复制 ✓' : '复制链接'}
              </button>
            </div>

            <div style={s.divider} />

            {/* 中文文案 */}
            <div style={s.tplLabel}>置顶评论文案（中文）</div>
            <div style={s.tplBox}>{ZH_TEMPLATE(fullUrl)}</div>
            <div style={{ ...s.row, justifyContent: 'flex-end', marginBottom: 12 }}>
              <button style={s.btnCopy} onClick={() => copy(ZH_TEMPLATE(fullUrl), 'zh')}>
                {copied === 'zh' ? '已复制 ✓' : '复制中文文案'}
              </button>
            </div>

            {/* 英文文案 */}
            <div style={s.tplLabel}>置顶评论文案（英文）</div>
            <div style={s.tplBox}>{EN_TEMPLATE(fullUrl)}</div>
            <div style={{ ...s.row, justifyContent: 'flex-end' }}>
              <button style={s.btnCopy} onClick={() => copy(EN_TEMPLATE(fullUrl), 'en')}>
                {copied === 'en' ? '已复制 ✓' : '复制英文文案'}
              </button>
            </div>
          </div>
        )
      })()}

      {/* 历史列表 */}
      <div style={{ ...s.card, marginTop: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 12 }}>历史短链</div>
        {links.length === 0 ? (
          <div style={s.empty}>暂无推广短链，生成第一条后会显示在这里</div>
        ) : (
          links.map((lk, i) => (
            <div
              key={lk.id}
              style={{
                borderBottom: i < links.length - 1 ? '1px solid #f0f0f0' : 'none',
                paddingBottom: i < links.length - 1 ? 12 : 0,
                marginBottom: i < links.length - 1 ? 12 : 0,
              }}
            >
              {/* 码 + 复制 */}
              <div style={{ ...s.row, justifyContent: 'space-between' }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#07c160', letterSpacing: '0.04em' }}>
                  /v/{lk.code}
                </span>
                <button
                  style={s.btnCopy}
                  onClick={() => copy(`${APP_URL}/v/${lk.code}`, lk.code)}
                >
                  {copied === lk.code ? '已复制 ✓' : '复制链接'}
                </button>
              </div>

              {/* 达人 + 视频备注 */}
              {lk.creatorName && (
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
                  👤 @{lk.creatorName}
                </div>
              )}
              {lk.videoTitle && (
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                  🎬 {lk.videoTitle}
                </div>
              )}

              {/* 统计 */}
              <div style={s.stat}>
                👁 {lk.viewCount} 次浏览　🛒 {lk.clickCount} 次点击
              </div>
              <div style={{ ...s.stat, marginTop: 2, color: lk.attributedOrderCount > 0 ? '#07c160' : '#d1d5db' }}>
                📦 {lk.attributedOrderCount} 单成交
                {lk.attributedOrderCount > 0 && `　💰 $${lk.attributedSalesAmount.toFixed(2)}`}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
