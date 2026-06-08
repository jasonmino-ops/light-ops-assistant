'use client'

import { CSSProperties, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type PageData = {
  slug: string
  title: string
  subtitle: string | null
  heroImageUrl: string | null
  salePrice: number | null
  originalPrice: number | null
  soldCount: number | null
  features: string[]
  enableCountdown: boolean
  detailImages: string[]
  reviewImages: string[]
  buttonText: string
  store: { code: string; name: string }
  product: { id: string; name: string; spec: string | null; price: number; imageUrl: string | null }
}

type OrderResult = { orderNo: string; totalAmount: number }

type Lang = 'zh' | 'en' | 'km'

const LS_KEY = 'marketing_product_lang'
const LANGS: Lang[] = ['km', 'en', 'zh']
const LANG_LABELS: Record<Lang, string> = { km: 'KM', en: 'EN', zh: '中文' }

const I18N: Record<Lang, {
  loading: string
  notFoundTitle: string
  notFoundSub: string
  flashBar: string
  cod: string
  freeDelivery: string
  localDelivery: string
  limitedOffer: string
  priorityDelivery: string
  sold: string
  afterSale: string
  whyTitle: string
  defaultFeatures: string[]
  detailTitle: string
  reviewTitle: string
  orderTitle: string
  name: string
  namePlaceholder: string
  phone: string
  phonePlaceholder: string
  address: string
  addressPlaceholder: string
  note: string
  notePlaceholder: string
  quantity: string
  total: string
  submitOrder: string
  submitting: string
  successTitle: string
  successText: string
  orderNo: string
  errorName: string
  errorPhone: string
  errorAddress: string
  errorSubmit: string
  errorNetwork: string
}> = {
  km: {
    loading: 'កំពុងផ្ទុក...',
    notFoundTitle: 'ទំព័រផលិតផលមិនមាន ឬត្រូវបានដកចេញ',
    notFoundSub: 'សូមទាក់ទងហាង ដើម្បីទទួលបានតំណថ្មី',
    flashBar: 'លក់ដាច់លើ TikTok · បង់ប្រាក់ពេលទទួលទំនិញ COD',
    cod: 'បង់ប្រាក់ពេលទទួលទំនិញ COD',
    freeDelivery: 'ដឹកជញ្ជូនឥតគិតថ្លៃ',
    localDelivery: 'ដឹកជញ្ជូនក្នុងតំបន់',
    limitedOffer: 'ប្រូម៉ូសិនមានកំណត់',
    priorityDelivery: 'បញ្ជាទិញថ្ងៃនេះ ដឹកជញ្ជូនអាទិភាព',
    sold: 'លក់បាន',
    afterSale: 'ធានាសេវាក្រោយលក់',
    whyTitle: 'ហេតុអ្វីជ្រើសរើសផលិតផលនេះ',
    defaultFeatures: [
      'ផលិតផលជ្រើសរើសដោយហាង គុណភាពបានត្រួតពិនិត្យ',
      'បន្ទាប់ពីបញ្ជាទិញ ហាងនឹងទទួលបានដំណឹងភ្លាមៗតាម Telegram',
      'គាំទ្រការបញ្ជាក់ព័ត៌មានដឹកជញ្ជូនតាមទូរស័ព្ទ',
    ],
    detailTitle: 'ព័ត៌មានលម្អិតផលិតផល',
    reviewTitle: 'ការវាយតម្លៃអតិថិជន',
    orderTitle: 'បំពេញការបញ្ជាទិញ',
    name: 'ឈ្មោះ',
    namePlaceholder: 'ឈ្មោះអ្នកទទួល',
    phone: 'លេខទូរស័ព្ទ',
    phonePlaceholder: 'លេខទំនាក់ទំនង',
    address: 'អាសយដ្ឋាន',
    addressPlaceholder: 'អាសយដ្ឋានដឹកជញ្ជូន',
    note: 'ចំណាំ',
    notePlaceholder: 'ពណ៌ ពេលវេលា ឬតម្រូវការផ្សេងៗ (បើមាន)',
    quantity: 'ចំនួន',
    total: 'សរុប',
    submitOrder: 'បញ្ជាទិញឥឡូវ',
    submitting: 'កំពុងផ្ញើ...',
    successTitle: 'បញ្ជាទិញបានជោគជ័យ',
    successText: 'ហាងបានទទួលការបញ្ជាទិញរបស់អ្នក ហើយនឹងទាក់ទងដើម្បីបញ្ជាក់ការដឹកជញ្ជូន។',
    orderNo: 'លេខបញ្ជាទិញ',
    errorName: 'សូមបំពេញឈ្មោះ',
    errorPhone: 'សូមបំពេញលេខទូរស័ព្ទ',
    errorAddress: 'សូមបំពេញអាសយដ្ឋានដឹកជញ្ជូន',
    errorSubmit: 'ផ្ញើមិនបាន សូមព្យាយាមម្តងទៀត',
    errorNetwork: 'បញ្ហាបណ្តាញ សូមព្យាយាមម្តងទៀត',
  },
  en: {
    loading: 'Loading...',
    notFoundTitle: 'Product page not found or unavailable',
    notFoundSub: 'Please contact the shop for the latest link',
    flashBar: 'TikTok hot sale · Cash on Delivery',
    cod: 'Cash on Delivery',
    freeDelivery: 'Free delivery',
    localDelivery: 'Local delivery',
    limitedOffer: 'Limited offer',
    priorityDelivery: 'Order today for priority delivery',
    sold: 'Sold',
    afterSale: 'After-sales support',
    whyTitle: 'Why choose this product',
    defaultFeatures: [
      'Selected shop product with merchant-checked quality',
      'The shop receives your order instantly via Telegram',
      'Phone confirmation for delivery details is supported',
    ],
    detailTitle: 'Product Details',
    reviewTitle: 'Customer Reviews',
    orderTitle: 'Place Your Order',
    name: 'Name',
    namePlaceholder: 'Recipient name',
    phone: 'Phone',
    phonePlaceholder: 'Contact phone',
    address: 'Address',
    addressPlaceholder: 'Delivery address',
    note: 'Note',
    notePlaceholder: 'Color, time, or other requests (optional)',
    quantity: 'Quantity',
    total: 'Total',
    submitOrder: 'Submit Order',
    submitting: 'Submitting...',
    successTitle: 'Order submitted',
    successText: 'The shop has received your order and will contact you to confirm delivery.',
    orderNo: 'Order No.',
    errorName: 'Please enter your name',
    errorPhone: 'Please enter your phone number',
    errorAddress: 'Please enter your delivery address',
    errorSubmit: 'Failed to submit. Please try again',
    errorNetwork: 'Network error. Please try again',
  },
  zh: {
    loading: '加载中...',
    notFoundTitle: '商品页不存在或已下架',
    notFoundSub: '请联系商家获取最新链接',
    flashBar: 'TikTok 热卖 · 货到付款 COD',
    cod: '货到付款 COD',
    freeDelivery: '免费配送',
    localDelivery: '本地配送',
    limitedOffer: '限时优惠',
    priorityDelivery: '今日下单优先配送',
    sold: '已售',
    afterSale: '售后保障',
    whyTitle: '为什么选择这款',
    defaultFeatures: [
      '精选门店商品，质量由商家把关',
      '提交后商家 Telegram 实时接单',
      '支持电话确认配送信息',
    ],
    detailTitle: '商品详情',
    reviewTitle: '客户评价',
    orderTitle: '填写订单',
    name: '姓名',
    namePlaceholder: '收货人姓名',
    phone: '电话',
    phonePlaceholder: '联系电话',
    address: '地址',
    addressPlaceholder: '收货地址',
    note: '备注',
    notePlaceholder: '颜色、时间、其他要求（可选）',
    quantity: '数量',
    total: '合计',
    submitOrder: '提交订单',
    submitting: '提交中...',
    successTitle: '下单成功',
    successText: '商家已收到订单，将尽快联系你确认配送。',
    orderNo: '订单号',
    errorName: '请填写姓名',
    errorPhone: '请填写电话',
    errorAddress: '请填写收货地址',
    errorSubmit: '提交失败，请重试',
    errorNetwork: '网络错误，请重试',
  },
}

function detectLang(): Lang {
  const params = new URLSearchParams(window.location.search)
  const fromUrl = params.get('lang')
  if (fromUrl && LANGS.includes(fromUrl as Lang)) return fromUrl as Lang
  try {
    const saved = localStorage.getItem(LS_KEY)
    if (saved && LANGS.includes(saved as Lang)) return saved as Lang
  } catch { /* ignore */ }
  return 'km'
}

export default function MarketingProductPage() {
  const { slug } = useParams<{ slug: string }>()
  const [lang, setLang] = useState<Lang>('km')
  const [data, setData] = useState<PageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [qty, setQty] = useState(1)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<OrderResult | null>(null)
  const text = I18N[lang]

  useEffect(() => {
    setLang(detectLang())
  }, [])

  useEffect(() => {
    fetch(`/api/public/product-pages/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (res.status === 404) { setNotFound(true); return null }
        const body = await res.json()
        if (!res.ok || body.error) { setNotFound(true); return null }
        return body as PageData
      })
      .then((body) => {
        if (body) {
          setData(body)
          document.title = `${body.title} - ${body.store.name}`
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [slug])

  async function submitOrder() {
    if (!data || submitting) return
    if (!name.trim()) { setError(text.errorName); return }
    if (!phone.trim()) { setError(text.errorPhone); return }
    if (!address.trim()) { setError(text.errorAddress); return }
    setSubmitting(true)
    setError('')

    let customerTelegramId: string | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    if (tg?.initData) {
      try {
        const userStr = new URLSearchParams(tg.initData).get('user')
        if (userStr) customerTelegramId = String(JSON.parse(userStr).id)
      } catch { /* keep anonymous */ }
    }

    try {
      const searchParams = new URLSearchParams(window.location.search)
      const campaignCode = searchParams.get('ref')?.trim()
      const campaignIntent = searchParams.get('intent')?.trim() || 'PRODUCT_PAGE'
      const res = await fetch('/api/public/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeCode: data.store.code,
          items: [{ productId: data.product.id, quantity: qty }],
          ...(customerTelegramId ? { customerTelegramId } : {}),
          pickupMethod: 'delivery',
          customerName: name.trim(),
          customerPhone: phone.trim(),
          deliveryAddress: address.trim(),
          deliveryNote: note.trim() || undefined,
          remark: note.trim() ? `营销商品页备注：${note.trim()}` : '营销商品页',
          ...(campaignCode ? { campaignCode } : {}),
          campaignIntent,
          lang,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.message ?? body.error ?? text.errorSubmit)
        return
      }
      setResult({ orderNo: body.orderNo, totalAmount: Number(body.totalAmount ?? total) })
    } catch {
      setError(text.errorNetwork)
    } finally {
      setSubmitting(false)
    }
  }

  function switchLang(nextLang: Lang) {
    setLang(nextLang)
    try { localStorage.setItem(LS_KEY, nextLang) } catch { /* ignore */ }
  }

  const langSwitcher = (
    <div style={s.langSwitcher}>
      {LANGS.map((l) => (
        <button
          key={l}
          style={{
            ...s.langBtn,
            ...(lang === l ? s.langBtnActive : {}),
          }}
          onClick={() => switchLang(l)}
        >
          {LANG_LABELS[l]}
        </button>
      ))}
    </div>
  )

  if (loading) return <div style={s.center}>{text.loading}</div>
  if (notFound || !data) {
    return (
      <div style={s.center}>
        {langSwitcher}
        <div style={s.emptyTitle}>{text.notFoundTitle}</div>
        <div style={s.emptySub}>{text.notFoundSub}</div>
      </div>
    )
  }

  const imageUrl = data.heroImageUrl || data.product.imageUrl
  const displayPrice = data.salePrice ?? data.product.price
  const total = +(displayPrice * qty).toFixed(2)
  const features = data.features.length > 0 ? data.features : text.defaultFeatures

  if (result) {
    return (
      <main style={s.page}>
        {langSwitcher}
        <section style={s.successBox}>
          <div style={s.successIcon}>✓</div>
          <h1 style={s.successTitle}>{text.successTitle}</h1>
          <p style={s.successText}>{text.successText}</p>
          <div style={s.orderNo}>{text.orderNo}：{result.orderNo}</div>
          <div style={s.successTotal}>{text.total}：${result.totalAmount.toFixed(2)}</div>
        </section>
      </main>
    )
  }

  return (
    <main style={s.page}>
      {langSwitcher}
      <section style={s.hero}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={data.title} style={s.heroImg} />
        ) : (
          <div style={s.heroPlaceholder}>店小二</div>
        )}
        <div style={s.heroBody}>
          <div style={s.storeName}>{data.store.name}</div>
          <div style={s.flashBar}>{text.flashBar}</div>
          <h1 style={s.title}>{data.title}</h1>
          {data.subtitle && <p style={s.subtitle}>{data.subtitle}</p>}
          <div style={s.priceRow}>
            <span style={s.price}>${displayPrice.toFixed(2)}</span>
            {data.originalPrice != null && <span style={s.originalPrice}>${data.originalPrice.toFixed(2)}</span>}
          </div>
          <div style={s.metaRow}>
            <span>{text.cod}</span>
            <span>{text.freeDelivery}</span>
            {data.soldCount != null && <span>{text.sold} {data.soldCount}</span>}
          </div>
          {data.enableCountdown && <div style={s.countdown}>{text.limitedOffer} · {text.priorityDelivery}</div>}
          {data.product.spec && <div style={s.spec}>{data.product.spec}</div>}
          <div style={s.badges}>
            <span style={s.badge}>{text.cod}</span>
            <span style={s.badge}>{text.freeDelivery}</span>
            <span style={s.badge}>{text.afterSale}</span>
          </div>
        </div>
      </section>

      <section style={s.section}>
        <h2 style={s.sectionTitle}>{text.whyTitle}</h2>
        <div style={s.points}>
          {features.map((feature, idx) => <div key={idx} style={s.point}>{feature}</div>)}
        </div>
      </section>

      {data.detailImages.length > 0 && (
        <section style={s.section}>
          <h2 style={s.sectionTitle}>{text.detailTitle}</h2>
          <div style={s.imageStack}>
            {data.detailImages.map((url, idx) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={idx} src={url} alt={`${text.detailTitle} ${idx + 1}`} style={s.detailImg} />
            ))}
          </div>
        </section>
      )}

      {data.reviewImages.length > 0 && (
        <section style={s.section}>
          <h2 style={s.sectionTitle}>{text.reviewTitle}</h2>
          <div style={s.reviewGrid}>
            {data.reviewImages.map((url, idx) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={idx} src={url} alt={`${text.reviewTitle} ${idx + 1}`} style={s.reviewImg} />
            ))}
          </div>
        </section>
      )}

      <section style={s.section}>
        <h2 style={s.sectionTitle}>{text.orderTitle}</h2>
        <label style={s.label}>{text.name}</label>
        <input style={s.input} value={name} onChange={(e) => setName(e.target.value)} placeholder={text.namePlaceholder} />
        <label style={s.label}>{text.phone}</label>
        <input style={s.input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={text.phonePlaceholder} inputMode="tel" />
        <label style={s.label}>{text.address}</label>
        <textarea style={s.textarea} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={text.addressPlaceholder} />
        <label style={s.label}>{text.note}</label>
        <input style={s.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder={text.notePlaceholder} />
        <label style={s.label}>{text.quantity}</label>
        <div style={s.qtyRow}>
          <button style={s.qtyBtn} onClick={() => setQty((v) => Math.max(1, v - 1))}>-</button>
          <span style={s.qtyNum}>{qty}</span>
          <button style={s.qtyBtn} onClick={() => setQty((v) => Math.min(99, v + 1))}>+</button>
          <span style={s.total}>{text.total} ${total.toFixed(2)}</span>
        </div>
        {error && <div style={s.error}>{error}</div>}
        <button style={{ ...s.submit, opacity: submitting ? 0.6 : 1 }} disabled={submitting} onClick={submitOrder}>
          {submitting ? text.submitting : (data.buttonText || text.submitOrder)}
        </button>
      </section>
    </main>
  )
}

const s: Record<string, CSSProperties> = {
  page: {
    minHeight: '100dvh',
    background: '#f5f7f4',
    color: '#172018',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    paddingBottom: 28,
  },
  langSwitcher: {
    position: 'fixed' as const,
    top: 10,
    right: 10,
    zIndex: 20,
    display: 'flex',
    gap: 4,
    background: 'rgba(255,255,255,0.88)',
    border: '1px solid #e3e8df',
    borderRadius: 16,
    padding: 3,
    boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
  },
  langBtn: {
    border: 0,
    borderRadius: 12,
    background: 'transparent',
    color: '#667085',
    fontSize: 11,
    fontWeight: 800,
    padding: '4px 8px',
    cursor: 'pointer',
  },
  langBtnActive: {
    background: '#1f7a33',
    color: '#fff',
  },
  center: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f5f7f4',
    color: '#667085',
    fontSize: 14,
    padding: 24,
  },
  emptyTitle: { fontSize: 20, fontWeight: 700, color: '#172018', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#667085' },
  hero: { background: '#fff', borderBottom: '1px solid #e3e8df' },
  heroImg: { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block' },
  heroPlaceholder: {
    width: '100%',
    aspectRatio: '1 / 1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#dfe8dc',
    color: '#4d694b',
    fontSize: 28,
    fontWeight: 800,
  },
  heroBody: { padding: '18px 18px 20px' },
  storeName: { fontSize: 13, color: '#667085', marginBottom: 8 },
  flashBar: {
    display: 'inline-flex',
    background: '#111827',
    color: '#fff',
    borderRadius: 6,
    padding: '5px 9px',
    fontSize: 12,
    fontWeight: 800,
    marginBottom: 10,
  },
  title: { margin: 0, fontSize: 26, lineHeight: 1.16, letterSpacing: 0, color: '#172018' },
  subtitle: { margin: '10px 0 0', fontSize: 15, lineHeight: 1.5, color: '#4b5d4c' },
  priceRow: { display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 14 },
  price: { fontSize: 34, fontWeight: 900, color: '#e04f1a' },
  originalPrice: { fontSize: 16, color: '#98a2b3', textDecoration: 'line-through', fontWeight: 700 },
  metaRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, fontSize: 12, color: '#667085', fontWeight: 700 },
  countdown: { marginTop: 10, background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', borderRadius: 6, padding: '8px 10px', fontSize: 13, fontWeight: 800 },
  spec: { marginTop: 4, fontSize: 13, color: '#667085' },
  badges: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 },
  badge: {
    background: '#eef7ea',
    color: '#2d6a2d',
    border: '1px solid #cfe4c9',
    borderRadius: 6,
    padding: '6px 8px',
    fontSize: 12,
    fontWeight: 700,
  },
  section: { background: '#fff', marginTop: 10, padding: 18, borderTop: '1px solid #e3e8df', borderBottom: '1px solid #e3e8df' },
  sectionTitle: { margin: '0 0 12px', fontSize: 18, lineHeight: 1.25, letterSpacing: 0 },
  points: { display: 'grid', gap: 8 },
  point: { background: '#f7faf5', border: '1px solid #e3e8df', borderRadius: 6, padding: 12, fontSize: 14, color: '#344236' },
  imageStack: { display: 'grid', gap: 10 },
  detailImg: { width: '100%', borderRadius: 8, display: 'block', objectFit: 'cover' },
  reviewGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 },
  reviewImg: { width: '100%', aspectRatio: '1 / 1', borderRadius: 8, objectFit: 'cover', display: 'block' },
  label: { display: 'block', fontSize: 13, fontWeight: 700, color: '#344236', margin: '12px 0 6px' },
  input: { width: '100%', boxSizing: 'border-box', height: 46, border: '1px solid #d5ddd1', borderRadius: 6, padding: '0 12px', fontSize: 15, background: '#fff' },
  textarea: { width: '100%', boxSizing: 'border-box', minHeight: 82, border: '1px solid #d5ddd1', borderRadius: 6, padding: 12, fontSize: 15, background: '#fff', resize: 'vertical' },
  qtyRow: { display: 'flex', alignItems: 'center', gap: 10 },
  qtyBtn: { width: 40, height: 40, borderRadius: 6, border: '1px solid #c8d4c3', background: '#f7faf5', fontSize: 20, cursor: 'pointer' },
  qtyNum: { minWidth: 32, textAlign: 'center', fontSize: 18, fontWeight: 800 },
  total: { marginLeft: 'auto', fontSize: 16, fontWeight: 800, color: '#e04f1a' },
  error: { marginTop: 12, background: '#fff1f0', color: '#c2410c', border: '1px solid #fed7aa', borderRadius: 6, padding: 10, fontSize: 13 },
  submit: { marginTop: 14, width: '100%', height: 50, border: 0, borderRadius: 6, background: '#1f7a33', color: '#fff', fontSize: 17, fontWeight: 800, cursor: 'pointer' },
  successBox: { margin: 18, background: '#fff', borderRadius: 8, padding: 24, textAlign: 'center', border: '1px solid #e3e8df' },
  successIcon: { width: 58, height: 58, borderRadius: '50%', background: '#1f7a33', color: '#fff', display: 'grid', placeItems: 'center', margin: '0 auto 14px', fontSize: 32, fontWeight: 800 },
  successTitle: { margin: 0, fontSize: 24, letterSpacing: 0 },
  successText: { color: '#667085', lineHeight: 1.5, fontSize: 14 },
  orderNo: { marginTop: 14, fontSize: 14, fontWeight: 700 },
  successTotal: { marginTop: 8, fontSize: 18, fontWeight: 800, color: '#e04f1a' },
}
