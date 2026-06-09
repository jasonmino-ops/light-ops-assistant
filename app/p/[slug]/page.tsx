'use client'

import { CSSProperties, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'

const CUSTOMER_BOT = (process.env.NEXT_PUBLIC_CUSTOMER_BOT_USERNAME ?? '').replace(/^@/, '').trim()
const TIKTOK_PIXEL_ID = (
  process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID ??
  process.env.TIKTOK_PIXEL_ID ??
  ''
).trim()
const TRACKING_PARAM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'creator', 'campaignId'] as const

type PageData = {
  slug: string
  customerBound: boolean
  templateType: TemplateType | null
  title: string
  titleZh: string | null
  titleEn: string | null
  titleKm: string | null
  subtitle: string | null
  heroImageUrl: string | null
  salePrice: number | null
  originalPrice: number | null
  soldCount: number | null
  features: Array<string | null>
  featuresZh: Array<string | null>
  featuresEn: Array<string | null>
  featuresKm: Array<string | null>
  enableCountdown: boolean
  detailImages: string[]
  reviewImages: string[]
  buttonText: string
  buttonTextZh: string | null
  buttonTextEn: string | null
  buttonTextKm: string | null
  store: { code: string; name: string }
  product: { id: string; name: string; spec: string | null; price: number; imageUrl: string | null }
}

type OrderResult = { orderNo: string; totalAmount: number; telegramLinked: boolean }

type Lang = 'zh' | 'en' | 'km'
type TemplateType = 'TIKTOK_HOT' | 'HOME_GOODS' | 'FOOD_SET' | 'BEAUTY'
type TemplateSection = 'price' | 'features' | 'details' | 'reviews' | 'trust' | 'order'
type TrackingParamKey = typeof TRACKING_PARAM_KEYS[number]
type TrackingParams = Partial<Record<TrackingParamKey, string>>
type OrderField = 'name' | 'phone' | 'address'

type TemplateTheme = {
  background: string
  text: string
  muted: string
  accent: string
  accentDark: string
  heroBg: string
  flashBg: string
  flashText: string
  badgeBg: string
  badgeText: string
  badgeBorder: string
  pointBg: string
  pointBorder: string
  sectionBorder: string
  countdownBg: string
  countdownText: string
  countdownBorder: string
  heroVariant: 'bold' | 'scene' | 'menu' | 'soft'
  priceVariant: 'deal' | 'clean' | 'ticket' | 'premium'
  featureVariant: 'cards' | 'checklist' | 'menu' | 'soft'
  imageVariant: 'stack' | 'scene' | 'grid' | 'polished'
  sectionOrder: TemplateSection[]
}

const LS_KEY = 'marketing_product_lang'
const LANGS: Lang[] = ['km', 'en', 'zh']
const LANG_LABELS: Record<Lang, string> = { km: 'KM', en: 'EN', zh: '中文' }

const TEMPLATE_THEMES: Record<TemplateType, TemplateTheme> = {
  TIKTOK_HOT: {
    background: '#fff5f5',
    text: '#171717',
    muted: '#6b7280',
    accent: '#e11d48',
    accentDark: '#111827',
    heroBg: '#ffffff',
    flashBg: '#111827',
    flashText: '#ffffff',
    badgeBg: '#fff1f2',
    badgeText: '#be123c',
    badgeBorder: '#fecdd3',
    pointBg: '#fff7f7',
    pointBorder: '#fecdd3',
    sectionBorder: '#fecdd3',
    countdownBg: '#fff1f2',
    countdownText: '#be123c',
    countdownBorder: '#fecdd3',
    heroVariant: 'bold',
    priceVariant: 'deal',
    featureVariant: 'cards',
    imageVariant: 'stack',
    sectionOrder: ['price', 'features', 'reviews', 'details', 'order'],
  },
  HOME_GOODS: {
    background: '#f3f8f2',
    text: '#172018',
    muted: '#5f7162',
    accent: '#23834a',
    accentDark: '#14532d',
    heroBg: '#ffffff',
    flashBg: '#e8f5e9',
    flashText: '#14532d',
    badgeBg: '#eef7ea',
    badgeText: '#2d6a2d',
    badgeBorder: '#cfe4c9',
    pointBg: '#f7faf5',
    pointBorder: '#d7e7d2',
    sectionBorder: '#d7e7d2',
    countdownBg: '#ecfdf3',
    countdownText: '#166534',
    countdownBorder: '#bbf7d0',
    heroVariant: 'scene',
    priceVariant: 'clean',
    featureVariant: 'checklist',
    imageVariant: 'scene',
    sectionOrder: ['features', 'details', 'trust', 'reviews', 'price', 'order'],
  },
  FOOD_SET: {
    background: '#fff7ed',
    text: '#24150b',
    muted: '#7c5a37',
    accent: '#f97316',
    accentDark: '#9a3412',
    heroBg: '#fffaf2',
    flashBg: '#ffedd5',
    flashText: '#9a3412',
    badgeBg: '#fff7ed',
    badgeText: '#c2410c',
    badgeBorder: '#fed7aa',
    pointBg: '#fffaf2',
    pointBorder: '#fed7aa',
    sectionBorder: '#fed7aa',
    countdownBg: '#ffedd5',
    countdownText: '#c2410c',
    countdownBorder: '#fdba74',
    heroVariant: 'menu',
    priceVariant: 'ticket',
    featureVariant: 'menu',
    imageVariant: 'grid',
    sectionOrder: ['features', 'trust', 'price', 'order', 'reviews', 'details'],
  },
  BEAUTY: {
    background: '#faf5ff',
    text: '#25113a',
    muted: '#6b5a7a',
    accent: '#a855f7',
    accentDark: '#6b21a8',
    heroBg: '#ffffff',
    flashBg: '#f3e8ff',
    flashText: '#6b21a8',
    badgeBg: '#f5edff',
    badgeText: '#7e22ce',
    badgeBorder: '#e9d5ff',
    pointBg: '#fcf8ff',
    pointBorder: '#e9d5ff',
    sectionBorder: '#e9d5ff',
    countdownBg: '#fdf4ff',
    countdownText: '#a21caf',
    countdownBorder: '#f5d0fe',
    heroVariant: 'soft',
    priceVariant: 'premium',
    featureVariant: 'soft',
    imageVariant: 'polished',
    sectionOrder: ['features', 'reviews', 'trust', 'details', 'price', 'order'],
  },
}

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
  giftTitle: string
  claimTitle: string
  claimText: string
  claimBenefits: string[]
  claimButton: string
  laterButton: string
  savedCouponTitle: string
  viewCoupons: string
  backToProduct: string
  continueBrowsing: string
  contactSeller: string
  couponLaterMessage: string
  claimFallback: string
  copyOrderNo: string
  copied: string
  useLocation: string
  locating: string
  locationSuccess: string
  locationFail: string
  locationUnsupported: string
  locationAddress: (lat: string, lng: string) => string
  locationPreviewTitle: string
  latLabel: string
  lngLabel: string
  openMap: string
  addressDetailHint: string
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
    successTitle: '✅ បញ្ជាទិញបានដាក់ស្នើ',
    successText: 'ហាងនឹងទាក់ទងអ្នកឱ្យបានឆាប់បំផុត។',
    orderNo: 'លេខបញ្ជាទិញ',
    giftTitle: '🎁 ទទួលគូប៉ុងអតិថិជនថ្មី',
    claimTitle: '🎁 កញ្ចប់ស្វាគមន៍អតិថិជនថ្មី',
    claimText: 'ភ្ជាប់ Telegram ដើម្បីទទួលបានអត្ថប្រយោជន៍ និងតាមដានការបញ្ជាទិញ។',
    claimBenefits: ['✓ ពិនិត្យស្ថានភាពបញ្ជាទិញ', '✓ ទទួលគូប៉ុង', '✓ ទទួលដំណឹងប្រូម៉ូសិន'],
    claimButton: 'ទទួលគូប៉ុង',
    laterButton: 'ពេលក្រោយ',
    savedCouponTitle: '🎁 អត្ថប្រយោជន៍ត្រូវបានរក្សាទុកក្នុងគណនីរបស់អ្នក',
    viewCoupons: 'មើលគូប៉ុង',
    backToProduct: 'ត្រឡប់ទៅផលិតផល',
    continueBrowsing: 'បន្តមើល',
    contactSeller: 'ទាក់ទងហាង',
    couponLaterMessage: 'បានរក្សាទុកសម្រាប់ពេលក្រោយ។ អ្នកអាចបន្តមើល ឬទាក់ទងហាង។',
    claimFallback: 'Telegram Bot មិនទាន់បានកំណត់។ សូមចម្លងលេខបញ្ជាទិញ ហើយទាក់ទងហាង។',
    copyOrderNo: 'ចម្លងលេខបញ្ជាទិញ',
    copied: 'បានចម្លង',
    useLocation: '📍 ប្រើទីតាំងបច្ចុប្បន្ន',
    locating: 'កំពុងរកទីតាំង...',
    locationSuccess: 'បានរក្សាទុកទីតាំង។ អ្នកអាចបន្ថែមព័ត៌មានអាសយដ្ឋាន។',
    locationFail: 'មិនអាចយកទីតាំងបានទេ សូមបំពេញអាសយដ្ឋានដោយដៃ។',
    locationUnsupported: 'កម្មវិធីរុករកមិនគាំទ្រទីតាំងទេ សូមបំពេញអាសយដ្ឋានដោយដៃ។',
    locationAddress: (lat, lng) => `បានយកទីតាំងបច្ចុប្បន្ន៖ ${lat},${lng}`,
    locationPreviewTitle: '📍 បានយកទីតាំងបច្ចុប្បន្ន',
    latLabel: 'Lat',
    lngLabel: 'Lng',
    openMap: 'មើលក្នុងផែនទី',
    addressDetailHint: 'អាចបន្ថែមអាសយដ្ឋានលម្អិត លេខផ្ទះ ជាន់ ឈ្មោះហាង ឬចំណាំ។',
    errorName: 'សូមបញ្ចូលឈ្មោះរបស់អ្នក',
    errorPhone: 'សូមបញ្ចូលលេខទូរស័ព្ទរបស់អ្នក',
    errorAddress: 'សូមបញ្ចូលអាសយដ្ឋានដឹកជញ្ជូន',
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
    successTitle: '✅ Order submitted',
    successText: 'The merchant will contact you as soon as possible.',
    orderNo: 'Order No.',
    giftTitle: '🎁 Claim new-customer coupon',
    claimTitle: '🎁 New Customer Gift Pack',
    claimText: 'Bind Telegram to receive benefits and track this order.',
    claimBenefits: ['✓ View order status', '✓ Claim coupons', '✓ Receive promotion alerts'],
    claimButton: 'Claim coupon',
    laterButton: 'Maybe later',
    savedCouponTitle: '🎁 Benefits are saved to your account',
    viewCoupons: 'View coupons',
    backToProduct: 'Back to product',
    continueBrowsing: 'Continue browsing',
    contactSeller: 'Contact seller',
    couponLaterMessage: 'Saved for later. You can continue browsing or contact the seller.',
    claimFallback: 'Telegram Bot is not configured yet. Please copy your order number and contact the shop.',
    copyOrderNo: 'Copy order number',
    copied: 'Copied',
    useLocation: '📍 Use current location',
    locating: 'Getting location...',
    locationSuccess: 'Location saved. You can add address details manually.',
    locationFail: 'Could not get location. Please enter your address manually.',
    locationUnsupported: 'Location is not supported. Please enter your address manually.',
    locationAddress: (lat, lng) => `Current location saved: ${lat},${lng}`,
    locationPreviewTitle: '📍 Current location saved',
    latLabel: 'Lat',
    lngLabel: 'Lng',
    openMap: 'View on map',
    addressDetailHint: 'You can add detailed address, house number, floor, shop name, or notes.',
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
    successTitle: '✅ 订单已提交',
    successText: '商家将尽快联系您。',
    orderNo: '订单号',
    giftTitle: '🎁 领取新客优惠券',
    claimTitle: '🎁 新人礼包',
    claimText: '绑定 Telegram 后领取礼包，并可查看本次订单进度。',
    claimBenefits: ['✓ 查看订单状态', '✓ 领取优惠券', '✓ 接收促销通知'],
    claimButton: '领取优惠',
    laterButton: '稍后再说',
    savedCouponTitle: '🎁 优惠已自动保存到您的账户',
    viewCoupons: '查看优惠',
    backToProduct: '返回商品页',
    continueBrowsing: '继续浏览',
    contactSeller: '联系商家',
    couponLaterMessage: '已稍后处理，可继续浏览或联系商家',
    claimFallback: '暂未配置 Telegram Bot，请复制订单号联系客服。',
    copyOrderNo: '复制订单号',
    copied: '已复制',
    useLocation: '📍 使用当前位置',
    locating: '正在获取定位...',
    locationSuccess: '已获取定位，可继续补充详细地址。',
    locationFail: '无法获取定位，请手动填写地址。',
    locationUnsupported: '当前浏览器不支持定位，请手动填写地址。',
    locationAddress: (lat, lng) => `已获取当前位置：${lat},${lng}`,
    locationPreviewTitle: '📍 已获取当前位置',
    latLabel: 'Lat',
    lngLabel: 'Lng',
    openMap: '在地图中查看',
    addressDetailHint: '可继续补充详细地址、门牌号、楼层、店名或备注。',
    errorName: '请输入姓名',
    errorPhone: '请输入联系电话',
    errorAddress: '请输入配送地址',
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tgLang = (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.language_code
  const fromTg = normalizeLang(tgLang)
  if (fromTg) return fromTg
  for (const l of navigator.languages ?? []) {
    const normalized = normalizeLang(l)
    if (normalized) return normalized
  }
  const fromBrowser = normalizeLang(navigator.language)
  if (fromBrowser) return fromBrowser
  return 'km'
}

function normalizeLang(value: string | null | undefined): Lang | null {
  const s = (value ?? '').toLowerCase()
  if (!s) return null
  if (s === 'zh' || s.startsWith('zh-') || s.startsWith('zh_')) return 'zh'
  if (s === 'en' || s.startsWith('en-') || s.startsWith('en_')) return 'en'
  if (s === 'km' || s.startsWith('km-') || s.startsWith('kh') || s === 'km_kh') return 'km'
  return null
}

function readTelegramUserId(): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tg = (window as any).Telegram?.WebApp
  if (!tg?.initData) return null
  try {
    const userStr = new URLSearchParams(tg.initData).get('user')
    if (!userStr) return null
    return String(JSON.parse(userStr).id)
  } catch {
    return null
  }
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function localizedTitle(data: PageData, lang: Lang): string {
  const localized = lang === 'km' ? data.titleKm : lang === 'en' ? data.titleEn : data.titleZh
  return nonEmpty(localized) || nonEmpty(data.title) || data.product.name
}

function localizedFeatures(data: PageData, lang: Lang): string[] {
  const localized = lang === 'km' ? data.featuresKm : lang === 'en' ? data.featuresEn : data.featuresZh
  return [0, 1, 2, 3, 4]
    .map((idx) => nonEmpty(localized[idx]) || nonEmpty(data.features[idx]))
    .filter((value): value is string => !!value)
}

function localizedButtonText(data: PageData, lang: Lang, fallback: string): string {
  const localized = lang === 'km' ? data.buttonTextKm : lang === 'en' ? data.buttonTextEn : data.buttonTextZh
  return nonEmpty(localized) || nonEmpty(data.buttonText) || fallback
}

function readableOrderError(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback
  const message = 'message' in body ? body.message : 'error' in body ? body.error : null
  if (typeof message !== 'string') return fallback
  const trimmed = message.trim()
  if (!trimmed || /^\d+$/.test(trimmed) || /^[A-Z0-9_]+$/.test(trimmed) || /unknown|network|error/i.test(trimmed)) {
    return fallback
  }
  return trimmed.slice(0, 160)
}

function productReturnHref(slug: string, lang: Lang): string {
  const params = new URLSearchParams(window.location.search)
  params.set('lang', lang)
  const query = params.toString()
  return `/p/${encodeURIComponent(slug)}${query ? `?${query}` : ''}`
}

function trackingStorageKey(slug: string) {
  return `marketing_product_tracking_${slug}`
}

function readTrackingParams(slug: string): TrackingParams {
  const params = new URLSearchParams(window.location.search)
  const current: TrackingParams = {}
  for (const key of TRACKING_PARAM_KEYS) {
    const value = params.get(key)?.trim()
    if (value) current[key] = value.slice(0, 120)
  }

  const hasCurrent = Object.keys(current).length > 0
  if (hasCurrent) {
    try { localStorage.setItem(trackingStorageKey(slug), JSON.stringify(current)) } catch { /* ignore */ }
    return current
  }

  try {
    const raw = localStorage.getItem(trackingStorageKey(slug))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const saved: TrackingParams = {}
    for (const key of TRACKING_PARAM_KEYS) {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim()) saved[key] = value.trim().slice(0, 120)
    }
    return saved
  } catch {
    return {}
  }
}

function formatTrackingParams(params: TrackingParams) {
  return TRACKING_PARAM_KEYS
    .map((key) => params[key] ? `${key}=${params[key]}` : '')
    .filter(Boolean)
    .join('&')
}

function buildOrderRemark(note: string, trackingParams: TrackingParams) {
  const base = note.trim() ? `营销商品页备注：${note.trim()}` : '营销商品页'
  const trackingText = formatTrackingParams(trackingParams)
  return trackingText ? `${base} | ${trackingText}`.slice(0, 500) : base
}

function ensureTikTokPixel() {
  if (!TIKTOK_PIXEL_ID || typeof window === 'undefined') return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  if (w.__dxTikTokPixelLoaded) return true

  w.TiktokAnalyticsObject = 'ttq'
  const ttq = w.ttq = w.ttq || []
  ttq.methods = [
    'page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once',
    'ready', 'alias', 'group', 'enableCookie', 'disableCookie',
  ]
  ttq.setAndDefer = function setAndDefer(target: unknown, method: string) {
    return function deferCall(...args: unknown[]) {
      ttq.push([method, ...args])
    }
  }
  for (const method of ttq.methods) {
    ttq[method] = ttq[method] || ttq.setAndDefer(ttq, method)
  }
  ttq.instance = function instance(name: string) {
    const tracker = ttq._i[name] || []
    for (const method of ttq.methods) {
      tracker[method] = tracker[method] || ttq.setAndDefer(tracker, method)
    }
    return tracker
  }
  ttq.load = function load(id: string) {
    const url = `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(id)}&lib=ttq`
    if (document.querySelector(`script[src="${url}"]`)) return
    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.async = true
    script.src = url
    const firstScript = document.getElementsByTagName('script')[0]
    firstScript?.parentNode?.insertBefore(script, firstScript)
  }
  ttq._i = ttq._i || {}
  ttq._i[TIKTOK_PIXEL_ID] = []
  ttq._i[TIKTOK_PIXEL_ID]._u = `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(TIKTOK_PIXEL_ID)}&lib=ttq`
  ttq._t = ttq._t || {}
  ttq._t[TIKTOK_PIXEL_ID] = Date.now()
  ttq._o = ttq._o || {}
  ttq._o[TIKTOK_PIXEL_ID] = {}
  ttq.load(TIKTOK_PIXEL_ID)
  ttq.page()
  w.__dxTikTokPixelLoaded = true
  return true
}

function trackTikTok(event: 'ViewContent' | 'SubmitForm' | 'Contact', payload: Record<string, unknown>) {
  if (!ensureTikTokPixel()) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ttq = (window as any).ttq
  if (typeof ttq?.track === 'function') ttq.track(event, payload)
}

function templateCopy(template: TemplateType, lang: Lang, text: typeof I18N[Lang]) {
  const base = {
    priceTitle: text.limitedOffer,
    featureTitle: text.whyTitle,
    detailTitle: text.detailTitle,
    reviewTitle: text.reviewTitle,
    trustTitle: text.afterSale,
    heroTag: text.flashBar,
    trustItems: [text.cod, text.freeDelivery, text.afterSale],
  }
  if (template === 'HOME_GOODS') {
    return {
      ...base,
      heroTag: lang === 'en' ? 'Practical home upgrade' : lang === 'zh' ? '家居实用好物' : 'ផលិតផលប្រើប្រាស់ក្នុងផ្ទះ',
      featureTitle: lang === 'en' ? 'Functional Benefits' : lang === 'zh' ? '功能卖点' : 'អត្ថប្រយោជន៍សំខាន់ៗ',
      detailTitle: lang === 'en' ? 'Scenes & Details' : lang === 'zh' ? '使用场景与细节' : 'រូបភាពប្រើប្រាស់ និងព័ត៌មានលម្អិត',
      trustTitle: lang === 'en' ? 'Easy to use at home' : lang === 'zh' ? '安装/使用更省心' : 'ងាយស្រួលប្រើនៅផ្ទះ',
      trustItems: [
        lang === 'en' ? 'Space-saving design' : lang === 'zh' ? '节省空间' : 'ជួយសន្សំកន្លែង',
        lang === 'en' ? 'Durable daily use' : lang === 'zh' ? '日常耐用' : 'ប្រើបានយូរ',
        lang === 'en' ? 'Simple setup' : lang === 'zh' ? '安装方便' : 'រៀបចំងាយស្រួល',
      ],
    }
  }
  if (template === 'FOOD_SET') {
    return {
      ...base,
      heroTag: lang === 'en' ? 'Fresh set meal · Fast order' : lang === 'zh' ? '门店套餐 · 快速下单' : 'ឈុតអាហារស្រស់ · បញ្ជាទិញលឿន',
      featureTitle: lang === 'en' ? 'Set Includes' : lang === 'zh' ? '套餐内容' : 'មុខម្ហូបក្នុងឈុត',
      priceTitle: lang === 'en' ? 'Today Set Price' : lang === 'zh' ? '今日套餐价' : 'តម្លៃឈុតថ្ងៃនេះ',
      trustTitle: lang === 'en' ? 'Delivery & freshness' : lang === 'zh' ? '配送 / 自取 / 新鲜保障' : 'ដឹកជញ្ជូន / មកយក / ធានាថាស្រស់',
      trustItems: [
        text.localDelivery,
        lang === 'en' ? 'Freshly prepared' : lang === 'zh' ? '新鲜现做' : 'រៀបចំថ្មីៗ',
        lang === 'en' ? 'Shop-confirmed order' : lang === 'zh' ? '门店确认订单' : 'ហាងបញ្ជាក់ការបញ្ជាទិញ',
      ],
    }
  }
  if (template === 'BEAUTY') {
    return {
      ...base,
      heroTag: lang === 'en' ? 'Beauty care selected by the shop' : lang === 'zh' ? '美妆个护精选' : 'ផលិតផលថែរក្សាសម្រស់ជ្រើសរើសដោយហាង',
      featureTitle: lang === 'en' ? 'Key Effects' : lang === 'zh' ? '核心功效' : 'ប្រសិទ្ធភាពសំខាន់ៗ',
      detailTitle: lang === 'en' ? 'Texture & Details' : lang === 'zh' ? '质感与详情' : 'គុណភាព និងព័ត៌មានលម្អិត',
      trustTitle: lang === 'en' ? 'Care guarantee' : lang === 'zh' ? '安心保障' : 'ការធានាទំនុកចិត្ត',
      trustItems: [
        lang === 'en' ? 'Shop-selected product' : lang === 'zh' ? '门店精选' : 'ផលិតផលជ្រើសរើសដោយហាង',
        lang === 'en' ? 'Customer feedback' : lang === 'zh' ? '真实评价参考' : 'មតិអតិថិជន',
        text.afterSale,
      ],
    }
  }
  return {
    ...base,
    heroTag: lang === 'en' ? 'TikTok hot sale · COD' : lang === 'zh' ? 'TikTok 爆款 · 货到付款' : 'លក់ដាច់លើ TikTok · បង់ប្រាក់ពេលទទួលទំនិញ',
    priceTitle: lang === 'en' ? 'Flash Deal Price' : lang === 'zh' ? '限时爆款价' : 'តម្លៃពិសេសមានកំណត់',
    trustTitle: lang === 'en' ? 'Fast COD order' : lang === 'zh' ? 'COD 快速下单' : 'បញ្ជាទិញ COD លឿន',
  }
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
  const [deliveryLat, setDeliveryLat] = useState<number | null>(null)
  const [deliveryLng, setDeliveryLng] = useState<number | null>(null)
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoMsg, setGeoMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<OrderField, true>>>({})
  const [error, setError] = useState('')
  const [result, setResult] = useState<OrderResult | null>(null)
  const [couponPromptDismissed, setCouponPromptDismissed] = useState(false)
  const [copiedOrderNo, setCopiedOrderNo] = useState(false)
  const [trackingParams, setTrackingParams] = useState<TrackingParams>({})
  const nameRef = useRef<HTMLInputElement | null>(null)
  const phoneRef = useRef<HTMLInputElement | null>(null)
  const addressRef = useRef<HTMLTextAreaElement | null>(null)
  const viewTrackedRef = useRef('')
  const text = I18N[lang]

  useEffect(() => {
    setLang(detectLang())
    setTrackingParams(readTrackingParams(slug))
  }, [slug])

  useEffect(() => {
    const customerTelegramId = readTelegramUserId()
    const qs = customerTelegramId ? `?tgId=${encodeURIComponent(customerTelegramId)}` : ''
    fetch(`/api/public/product-pages/${encodeURIComponent(slug)}${qs}`)
      .then(async (res) => {
        if (res.status === 404) { setNotFound(true); return null }
        const body = await res.json()
        if (!res.ok || body.error) { setNotFound(true); return null }
        return body as PageData
      })
      .then((body) => {
        if (body) {
          setData(body)
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [slug])

  useEffect(() => {
    if (!data) return
    document.title = `${localizedTitle(data, lang)} - ${data.store.name}`
  }, [data, lang])

  useEffect(() => {
    if (!data) return
    const trackingKey = `${slug}:${data.product.id}`
    if (viewTrackedRef.current === trackingKey) return
    viewTrackedRef.current = trackingKey
    trackTikTok('ViewContent', {
      content_id: data.product.id,
      content_name: localizedTitle(data, lang),
      content_type: 'product',
      value: data.salePrice ?? data.product.price,
      currency: 'USD',
      store_code: data.store.code,
      slug: data.slug,
      ...trackingParams,
    })
  }, [data, lang, slug, trackingParams])

  async function submitOrder() {
    if (!data || submitting) return
    const nextErrors: Partial<Record<OrderField, true>> = {}
    if (!name.trim()) nextErrors.name = true
    if (!phone.trim()) nextErrors.phone = true
    if (!address.trim()) nextErrors.address = true
    const firstError = (['name', 'phone', 'address'] as OrderField[]).find((field) => nextErrors[field])
    if (firstError) {
      setFieldErrors(nextErrors)
      setError('')
      setTimeout(() => {
        const target = firstError === 'name' ? nameRef.current : firstError === 'phone' ? phoneRef.current : addressRef.current
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        target?.focus({ preventScroll: true })
      }, 0)
      return
    }

    trackTikTok('SubmitForm', {
      content_id: data.product.id,
      content_name: localizedTitle(data, lang),
      content_type: 'product',
      value: total,
      currency: 'USD',
      store_code: data.store.code,
      slug: data.slug,
      ...trackingParams,
    })
    setSubmitting(true)
    setFieldErrors({})
    setError('')

    const customerTelegramId = readTelegramUserId()

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
          ...(deliveryLat != null && deliveryLng != null ? { deliveryLat, deliveryLng } : {}),
          remark: buildOrderRemark(note, trackingParams),
          marketingTracking: trackingParams,
          ...(campaignCode ? { campaignCode } : {}),
          campaignIntent,
          lang,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(readableOrderError(body, text.errorSubmit))
        return
      }
      setCouponPromptDismissed(false)
      setResult({ orderNo: body.orderNo, totalAmount: Number(body.totalAmount ?? total), telegramLinked: !!data.customerBound })
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

  function useCurrentLocation() {
    if (geoBusy) return
    setGeoMsg(null)
    if (!navigator.geolocation) {
      setGeoMsg({ ok: false, text: text.locationUnsupported })
      return
    }

    setGeoBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6))
        const lng = Number(pos.coords.longitude.toFixed(6))
        const latText = lat.toFixed(5)
        const lngText = lng.toFixed(5)
        const locationLine = text.locationAddress(latText, lngText)
        setDeliveryLat(lat)
        setDeliveryLng(lng)
        setAddress((prev) => {
          const current = prev.trim()
          if (!current) return locationLine
          if (
            current.startsWith('已获取当前位置：') ||
            current.startsWith('Current location saved:') ||
            current.startsWith('បានយកទីតាំងបច្ចុប្បន្ន៖')
          ) return locationLine
          return `${current}\n${locationLine}`.slice(0, 500)
        })
        setFieldErrors((prev) => ({ ...prev, address: undefined }))
        setGeoMsg({ ok: true, text: text.locationSuccess })
        setGeoBusy(false)
      },
      () => {
        setGeoMsg({ ok: false, text: text.locationFail })
        setGeoBusy(false)
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    )
  }

  function copyOrderNo(orderNo: string) {
    navigator.clipboard.writeText(orderNo)
      .then(() => {
        setCopiedOrderNo(true)
        window.setTimeout(() => setCopiedOrderNo(false), 1600)
      })
      .catch(() => setCopiedOrderNo(false))
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

  const legalLinks = (
    <footer style={s.legalFooter}>
      <a href="/privacy" target="_blank" rel="noreferrer" style={s.legalLink}>Privacy Policy</a>
      <span style={s.legalDot}>•</span>
      <a href="/terms" target="_blank" rel="noreferrer" style={s.legalLink}>Terms of Service</a>
      <span style={s.legalDot}>•</span>
      <a href="/contact" target="_blank" rel="noreferrer" style={s.legalLink}>Contact Us</a>
    </footer>
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
  const title = localizedTitle(data, lang)
  const features = localizedFeatures(data, lang)
  const displayFeatures = features.length > 0 ? features : text.defaultFeatures
  const buttonText = localizedButtonText(data, lang, text.submitOrder)
  const templateType = data.templateType ?? 'TIKTOK_HOT'
  const theme = TEMPLATE_THEMES[templateType] ?? TEMPLATE_THEMES.TIKTOK_HOT
  const copy = templateCopy(templateType, lang, text)

  const renderPriceCard = () => {
    const priceCardStyle = {
      ...s.priceCard,
      ...(theme.priceVariant === 'deal' ? s.priceCardDeal : {}),
      ...(theme.priceVariant === 'clean' ? s.priceCardClean : {}),
      ...(theme.priceVariant === 'ticket' ? s.priceCardTicket : {}),
      ...(theme.priceVariant === 'premium' ? s.priceCardPremium : {}),
      borderColor: theme.sectionBorder,
    }
    return (
      <section key="price" style={{ ...s.section, ...s.priceSection, borderColor: theme.sectionBorder }}>
        <div style={priceCardStyle}>
          <div>
            <div style={{ ...s.priceLabel, color: theme.priceVariant === 'deal' ? '#fff' : theme.accentDark }}>{copy.priceTitle}</div>
            <div style={s.priceCardMeta}>
              <span>{text.cod}</span>
              {data.soldCount != null && <span>{text.sold} {data.soldCount}</span>}
            </div>
          </div>
          <div style={s.priceCardValue}>
            <span style={{ ...s.price, color: theme.priceVariant === 'deal' ? '#fff' : theme.accent }}>${displayPrice.toFixed(2)}</span>
            {data.originalPrice != null && <span style={{ ...s.originalPrice, color: theme.priceVariant === 'deal' ? 'rgba(255,255,255,0.68)' : '#98a2b3' }}>${data.originalPrice.toFixed(2)}</span>}
          </div>
        </div>
        {(data.enableCountdown || templateType === 'TIKTOK_HOT') && (
          <div style={{ ...s.countdown, background: theme.countdownBg, color: theme.countdownText, borderColor: theme.countdownBorder }}>
            {text.limitedOffer} · {text.priorityDelivery}
          </div>
        )}
      </section>
    )
  }

  const renderFeatures = () => (
    <section key="features" style={{ ...s.section, borderColor: theme.sectionBorder }}>
      <h2 style={{ ...s.sectionTitle, color: theme.text }}>{copy.featureTitle}</h2>
      <div
        style={{
          ...s.points,
          ...(theme.featureVariant === 'checklist' ? s.pointsChecklist : {}),
          ...(theme.featureVariant === 'menu' ? s.pointsMenu : {}),
          ...(theme.featureVariant === 'soft' ? s.pointsSoft : {}),
        }}
      >
        {displayFeatures.map((feature, idx) => (
          <div
            key={idx}
            style={{
              ...s.point,
              ...(theme.featureVariant === 'checklist' ? s.pointChecklist : {}),
              ...(theme.featureVariant === 'menu' ? s.pointMenu : {}),
              ...(theme.featureVariant === 'soft' ? s.pointSoft : {}),
              background: theme.pointBg,
              borderColor: theme.pointBorder,
              color: theme.text,
            }}
          >
            <span style={{ ...s.pointIndex, background: theme.accent, color: '#fff' }}>
              {theme.featureVariant === 'checklist' ? '✓' : idx + 1}
            </span>
            <span>{feature}</span>
          </div>
        ))}
      </div>
    </section>
  )

  const renderDetails = () => data.detailImages.length > 0 ? (
    <section key="details" style={{ ...s.section, borderColor: theme.sectionBorder }}>
      <h2 style={{ ...s.sectionTitle, color: theme.text }}>{copy.detailTitle}</h2>
      <div
        style={{
          ...s.imageStack,
          ...(theme.imageVariant === 'scene' ? s.imageScene : {}),
          ...(theme.imageVariant === 'grid' ? s.imageGrid : {}),
          ...(theme.imageVariant === 'polished' ? s.imagePolished : {}),
        }}
      >
        {data.detailImages.map((url, idx) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={idx} src={url} alt={`${copy.detailTitle} ${idx + 1}`} style={s.detailImg} />
        ))}
      </div>
    </section>
  ) : null

  const renderReviews = () => data.reviewImages.length > 0 ? (
    <section key="reviews" style={{ ...s.section, borderColor: theme.sectionBorder }}>
      <h2 style={{ ...s.sectionTitle, color: theme.text }}>{copy.reviewTitle}</h2>
      <div style={{ ...s.reviewGrid, ...(templateType === 'BEAUTY' ? s.reviewGridBeauty : {}), ...(templateType === 'FOOD_SET' ? s.reviewGridFood : {}) }}>
        {data.reviewImages.map((url, idx) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={idx} src={url} alt={`${copy.reviewTitle} ${idx + 1}`} style={{ ...s.reviewImg, ...(templateType === 'BEAUTY' ? s.reviewImgBeauty : {}) }} />
        ))}
      </div>
    </section>
  ) : null

  const renderTrust = () => (
    <section key="trust" style={{ ...s.section, borderColor: theme.sectionBorder }}>
      <h2 style={{ ...s.sectionTitle, color: theme.text }}>{copy.trustTitle}</h2>
      <div style={s.trustGrid}>
        {copy.trustItems.map((item, idx) => (
          <div key={idx} style={{ ...s.trustItem, background: theme.badgeBg, borderColor: theme.badgeBorder, color: theme.badgeText }}>
            <span style={{ ...s.trustDot, background: theme.accent }} />
            {item}
          </div>
        ))}
      </div>
    </section>
  )

  const renderOrder = () => (
    <section key="order" style={{ ...s.section, borderColor: theme.sectionBorder }}>
      <h2 style={{ ...s.sectionTitle, color: theme.text }}>{text.orderTitle}</h2>
      <label style={{ ...s.label, color: theme.text }}>{text.name}</label>
      <input
        ref={nameRef}
        style={{ ...s.input, ...(fieldErrors.name ? s.inputError : {}) }}
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: undefined }))
        }}
        placeholder={text.namePlaceholder}
        aria-invalid={!!fieldErrors.name}
      />
      {fieldErrors.name && <div style={s.fieldError}>{text.errorName}</div>}
      <label style={{ ...s.label, color: theme.text }}>{text.phone}</label>
      <input
        ref={phoneRef}
        style={{ ...s.input, ...(fieldErrors.phone ? s.inputError : {}) }}
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value)
          if (fieldErrors.phone) setFieldErrors((prev) => ({ ...prev, phone: undefined }))
        }}
        placeholder={text.phonePlaceholder}
        inputMode="tel"
        aria-invalid={!!fieldErrors.phone}
      />
      {fieldErrors.phone && <div style={s.fieldError}>{text.errorPhone}</div>}
      <label style={{ ...s.label, color: theme.text }}>{text.address}</label>
      <textarea
        ref={addressRef}
        style={{ ...s.textarea, ...(fieldErrors.address ? s.inputError : {}) }}
        value={address}
        onChange={(e) => {
          setAddress(e.target.value)
          if (fieldErrors.address) setFieldErrors((prev) => ({ ...prev, address: undefined }))
        }}
        placeholder={text.addressPlaceholder}
        aria-invalid={!!fieldErrors.address}
      />
      {fieldErrors.address && <div style={s.fieldError}>{text.errorAddress}</div>}
      <div style={{ ...s.addressHint, color: theme.muted }}>{text.addressDetailHint}</div>
      <button
        type="button"
        style={{ ...s.locationBtn, borderColor: theme.badgeBorder, background: theme.pointBg, color: theme.accentDark, opacity: geoBusy ? 0.65 : 1 }}
        disabled={geoBusy}
        onClick={useCurrentLocation}
      >
        {geoBusy ? text.locating : text.useLocation}
      </button>
      {geoMsg && (
        <div
          style={{
            ...s.locationMsg,
            ...(geoMsg.ok ? s.locationMsgOk : s.locationMsgFail),
            ...(geoMsg.ok
              ? { borderColor: theme.badgeBorder, background: theme.badgeBg, color: theme.badgeText }
              : { borderColor: theme.countdownBorder, background: theme.countdownBg, color: theme.countdownText }),
          }}
        >
          {geoMsg.text}
        </div>
      )}
      {deliveryLat != null && deliveryLng != null && (
        <div style={{ ...s.mapPreview, borderColor: theme.badgeBorder, background: theme.badgeBg, color: theme.badgeText }}>
          <div style={s.mapPreviewTitle}>{text.locationPreviewTitle}</div>
          <div style={s.mapPreviewCoord}>{text.latLabel}: {deliveryLat.toFixed(5)}</div>
          <div style={s.mapPreviewCoord}>{text.lngLabel}: {deliveryLng.toFixed(5)}</div>
          <a
            href={`https://maps.google.com/?q=${deliveryLat},${deliveryLng}`}
            target="_blank"
            rel="noreferrer"
            style={{ ...s.mapPreviewLink, color: theme.accentDark }}
          >
            {text.openMap}
          </a>
        </div>
      )}
      <label style={{ ...s.label, color: theme.text }}>{text.note}</label>
      <input style={s.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder={text.notePlaceholder} />
      <label style={{ ...s.label, color: theme.text }}>{text.quantity}</label>
      <div style={s.qtyRow}>
        <button style={{ ...s.qtyBtn, borderColor: theme.badgeBorder, background: theme.pointBg }} onClick={() => setQty((v) => Math.max(1, v - 1))}>-</button>
        <span style={s.qtyNum}>{qty}</span>
        <button style={{ ...s.qtyBtn, borderColor: theme.badgeBorder, background: theme.pointBg }} onClick={() => setQty((v) => Math.min(99, v + 1))}>+</button>
        <span style={{ ...s.total, color: theme.accent }}>${total.toFixed(2)}</span>
      </div>
      {error && <div style={{ ...s.error, color: theme.countdownText, borderColor: theme.countdownBorder, background: theme.countdownBg }}>{error}</div>}
      <button style={{ ...s.submit, background: theme.accent, opacity: submitting ? 0.6 : 1 }} disabled={submitting} onClick={submitOrder}>
        {submitting ? text.submitting : buttonText}
      </button>
    </section>
  )

  function renderSection(section: TemplateSection) {
    if (section === 'features') return renderFeatures()
    if (section === 'details') return renderDetails()
    if (section === 'reviews') return renderReviews()
    if (section === 'trust') return renderTrust()
    if (section === 'price') return renderPriceCard()
    return renderOrder()
  }

  if (result) {
    const bindPayload = `bind_${data.store.code}_${result.orderNo}`
    const benefitLink = CUSTOMER_BOT
      ? `https://t.me/${CUSTOMER_BOT}?start=${encodeURIComponent(bindPayload)}`
      : ''
    const productHref = productReturnHref(slug, lang)
    const contactLink = CUSTOMER_BOT ? `https://t.me/${CUSTOMER_BOT}` : ''
    const couponLink = `/me/coupons?code=${encodeURIComponent(data.store.code)}`

    return (
      <main style={{ ...s.page, background: theme.background, color: theme.text }}>
        {langSwitcher}
        <section style={{ ...s.successBox, borderColor: theme.sectionBorder }}>
          <div style={{ ...s.successIcon, background: theme.accent }}>✓</div>
          <h1 style={s.successTitle}>{text.successTitle}</h1>
          <p style={s.successText}>{text.successText}</p>
          <div style={s.orderNo}>{text.orderNo}：{result.orderNo}</div>
          <div style={{ ...s.successTotal, color: theme.accent }}>{text.total}：${result.totalAmount.toFixed(2)}</div>
          <div style={s.successActions}>
            <button
              type="button"
              style={{ ...s.successPrimaryButton, background: theme.accent }}
              onClick={() => {
                setResult(null)
                window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0)
              }}
            >
              {text.backToProduct}
            </button>
            <a href={productHref} style={s.successSecondaryButton}>
              {text.continueBrowsing}
            </a>
            {contactLink && (
              <a href={contactLink} target="_blank" rel="noreferrer" style={s.successSecondaryButton}>
                {text.contactSeller}
              </a>
            )}
          </div>
        </section>
        {couponPromptDismissed ? (
          <section style={{ ...s.dismissedNotice, borderColor: theme.badgeBorder, background: theme.badgeBg, color: theme.badgeText }}>
            {text.couponLaterMessage}
          </section>
        ) : (
          <section style={s.claimBox}>
            <div style={s.claimGiftIcon}>🎁</div>
            {result.telegramLinked ? (
              <>
                <div style={s.claimGiftTitle}>{text.savedCouponTitle}</div>
                <a href={couponLink} style={s.claimButton}>
                  {text.viewCoupons}
                </a>
              </>
            ) : (
              <>
                <div style={s.claimGiftTitle}>{text.giftTitle}</div>
                <h2 style={s.claimTitle}>{text.claimTitle}</h2>
                <p style={{ ...s.claimText, color: theme.muted }}>{text.claimText}</p>
                <div style={s.claimBenefits}>
                  {text.claimBenefits.map((benefit) => (
                    <div key={benefit} style={s.claimBenefit}>
                      {benefit}
                    </div>
                  ))}
                </div>
                {benefitLink ? (
                  <a
                    href={benefitLink}
                    target="_blank"
                    rel="noreferrer"
                    style={s.claimButton}
                  >
                    {text.claimButton}
                  </a>
                ) : (
                  <>
                    <p style={{ ...s.claimFallback, color: theme.muted }}>{text.claimFallback}</p>
                    <button type="button" style={s.claimButton} onClick={() => copyOrderNo(result.orderNo)}>
                      {copiedOrderNo ? text.copied : text.copyOrderNo}
                    </button>
                  </>
                )}
                <button type="button" style={s.laterButton} onClick={() => setCouponPromptDismissed(true)}>
                  {text.laterButton}
                </button>
              </>
            )}
          </section>
        )}
        {legalLinks}
      </main>
    )
  }

  return (
    <main style={{ ...s.page, background: theme.background, color: theme.text }}>
      {langSwitcher}
      <section
        style={{
          ...s.hero,
          ...(theme.heroVariant === 'scene' ? s.heroScene : {}),
          ...(theme.heroVariant === 'menu' ? s.heroMenu : {}),
          ...(theme.heroVariant === 'soft' ? s.heroSoft : {}),
          background: theme.heroBg,
          borderColor: theme.sectionBorder,
        }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={title}
            style={{
              ...s.heroImg,
              ...(theme.heroVariant === 'scene' ? s.heroImgScene : {}),
              ...(theme.heroVariant === 'menu' ? s.heroImgMenu : {}),
              ...(theme.heroVariant === 'soft' ? s.heroImgSoft : {}),
            }}
          />
        ) : (
          <div style={{ ...s.heroPlaceholder, background: theme.pointBg, color: theme.accentDark }}>店小二</div>
        )}
        <div style={s.heroBody}>
          <div style={{ ...s.storeName, color: theme.muted }}>{data.store.name}</div>
          <div style={{ ...s.flashBar, background: theme.flashBg, color: theme.flashText }}>{copy.heroTag}</div>
          <h1 style={{ ...s.title, color: theme.text }}>{title}</h1>
          {data.subtitle && <p style={{ ...s.subtitle, color: theme.muted }}>{data.subtitle}</p>}
          <div style={{ ...s.metaRow, color: theme.muted }}>
            <span>{text.cod}</span>
            <span>{templateType === 'FOOD_SET' ? text.localDelivery : text.freeDelivery}</span>
            {data.soldCount != null && <span>{text.sold} {data.soldCount}</span>}
          </div>
          {data.product.spec && <div style={{ ...s.spec, color: theme.muted }}>{data.product.spec}</div>}
          <div style={s.badges}>
            {copy.trustItems.slice(0, 3).map((item) => (
              <span key={item} style={{ ...s.badge, background: theme.badgeBg, color: theme.badgeText, borderColor: theme.badgeBorder }}>
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      {theme.sectionOrder.map(renderSection)}
      {legalLinks}
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
  heroScene: { padding: 14 },
  heroMenu: { display: 'flex', flexDirection: 'column', borderBottomWidth: 0 },
  heroSoft: { margin: 12, borderRadius: 18, overflow: 'hidden', border: '1px solid #e9d5ff', boxShadow: '0 12px 28px rgba(126,34,206,0.12)' },
  heroImg: { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block' },
  heroImgScene: { borderRadius: 14, aspectRatio: '4 / 3' },
  heroImgMenu: { aspectRatio: '16 / 11' },
  heroImgSoft: { aspectRatio: '4 / 5', objectFit: 'cover' },
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
  priceSection: { paddingTop: 12, paddingBottom: 12 },
  priceCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: 14,
  },
  priceCardDeal: { background: '#111827', color: '#fff', borderRadius: 6, boxShadow: '0 10px 24px rgba(225,29,72,0.22)' },
  priceCardClean: { background: '#ffffff', color: '#172018', borderRadius: 12 },
  priceCardTicket: { background: '#ffedd5', color: '#24150b', borderStyle: 'dashed', borderRadius: 14 },
  priceCardPremium: { background: '#ffffff', color: '#25113a', borderRadius: 18, boxShadow: '0 10px 24px rgba(168,85,247,0.12)' },
  priceLabel: { fontSize: 13, fontWeight: 900, marginBottom: 6 },
  priceCardMeta: { display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, fontWeight: 800, opacity: 0.82 },
  priceCardValue: { display: 'grid', justifyItems: 'end', gap: 2, flexShrink: 0 },
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
  pointsChecklist: { gap: 6 },
  pointsMenu: { gridTemplateColumns: '1fr 1fr' },
  pointsSoft: { gap: 10 },
  point: { display: 'flex', alignItems: 'flex-start', gap: 10, background: '#f7faf5', border: '1px solid #e3e8df', borderRadius: 6, padding: 12, fontSize: 14, color: '#344236' },
  pointChecklist: { borderRadius: 4, borderLeftWidth: 4 },
  pointMenu: { display: 'grid', gap: 8, borderStyle: 'dashed', minHeight: 78 },
  pointSoft: { borderRadius: 16, boxShadow: '0 8px 20px rgba(126,34,206,0.08)' },
  pointIndex: { width: 22, height: 22, borderRadius: 999, display: 'inline-grid', placeItems: 'center', fontSize: 12, fontWeight: 900, flexShrink: 0 },
  imageStack: { display: 'grid', gap: 10 },
  imageScene: { gap: 12 },
  imageGrid: { gridTemplateColumns: '1fr 1fr' },
  imagePolished: { gap: 12 },
  detailImg: { width: '100%', borderRadius: 8, display: 'block', objectFit: 'cover' },
  reviewGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 },
  reviewGridBeauty: { gridTemplateColumns: '1fr', gap: 10 },
  reviewGridFood: { gridTemplateColumns: 'repeat(2, 1fr)' },
  reviewImg: { width: '100%', aspectRatio: '1 / 1', borderRadius: 8, objectFit: 'cover', display: 'block' },
  reviewImgBeauty: { aspectRatio: '4 / 3', borderRadius: 16 },
  trustGrid: { display: 'grid', gap: 8 },
  trustItem: { display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontWeight: 800 },
  trustDot: { width: 8, height: 8, borderRadius: 999, flexShrink: 0 },
  label: { display: 'block', fontSize: 13, fontWeight: 700, color: '#344236', margin: '12px 0 6px' },
  input: { width: '100%', boxSizing: 'border-box', height: 46, border: '1px solid #d5ddd1', borderRadius: 6, padding: '0 12px', fontSize: 15, background: '#fff' },
  inputError: { borderColor: '#dc2626', background: '#fffafa' },
  textarea: { width: '100%', boxSizing: 'border-box', minHeight: 82, border: '1px solid #d5ddd1', borderRadius: 6, padding: 12, fontSize: 15, background: '#fff', resize: 'vertical' },
  fieldError: { marginTop: 5, color: '#dc2626', fontSize: 12, lineHeight: 1.4, fontWeight: 700 },
  addressHint: { marginTop: 6, fontSize: 12, lineHeight: 1.45 },
  locationBtn: { marginTop: 8, width: '100%', minHeight: 42, border: '1px solid #c8d4c3', borderRadius: 6, background: '#f7faf5', fontSize: 14, fontWeight: 900, cursor: 'pointer' },
  locationMsg: { marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px', fontSize: 12, lineHeight: 1.45 },
  locationMsgOk: { background: '#f0fdf4', color: '#166534' },
  locationMsgFail: { background: '#fff7ed', color: '#c2410c' },
  mapPreview: { marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, fontSize: 13, lineHeight: 1.5 },
  mapPreviewTitle: { fontWeight: 900, marginBottom: 4 },
  mapPreviewCoord: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  mapPreviewLink: { display: 'inline-flex', marginTop: 6, fontWeight: 900, textDecoration: 'underline' },
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
  successActions: { display: 'grid', gap: 10, marginTop: 18 },
  successPrimaryButton: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 48, border: 0, borderRadius: 6, color: '#fff', fontSize: 16, fontWeight: 900, cursor: 'pointer' },
  successSecondaryButton: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 46, boxSizing: 'border-box', border: '1px solid #d0d5dd', borderRadius: 6, background: '#fff', color: '#344054', fontSize: 15, fontWeight: 850, textDecoration: 'none', cursor: 'pointer' },
  claimBox: { margin: '0 18px 18px', background: 'linear-gradient(180deg, #fff8e1 0%, #ffffff 45%)', borderRadius: 14, padding: 20, border: '1px solid #f6d365', boxShadow: '0 12px 26px rgba(180,124,0,0.14)', textAlign: 'center' },
  claimGiftIcon: { width: 64, height: 64, margin: '0 auto 10px', borderRadius: 18, background: 'linear-gradient(135deg, #ffd666 0%, #f59e0b 100%)', display: 'grid', placeItems: 'center', fontSize: 34, boxShadow: '0 10px 22px rgba(245,158,11,0.28)' },
  claimGiftTitle: { fontSize: 20, lineHeight: 1.2, fontWeight: 950, color: '#92400e', marginBottom: 8 },
  claimTitle: { margin: 0, fontSize: 17, lineHeight: 1.25, letterSpacing: 0, color: '#7c2d12' },
  claimText: { margin: '8px 0 12px', fontSize: 14, lineHeight: 1.45 },
  claimBenefits: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 },
  claimBenefit: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 42, border: '1px solid #fde68a', borderRadius: 10, padding: '8px 10px', fontSize: 13, fontWeight: 900, color: '#92400e', background: '#fffbeb', textAlign: 'center' },
  claimButton: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 50, border: 0, borderRadius: 999, background: '#16a34a', color: '#fff', fontSize: 16, fontWeight: 950, textDecoration: 'none', cursor: 'pointer', boxShadow: '0 10px 20px rgba(22,163,74,0.22)' },
  laterButton: { marginTop: 10, width: '100%', height: 44, border: '1px solid #e5e7eb', borderRadius: 999, background: '#fff', color: '#667085', fontSize: 14, fontWeight: 900, cursor: 'pointer' },
  claimFallback: { margin: '0 0 12px', fontSize: 13, lineHeight: 1.45 },
  dismissedNotice: { margin: '0 18px 18px', border: '1px solid #e3e8df', borderRadius: 8, padding: '12px 14px', fontSize: 14, lineHeight: 1.45, fontWeight: 800, textAlign: 'center' },
  legalFooter: { display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 8, padding: '12px 18px 2px', color: '#8a94a6', fontSize: 12 },
  legalLink: { color: '#667085', textDecoration: 'none', fontWeight: 700 },
  legalDot: { color: '#c0c7d2' },
}
