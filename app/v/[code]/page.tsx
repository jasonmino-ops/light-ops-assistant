'use client'

import { useEffect, useState, CSSProperties } from 'react'
import { useParams } from 'next/navigation'

const BOT = (process.env.NEXT_PUBLIC_CUSTOMER_BOT_USERNAME ?? '').replace(/^@/, '').trim()
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')

type LinkData = {
  storeCode:    string
  storeName:    string
  bannerUrl:    string | null
  announcement: string | null
  targetUrl:    string
  creatorName:  string | null
  videoTitle:   string | null
}

export default function CampaignLandingPage() {
  const { code } = useParams<{ code: string }>()
  const [data, setData]       = useState<LinkData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [clicked, setClicked]   = useState(false)

  useEffect(() => {
    fetch(`/api/v/${code}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null }
        return r.json()
      })
      .then((d) => { if (d) setData(d) })
      .catch(() => setNotFound(true))
  }, [code])

  async function handleOrder() {
    if (!clicked) {
      setClicked(true)
      fetch(`/api/v/${code}/click`, { method: 'POST' }).catch(() => {})
    }
    if (data?.targetUrl) window.location.href = data.targetUrl
  }

  function handleTelegram() {
    const url = BOT
      ? `https://t.me/${BOT}?start=${data?.storeCode ?? ''}`
      : 'https://t.me/'
    window.open(url, '_blank')
  }

  const s: Record<string, CSSProperties> = {
    wrap: {
      minHeight: '100dvh',
      background: '#f9fafb',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '32px 20px 48px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    card: {
      background: '#fff',
      borderRadius: 16,
      width: '100%',
      maxWidth: 420,
      boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      overflow: 'hidden',
    },
    banner: {
      width: '100%',
      height: 160,
      objectFit: 'cover' as const,
    },
    bannerPlaceholder: {
      width: '100%',
      height: 160,
      background: 'linear-gradient(135deg,#07c160,#00b4d8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 40,
    },
    body: {
      padding: '24px 20px 28px',
    },
    storeName: {
      fontSize: 22,
      fontWeight: 700,
      color: '#111827',
      margin: '0 0 8px',
    },
    subline: {
      fontSize: 13,
      color: '#6b7280',
      margin: '0 0 4px',
    },
    announcement: {
      fontSize: 13,
      color: '#374151',
      background: '#f3f4f6',
      borderRadius: 8,
      padding: '8px 12px',
      margin: '12px 0 0',
    },
    divider: {
      height: 1,
      background: '#f0f0f0',
      margin: '20px 0',
    },
    btnPrimary: {
      display: 'block',
      width: '100%',
      padding: '14px',
      background: 'var(--blue, #07c160)',
      color: '#fff',
      border: 'none',
      borderRadius: 10,
      fontSize: 16,
      fontWeight: 600,
      cursor: 'pointer',
      marginBottom: 10,
    },
    btnSecondary: {
      display: 'block',
      width: '100%',
      padding: '13px',
      background: '#fff',
      color: '#07c160',
      border: '1.5px solid #07c160',
      borderRadius: 10,
      fontSize: 15,
      fontWeight: 600,
      cursor: 'pointer',
      marginBottom: 10,
    },
    btnTelegram: {
      display: 'block',
      width: '100%',
      padding: '13px',
      background: '#fff',
      color: '#229ed9',
      border: '1.5px solid #229ed9',
      borderRadius: 10,
      fontSize: 15,
      fontWeight: 600,
      cursor: 'pointer',
    },
    errorWrap: {
      marginTop: 80,
      textAlign: 'center' as const,
      color: '#9ca3af',
    },
    loader: {
      marginTop: 80,
      textAlign: 'center' as const,
      color: '#9ca3af',
      fontSize: 14,
    },
    poweredBy: {
      marginTop: 28,
      fontSize: 11,
      color: '#d1d5db',
      textAlign: 'center' as const,
    },
  }

  if (notFound) {
    return (
      <div style={s.wrap}>
        <div style={s.errorWrap}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
            链接不存在或已失效
          </div>
          <div style={{ fontSize: 13 }}>请联系商家获取最新下单入口</div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div style={s.wrap}>
        <div style={s.loader}>加载中…</div>
      </div>
    )
  }

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        {data.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.bannerUrl} alt="门店头图" style={s.banner} />
        ) : (
          <div style={s.bannerPlaceholder}>🛍️</div>
        )}

        <div style={s.body}>
          <h1 style={s.storeName}>{data.storeName}</h1>

          {data.creatorName && (
            <p style={s.subline}>来自 @{data.creatorName} 的视频推荐</p>
          )}
          {data.videoTitle && (
            <p style={s.subline}>「{data.videoTitle}」</p>
          )}
          {data.announcement && (
            <div style={s.announcement}>{data.announcement}</div>
          )}

          <div style={s.divider} />

          <button style={s.btnPrimary} onClick={handleOrder}>
            立即下单
          </button>
          <button style={s.btnSecondary} onClick={handleOrder}>
            查看菜单
          </button>
          <button style={s.btnTelegram} onClick={handleTelegram}>
            📱 打开 Telegram
          </button>
        </div>
      </div>

      <div style={s.poweredBy}>由店小二 · E-Life 驱动</div>
    </div>
  )
}
