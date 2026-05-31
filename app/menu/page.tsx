'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import CustomerBottomNav from '@/app/components/CustomerBottomNav'

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const PRIMARY = '#ff6b00'

// 顾客端 Bot 用户名（前端公开变量，不允许写死；清理误填的 @）
const CUSTOMER_BOT = (process.env.NEXT_PUBLIC_CUSTOMER_BOT_USERNAME ?? '').replace(/^@/, '').trim()

// ─── 多语言类型 ───────────────────────────────────────────────────────────────

type Lang = 'zh' | 'en' | 'km'

type ML = { zh: string; en?: string; km?: string }

function gl(obj: ML, lang: Lang): string {
  return obj[lang] ?? obj.zh
}

// ─── UI 固定文案翻译表 ────────────────────────────────────────────────────────

const T: Record<Lang, {
  open: string
  closed: string
  sold: string
  notSelected: string
  itemCount: (n: number) => string
  checkout: string
  selectFirst: string
  loading: string
  empty: string
  errNoCode: string
  errNotFound: string
  errNetwork: string
  submitting: string
  orderSubmitted: string
  orderHint: string
  orderNo: string
  errSubmitProduct: string
  errSubmitFail: string
  retryCart: string
  statusPending: string
  orderHint2: string
  confirmTitle: string
  confirmSubmit: string
  backToEdit: string
  bindTgBtn: string
  bindTgHint: string
  // ── 我的页相关（v1 私域承接占位） ────────────────────────────────────
  profileTitle: string
  guestUser: string
  normalMember: string
  vipMember: string
  balance: string
  coupon: string
  voucher: string
  points: string
  myAddress: string
  myFavorites: string
  contactService: string
  langSwitchLabel: string
  bindTgProfileTitle: string
  bindTgProfileSub: string
  alreadyBoundTitle: string
  alreadyBoundSub: string
  couponCenter: string
  couponAvailable: string
  couponUsed: string
  couponExpired: string
  emptyCoupons: string
  tabMenu: string
  tabProfile: string
  comingSoon: string
  myOrdersEntry: string
  assetSectionTitle: string
  // ── 本轮补充：取餐 / 备注 / 优惠 / 推荐徽标 ────────────────────────────
  orderTypeLabel: string
  pickup: string
  dineIn: string
  delivery: string
  remarksLabel: string
  remarksPh: string
  couponLabel: string
  noCoupon: string
  discountLabel: string
  recommendBadge: string
  storeLabel: string
}> = {
  zh: {
    open:             '营业中',
    closed:           '已打烊',
    sold:             '已售',
    notSelected:      '尚未选购',
    itemCount:        (n) => `共 ${n} 件商品`,
    checkout:         '去结算',
    selectFirst:      '请选商品',
    loading:          '加载中…',
    empty:            '暂无商品',
    errNoCode:        '请通过有效的商品页链接访问',
    errNotFound:      '门店不存在或已暂停营业',
    errNetwork:       '网络错误，请刷新重试',
    submitting:       '提交中…',
    orderSubmitted:   '订单已提交',
    orderHint:        '商家收到订单后将与您联系',
    orderNo:          '订单号',
    errSubmitProduct: '部分商品已下架，请刷新后重试',
    errSubmitFail:    '提交失败，请重试',
    retryCart:        '继续选购',
    statusPending:    '待商家确认',
    orderHint2:       '商家确认后将为您备货/处理',
    confirmTitle:     '确认订单',
    confirmSubmit:    '确认提交',
    backToEdit:       '返回修改',
    bindTgBtn:        '📲 绑定 Telegram，接收 {store} 订单通知',
    bindTgHint:       '绑定后可在 Telegram 查看订单进度、再次点单',
    profileTitle:     '个人中心',
    guestUser:        '顾客',
    normalMember:     '普通顾客',
    vipMember:        '会员',
    balance:          '余额',
    coupon:           '优惠券',
    voucher:          '抵扣券',
    points:           '积分',
    myAddress:        '我的地址',
    myFavorites:      '我的收藏',
    contactService:   '联系客服',
    langSwitchLabel:  '语言',
    bindTgProfileTitle: '关注本店，接收订单通知',
    bindTgProfileSub:   '绑定 Telegram 获取订单进度和优惠提醒',
    alreadyBoundTitle:  '已绑定 Telegram',
    alreadyBoundSub:    '可在 Telegram 接收订单和优惠通知',
    couponCenter:     '优惠券中心',
    couponAvailable:  '可用',
    couponUsed:       '已使用',
    couponExpired:    '已过期',
    emptyCoupons:     '暂无优惠券',
    tabMenu:          '点单',
    tabProfile:       '我的',
    comingSoon:       '该功能开发中，敬请期待',
    myOrdersEntry:    '我的订单',
    assetSectionTitle: '我的资产',
    orderTypeLabel:   '取餐方式',
    pickup:           '到店自取',
    dineIn:           '堂食',
    delivery:         '外卖送货上门',
    remarksLabel:     '备注',
    remarksPh:        '少辣、不要葱…（可选）',
    couponLabel:      '优惠券',
    noCoupon:         '暂无可用优惠券',
    discountLabel:    '已优惠',
    recommendBadge:   '推荐',
    storeLabel:       '门店',
  },
  en: {
    open:             'Open',
    closed:           'Closed',
    sold:             'Sold',
    notSelected:      'No items yet',
    itemCount:        (n) => `${n} item${n === 1 ? '' : 's'}`,
    checkout:         'Checkout',
    selectFirst:      'Select items',
    loading:          'Loading…',
    empty:            'No products',
    errNoCode:        'Please open via a valid menu link',
    errNotFound:      'Store not found or unavailable',
    errNetwork:       'Network error, please refresh',
    submitting:       'Submitting…',
    orderSubmitted:   'Order submitted',
    orderHint:        'The merchant will contact you shortly',
    orderNo:          'Order No.',
    errSubmitProduct: 'Some items are unavailable, please refresh',
    errSubmitFail:    'Submit failed, please try again',
    retryCart:        'Continue shopping',
    statusPending:    'Awaiting confirmation',
    orderHint2:       'Merchant will prepare your order upon confirmation',
    confirmTitle:     'Confirm Order',
    confirmSubmit:    'Submit Order',
    backToEdit:       'Back',
    bindTgBtn:        '📲 Bind Telegram for {store} Updates',
    bindTgHint:       'Get order notifications and reorder easily',
    profileTitle:     'Profile',
    guestUser:        'Customer',
    normalMember:     'Regular',
    vipMember:        'VIP',
    balance:          'Balance',
    coupon:           'Coupons',
    voucher:          'Vouchers',
    points:           'Points',
    myAddress:        'My Address',
    myFavorites:      'Favorites',
    contactService:   'Support',
    langSwitchLabel:  'Language',
    bindTgProfileTitle: 'Follow this store on Telegram',
    bindTgProfileSub:   'Bind Telegram for order updates and promos',
    alreadyBoundTitle:  'Telegram Bound',
    alreadyBoundSub:    'You will receive order and promo updates',
    couponCenter:     'Coupons',
    couponAvailable:  'Available',
    couponUsed:       'Used',
    couponExpired:    'Expired',
    emptyCoupons:     'No coupons yet',
    tabMenu:          'Menu',
    tabProfile:       'Me',
    comingSoon:       'Coming soon',
    myOrdersEntry:    'My Orders',
    assetSectionTitle: 'My Assets',
    orderTypeLabel:   'Order Type',
    pickup:           'Pickup',
    dineIn:           'Dine in',
    delivery:         'Delivery',
    remarksLabel:     'Remarks',
    remarksPh:        'Less spicy, no onions… (optional)',
    couponLabel:      'Coupon',
    noCoupon:         'No coupons available',
    discountLabel:    'Discount',
    recommendBadge:   'HOT',
    storeLabel:       'Store',
  },
  km: {
    open:             'កំពុងបើក',
    closed:           'បិទ',
    sold:             'បានលក់',
    notSelected:      'មិនទាន់ជ្រើស',
    itemCount:        (n) => `${n} មុខ`,
    checkout:         'ទូទាត់',
    selectFirst:      'ជ្រើសទំនិញ',
    loading:          'កំពុងផ្ទុក…',
    empty:            'គ្មានទំនិញ',
    errNoCode:        'សូមចូលតាមតំណភ្ជាប់ត្រឹមត្រូវ',
    errNotFound:      'រកមិនឃើញហាង',
    errNetwork:       'បញ្ហាបណ្តាញ សូមផ្ទុកឡើងវិញ',
    submitting:       'កំពុងដាក់ស្នើ…',
    orderSubmitted:   'បញ្ជាទិញបានដាក់ស្នើ',
    orderHint:        'ម្ចាស់ហាងនឹងទាក់ទងអ្នក',
    orderNo:          'លេខបញ្ជា',
    errSubmitProduct: 'ទំនិញខ្លះអស់ហើយ សូម refresh ហើយព្យាយាមម្តងទៀត',
    errSubmitFail:    'ដាក់ស្នើបរាជ័យ សូមព្យាយាមម្តងទៀត',
    retryCart:        'ជ្រើសទំនិញម្តងទៀត',
    statusPending:    'រង់ចាំការបញ្ជាក់',
    orderHint2:       'ម្ចាស់ហាងនឹងរៀបចំទំនិញបន្ទាប់ពីបញ្ជាក់',
    confirmTitle:     'បញ្ជាក់បញ្ជាទិញ',
    confirmSubmit:    'ដាក់ស្នើ',
    backToEdit:       'ត្រឡប់',
    bindTgBtn:        '📲 ភ្ជាប់ Telegram ដើម្បីទទួលដំណឹង {store}',
    bindTgHint:       'មើលស្ថានភាព និងបញ្ជាទិញម្តងទៀតបាន',
    profileTitle:     'ប្រវត្តិរូប',
    guestUser:        'អតិថិជន',
    normalMember:     'អតិថិជនធម្មតា',
    vipMember:        'សមាជិក',
    balance:          'សមតុល្យ',
    coupon:           'គូប៉ុង',
    voucher:          'ប័ណ្ណបញ្ចុះ',
    points:           'ពិន្ទុ',
    myAddress:        'អាសយដ្ឋាន',
    myFavorites:      'ចំណូលចិត្ត',
    contactService:   'ទំនាក់ទំនង',
    langSwitchLabel:  'ភាសា',
    bindTgProfileTitle: 'តាមដានហាងនេះតាម Telegram',
    bindTgProfileSub:   'ភ្ជាប់ Telegram ដើម្បីទទួលដំណឹង និងការផ្សព្វផ្សាយ',
    alreadyBoundTitle:  'បានភ្ជាប់ Telegram',
    alreadyBoundSub:    'អ្នកនឹងទទួលដំណឹង',
    couponCenter:     'គូប៉ុង',
    couponAvailable:  'ប្រើបាន',
    couponUsed:       'បានប្រើ',
    couponExpired:    'អស់សុពលភាព',
    emptyCoupons:     'គ្មានគូប៉ុង',
    tabMenu:          'ម៉ឺនុយ',
    tabProfile:       'ខ្ញុំ',
    comingSoon:       'កំពុងអភិវឌ្ឍ',
    myOrdersEntry:    'បញ្ជាទិញរបស់ខ្ញុំ',
    assetSectionTitle: 'ទ្រព្យសម្បត្តិរបស់ខ្ញុំ',
    orderTypeLabel:   'ប្រភេទបញ្ជា',
    pickup:           'យកដោយខ្លួនឯង',
    dineIn:           'ហូបនៅហាង',
    delivery:         'ដឹកជញ្ជូនដល់ផ្ទះ',
    remarksLabel:     'កំណត់ចំណាំ',
    remarksPh:        'មិនហឹរ មិនដាក់ខ្ទឹមបារាំង… (ស្រេចចិត្ត)',
    couponLabel:      'គូប៉ុង',
    noCoupon:         'គ្មានគូប៉ុង',
    discountLabel:    'បញ្ចុះតម្លៃ',
    recommendBadge:   'ពេញនិយម',
    storeLabel:       'ហាង',
  },
}

const LANG_LABELS: Record<Lang, string> = { zh: '中', en: 'EN', km: 'ខ្មែរ' }

// ─── 分类标签翻译 ─────────────────────────────────────────────────────────────

const ALL_CAT: ML = { zh: '全部商品', en: 'All Items', km: 'ទំនិញទាំងអស់' }
const UNCATEGORIZED: ML = { zh: '其他', en: 'Others', km: 'ផ្សេងៗ' }

// 分类名前端 fallback 多语言映射（key = 后端中文名 trim 后；未命中则原样返回）
const CAT_MAP: Record<string, ML> = {
  '全部':       ALL_CAT,
  '全部商品':   ALL_CAT,
  '其他':       UNCATEGORIZED,

  // 主食类
  '主食':       { zh: '主食',   en: 'Main',         km: 'អាហារសំខាន់' },
  '主菜':       { zh: '主菜',   en: 'Main',         km: 'អាហារសំខាន់' },
  '套餐':       { zh: '套餐',   en: 'Combo',        km: 'ឈុត' },
  '米饭':       { zh: '米饭',   en: 'Rice',         km: 'បាយ' },
  '面条':       { zh: '面条',   en: 'Noodles',      km: 'មី' },
  '面食':       { zh: '面食',   en: 'Noodles',      km: 'មី' },

  // 副食/菜品
  '小吃':       { zh: '小吃',   en: 'Snacks',       km: 'អាហារសម្រន់' },
  '零食':       { zh: '零食',   en: 'Snacks',       km: 'អាហារសម្រន់' },
  '炒菜':       { zh: '炒菜',   en: 'Stir-fry',     km: 'បំពង' },
  '烧烤':       { zh: '烧烤',   en: 'BBQ',          km: 'អាំង' },
  '凉菜':       { zh: '凉菜',   en: 'Cold Dishes',  km: 'អាហារត្រជាក់' },
  '汤':         { zh: '汤',     en: 'Soup',         km: 'ស៊ុប' },
  '汤类':       { zh: '汤类',   en: 'Soup',         km: 'ស៊ុប' },

  // 饮料类
  '饮料':       { zh: '饮料',   en: 'Drinks',       km: 'ភេសជ្ជៈ' },
  '酒水':       { zh: '酒水',   en: 'Beverages',    km: 'ភេសជ្ជៈ' },
  '咖啡':       { zh: '咖啡',   en: 'Coffee',       km: 'កាហ្វេ' },
  '奶茶':       { zh: '奶茶',   en: 'Milk Tea',     km: 'តែទឹកដោះ' },
  '果汁':       { zh: '果汁',   en: 'Juice',        km: 'ទឹកផ្លែឈើ' },

  // 甜品 / 烘焙
  '甜品':       { zh: '甜品',   en: 'Dessert',      km: 'បង្អែម' },
  '蛋糕':       { zh: '蛋糕',   en: 'Cake',         km: 'នំខេក' },
  '面包':       { zh: '面包',   en: 'Bread',        km: 'នំប៉័ង' },

  // 其它
  '日化用品':   { zh: '日化用品', en: 'Daily Goods', km: 'ប្រើប្រាស់ប្រចាំថ្ងៃ' },
  '宠物用品':   { zh: '宠物用品', en: 'Pet Supplies', km: 'សម្រាប់សត្វចិញ្ចឹម' },
  '方便食品':   { zh: '方便食品', en: 'Instant Food', km: 'អាហារភ្លាមៗ' },
}

function categoryLabel(name: string, lang: Lang): string {
  const entry = CAT_MAP[name.trim()]
  return entry ? gl(entry, lang) : name
}

// ─── 商品视觉预设（无图片时按 index 循环取色/图标） ──────────────────────────

const CARD_COLORS = [
  '#ffe8e8', '#fff4e0', '#e8f0ff', '#e8f4ff', '#fef4e8',
  '#fef8e0', '#f0e8de', '#ffe8de', '#eeeeee', '#fff0e0',
  '#fdf0e0', '#e8f5e8', '#e8f8f0', '#f5f0e8',
]
const CARD_EMOJIS = [
  '🛍️', '📦', '🏷️', '✨', '⭐', '💫', '🎯',
  '🎁', '🎀', '💎', '🌟', '🔖', '🍀', '🎪',
]

// ─── API 响应类型 ────────────────────────────────────────────────────────────

type ApiCategory = {
  id: string
  name: string
  parentId: string | null
  sortOrder: number
}

type ApiProduct = {
  id: string
  name:   string
  nameZh: string | null
  nameEn: string | null
  nameKm: string | null
  descZh: string | null
  descEn: string | null
  descKm: string | null
  spec:   string | null
  price:  number
  categoryId: string | null
  imageUrl:   string | null
}

type ApiStore = {
  name: string
  isOpen: boolean
  bannerUrl:    string | null
  announcement: string | null
  promoText:    string | null
  businessType?: 'FOOD' | 'RETAIL' | 'SERVICE' | 'GENERAL'
}

type BizType = 'FOOD' | 'RETAIL' | 'SERVICE' | 'GENERAL'
type FulfillTpl = { title: string; dineIn: string; delivery: string }
const FULFILLMENT_TPL: Record<'zh' | 'en' | 'km', Record<BizType, FulfillTpl>> = {
  zh: {
    FOOD:    { title: '取餐方式', dineIn: '堂食/自取', delivery: '外卖送货' },
    RETAIL:  { title: '获取方式', dineIn: '到店自取', delivery: '送货上门' },
    SERVICE: { title: '服务方式', dineIn: '到店服务', delivery: '上门服务' },
    GENERAL: { title: '获取方式', dineIn: '到店',     delivery: '送货/上门' },
  },
  en: {
    FOOD:    { title: 'Dining option',   dineIn: 'Dine in or pickup', delivery: 'Delivery' },
    RETAIL:  { title: 'How to receive',  dineIn: 'Store pickup',      delivery: 'Delivery' },
    SERVICE: { title: 'Service option',  dineIn: 'In-store service',  delivery: 'On-site service' },
    GENERAL: { title: 'How to receive',  dineIn: 'In-store',          delivery: 'Delivery or on-site' },
  },
  km: {
    FOOD:    { title: 'ប្រភេទបញ្ជា',     dineIn: 'ហូបនៅហាង / យកនៅហាង', delivery: 'ដឹកជញ្ជូនដល់ផ្ទះ' },
    RETAIL:  { title: 'វិធីទទួល',         dineIn: 'យកនៅហាង',             delivery: 'ដឹកដល់ផ្ទះ' },
    SERVICE: { title: 'វិធីផ្តល់សេវា',    dineIn: 'សេវានៅហាង',           delivery: 'សេវាដល់ផ្ទះ' },
    GENERAL: { title: 'វិធីទទួល',         dineIn: 'នៅហាង',               delivery: 'ដឹក / ដល់ផ្ទះ' },
  },
}

// ─── 商品多语言 fallback ───────────────────────────────────────────────────────

function pName(p: ApiProduct, lang: Lang): string {
  if (lang === 'en') return p.nameEn || p.nameZh || p.name
  if (lang === 'km') return p.nameKm || p.nameZh || p.name
  return p.nameZh || p.name
}

function pDesc(p: ApiProduct, lang: Lang): string | null {
  if (lang === 'en') return p.descEn || p.descZh || null
  if (lang === 'km') return p.descKm || p.descZh || null
  return p.descZh || null
}

// ─── 购物车 ──────────────────────────────────────────────────────────────────

type CartItem = { id: string; quantity: number; sugar?: string }
type CouponBrief = {
  id: string
  name: string
  type: 'AMOUNT_OFF' | 'PERCENT_OFF'
  amountOff: number | null
  percentOff: number | null
  minSpend: number
  expiresAt: string
  reason?: 'MIN_NOT_MET' | 'EXPIRED' | 'NOT_FOUND' | 'OTHER'
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function MenuPage() {
  const [lang,        setLang]        = useState<Lang>('zh')
  const [cart,        setCart]        = useState<CartItem[]>([])
  const [storeData,   setStoreData]   = useState<ApiStore | null>(null)
  const [apiProducts, setApiProducts] = useState<ApiProduct[]>([])
  const [categories,  setCategories]  = useState<ApiCategory[]>([])
  const [activeCatId, setActiveCatId] = useState<string | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [fetchError,  setFetchError]  = useState('')
  const [submitting,   setSubmitting]  = useState(false)
  const [orderResult,  setOrderResult] = useState<{ orderNo: string; totalAmount: number } | null>(null)
  const [submitError,  setSubmitError] = useState('')
  const [showConfirm,  setShowConfirm] = useState(false)
  const [storeCode,    setStoreCode]   = useState('')
  const [hasTgId,      setHasTgId]     = useState(false)
  const [customerBound, setCustomerBound] = useState(false)
  const [lightboxUrl,  setLightboxUrl] = useState<string | null>(null)
  // 搜索 + 购物车展开
  const [searchKeyword, setSearchKeyword] = useState('')
  const [cartExpand,    setCartExpand]    = useState(false)
  // 结算选项（取餐方式 + 备注 + 优惠券 + 配送地址）
  const [pickupMethod,  setPickupMethod]  = useState<'dineIn' | 'delivery'>('dineIn')
  const [orderRemark,   setOrderRemark]   = useState('')
  // 配送地址（仅 delivery 用）
  const [deliveryEditOpen, setDeliveryEditOpen] = useState(false)
  const [addrQuickOpen, setAddrQuickOpen] = useState(false)
  const [deliveryInfo, setDeliveryInfo] = useState<{
    customerName: string; customerPhone: string
    deliveryAddress: string; deliveryNote: string
    deliveryLat: number | null; deliveryLng: number | null
    deliveryAddressPhotoUrl: string | null
  }>({ customerName: '', customerPhone: '', deliveryAddress: '', deliveryNote: '', deliveryLat: null, deliveryLng: null, deliveryAddressPhotoUrl: null })
  // 优惠券
  const [campaignCode,   setCampaignCode]   = useState('')
  const [campaignIntent, setCampaignIntent] = useState('')
  const [tgId, setTgId]                         = useState<string>('')
  const [selectedCouponId, setSelectedCouponId] = useState<string | null>(null)
  const [couponPickerOpen, setCouponPickerOpen] = useState(false)
  const [couponMsg, setCouponMsg]               = useState<string>('')
  const [couponState, setCouponState] = useState<{
    available:   CouponBrief[]
    unavailable: CouponBrief[]
    selectedCoupon: CouponBrief | null
    discountAmount: number
    payableAmount:  number
  } | null>(null)
  const [sugarModal, setSugarModal] = useState<string | null>(null)   // productId pending sugar choice
  const [pendingSugar, setPendingSugar] = useState('50')

  const ui         = T[lang]
  const bizType: BizType = (storeData?.businessType ?? 'GENERAL') as BizType
  const fulfillTpl = (FULFILLMENT_TPL[lang] ?? FULFILLMENT_TPL.zh)[bizType] ?? FULFILLMENT_TPL[lang].GENERAL
  const cartTotal  = cart.reduce((s, c) => s + (apiProducts.find(p => p.id === c.id)?.price ?? 0) * c.quantity, 0)
  const payableLabel = lang === 'en' ? 'Payable' : lang === 'km' ? 'ត្រូវបង់' : '应付'
  const couponDoneLabel = lang === 'en' ? 'Done' : lang === 'km' ? 'យល់ព្រម' : '完成'
  const noneLabel       = lang === 'en' ? 'None'  : lang === 'km' ? 'គ្មាន'   : '不使用'

  // 在确认弹窗开启 / 购物车变动 / 选中券变动时，重新拉可用券与折扣金额
  useEffect(() => {
    if (!showConfirm || !storeCode || cartTotal <= 0) { setCouponState(null); return }
    if (!tgId) {
      // 未识别到 telegramId，无法发券，置空但允许下单
      setCouponState({ available: [], unavailable: [], selectedCoupon: null, discountAmount: 0, payableAmount: cartTotal })
      return
    }
    let aborted = false
    fetch('/api/public/coupons/available', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeCode, telegramId: tgId, subtotal: +cartTotal.toFixed(2), couponId: selectedCouponId ?? undefined }),
    }).then((r) => r.json()).then((b) => {
      if (aborted) return
      if (b?.error) {
        setCouponState({ available: [], unavailable: [], selectedCoupon: null, discountAmount: 0, payableAmount: cartTotal })
        return
      }
      setCouponState({
        available:      b.available ?? [],
        unavailable:    b.unavailable ?? [],
        selectedCoupon: b.selectedCoupon ?? null,
        discountAmount: Number(b.discountAmount ?? 0),
        payableAmount:  Number(b.payableAmount ?? cartTotal),
      })
      // 若传入的 selectedCouponId 不在 available，前端清掉并提示
      if (selectedCouponId && !b.selectedCoupon) {
        const u = (b.unavailable ?? []).find((c: CouponBrief) => c.id === selectedCouponId)
        setSelectedCouponId(null)
        setCouponMsg(u?.reason === 'MIN_NOT_MET' ? `需满足最低消费方可使用` : `该优惠券不可用`)
      } else {
        setCouponMsg('')
      }
    }).catch(() => { /* 静默：仍允许下单 */ })
    return () => { aborted = true }
  }, [showConfirm, storeCode, tgId, cartTotal, selectedCouponId])
  const cartCount  = cart.reduce((s, c) => s + c.quantity, 0)
  const canCheckout = cartCount > 0
  const confirmItems = cart.flatMap((c) => {
    const p = apiProducts.find((ap) => ap.id === c.id)
    if (!p) return []
    return [{ ...p, quantity: c.quantity, lineAmount: p.price * c.quantity, sugar: c.sugar }]
  })

  // ── 分类分组计算 ──────────────────────────────────────────────────────────
  const l1Cats = categories.filter((c) => !c.parentId).sort((a, b) => {
    const isIcedA = /冰咖啡|iced\s*coffee/i.test(a.name)
    const isIcedB = /冰咖啡|iced\s*coffee/i.test(b.name)
    if (isIcedA && !isIcedB) return -1
    if (!isIcedA && isIcedB) return 1
    return 0
  })
  const hasL1Cats = l1Cats.length > 0
  const l2ByParent = new Map<string, ApiCategory[]>()
  categories.filter((c) => c.parentId).forEach((c) => {
    const arr = l2ByParent.get(c.parentId!) ?? []
    arr.push(c)
    l2ByParent.set(c.parentId!, arr)
  })
  const allCatIds = new Set(categories.map((c) => c.id))

  type Group = { gid: string; title: string; items: ApiProduct[] }

  // 搜索关键词（在分类分组前应用，命中名称/规格的商品都保留）
  const kw = searchKeyword.trim().toLowerCase()
  const filteredProducts = kw
    ? apiProducts.filter(
        (p) =>
          pName(p, lang).toLowerCase().includes(kw) ||
          p.name.toLowerCase().includes(kw) ||
          (p.spec ?? '').toLowerCase().includes(kw),
      )
    : apiProducts

  const displayGroups: Group[] = (() => {
    if (!hasL1Cats) {
      return filteredProducts.length > 0
        ? [{ gid: '__all', title: gl(ALL_CAT, lang), items: filteredProducts }]
        : []
    }

    if (activeCatId === null) {
      const groups: Group[] = []
      for (const l1 of l1Cats) {
        const l2Ids = new Set((l2ByParent.get(l1.id) ?? []).map((c) => c.id))
        const items = filteredProducts.filter(
          (p) => p.categoryId === l1.id || (p.categoryId !== null && l2Ids.has(p.categoryId)),
        )
        if (items.length > 0) groups.push({ gid: l1.id, title: categoryLabel(l1.name, lang), items })
      }
      const uncategorized = filteredProducts.filter((p) => !p.categoryId || !allCatIds.has(p.categoryId))
      if (uncategorized.length > 0) {
        groups.push({ gid: '__other', title: gl(UNCATEGORIZED, lang), items: uncategorized })
      }
      return groups
    } else {
      const l1Name = l1Cats.find((c) => c.id === activeCatId)?.name ?? ''
      const l2s = l2ByParent.get(activeCatId) ?? []
      const groups: Group[] = []
      const directItems = filteredProducts.filter((p) => p.categoryId === activeCatId)
      if (directItems.length > 0) groups.push({ gid: activeCatId + '_d', title: categoryLabel(l1Name, lang), items: directItems })
      for (const l2 of l2s) {
        const items = filteredProducts.filter((p) => p.categoryId === l2.id)
        if (items.length > 0) groups.push({ gid: l2.id, title: categoryLabel(l2.name, lang), items })
      }
      return groups
    }
  })()

  // ── Telegram Mini App 适配 ───────────────────────────────────────────────
  // TelegramInit.tsx 对 /menu 路径早返回，不会调用 expand()，需要自行初始化
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    if (!tg) return
    tg.expand?.()           // 强制全屏，避免半屏弹出
    tg.ready?.()            // 通知 Telegram WebApp 加载完成，隐藏加载动画
    // 用 Telegram BackButton 替代顶部自定义返回按钮（如在 Telegram 内）
    if (tg.BackButton) {
      tg.BackButton.show()
      tg.BackButton.onClick(() => tg.close())
    }
    return () => {
      tg.BackButton?.hide()
      tg.BackButton?.offClick()
    }
  }, [])

  // ── 同步浏览器/Mini App 页面标题为当前门店名 ───────────────────────────
  useEffect(() => {
    document.title = (storeData?.name && storeData.name.trim()) || '店小二'
  }, [storeData?.name])

  // ── 购物车持久化（localStorage，与 /me 页共享 storeCode 维度） ───────────
  useEffect(() => {
    if (!storeCode) return
    try {
      const saved = localStorage.getItem(`cart_${storeCode}`)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) setCart(parsed)
      }
    } catch { /* ignore */ }
  }, [storeCode])
  useEffect(() => {
    if (!storeCode) return
    try { localStorage.setItem(`cart_${storeCode}`, JSON.stringify(cart)) } catch { /* ignore */ }
  }, [cart, storeCode])

  // 配送地址持久化（按 storeCode）
  useEffect(() => {
    if (!storeCode) return
    try {
      const saved = localStorage.getItem(`menu_delivery_${storeCode}`)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && typeof parsed === 'object') setDeliveryInfo((v) => ({ ...v, ...parsed }))
      }
    } catch { /* ignore */ }
  }, [storeCode])
  useEffect(() => {
    if (!storeCode) return
    try { localStorage.setItem(`menu_delivery_${storeCode}`, JSON.stringify(deliveryInfo)) } catch { /* ignore */ }
  }, [deliveryInfo, storeCode])

  // ── 语言偏好持久化（与 /me 共享） ───────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem('menu_lang') as Lang | null
      if (saved && (['zh', 'en', 'km'] as Lang[]).includes(saved)) setLang(saved)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('menu_lang', lang) } catch { /* ignore */ }
  }, [lang])

  // ── 数据加载 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp

    // storeCode 来源优先级：URL ?code= > Telegram start_param > 报错
    // start_param 用于 t.me/bot?startapp=<storeCode> 格式的入口链接
    const urlCode = new URLSearchParams(window.location.search).get('code')
    const urlRef    = new URLSearchParams(window.location.search).get('ref')    || ''
    const urlIntent = new URLSearchParams(window.location.search).get('intent') || ''
    if (urlRef)    setCampaignCode(urlRef)
    if (urlIntent) setCampaignIntent(urlIntent)
    const startParam: string =
      new URLSearchParams(window.location.hash.slice(1)).get('tgWebAppStartParam') ||
      tg?.initDataUnsafe?.start_param ||
      ''
    // bind_ 前缀是员工绑定 token，不是 storeCode；仅接受非 bind_ 参数作为 storeCode
    const code = urlCode || (startParam && !startParam.startsWith('bind_') ? startParam : null)
    if (!code) {
      setLoading(false)
      setFetchError('no_code')
      return
    }
    setStoreCode(code)
    let tgIdLocal: string | null = null
    if (tg?.initData) {
      try {
        const userStr = new URLSearchParams(tg.initData).get('user')
        if (userStr) {
          const u = JSON.parse(userStr)
          if (u?.id != null) {
            tgIdLocal = String(u.id)
            setHasTgId(true)
            setTgId(tgIdLocal)
          }
        }
      } catch { /* 解析失败则不显示入口 */ }
    }

    // 读取 URL 的 couponId（可能来自 /me/coupons 的「去使用」）
    const initCouponId = new URLSearchParams(window.location.search).get('couponId')
    if (initCouponId) setSelectedCouponId(initCouponId)

    const menuUrl = `/api/public/menu?code=${encodeURIComponent(code)}` +
      (tgIdLocal ? `&tgId=${encodeURIComponent(tgIdLocal)}` : '')

    fetch(menuUrl)
      .then((r) => r.json())
      .then((body) => {
        if (body.error) {
          setFetchError(body.error)
        } else {
          setStoreData(body.store)
          setApiProducts(body.products ?? [])
          setCategories(body.categories ?? [])
          setCustomerBound(!!body.customerBound)
          // 记录到 E-Life 最近访问店铺（localStorage + 后端双写）
          try {
            const entry = { code, name: body.store.name as string, lastVisitedAt: new Date().toISOString() }
            const prev: { code: string }[] = JSON.parse(localStorage.getItem('eLife_recentStores') ?? '[]')
            const next = [entry, ...prev.filter((s) => s.code !== code)].slice(0, 8)
            localStorage.setItem('eLife_recentStores', JSON.stringify(next))
          } catch { /* localStorage 不可用时静默 */ }
          // 异步上报后端（仅 Telegram WebApp 内），fire-and-forget，不阻塞页面
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tgWA = (window as any).Telegram?.WebApp
          if (tgWA?.initData) {
            fetch('/api/e-life/recent-stores/visit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ initData: tgWA.initData, storeCode: code }),
            }).catch(() => { /* 静默失败，localStorage 已兜底 */ })
          }
        }
      })
      .catch(() => setFetchError('NETWORK_ERROR'))
      .finally(() => setLoading(false))
  }, [])

  const SUGAR_SPEC_RE = /no\s*sugar|无糖|微糖|半糖|少糖|正常糖|(?:25|50|75|100)%/i

  function needsSugar(productId: string): boolean {
    const p = apiProducts.find((ap) => ap.id === productId)
    if (!p) return false
    // Primary: spec explicitly lists sugar options
    if (p.spec && SUGAR_SPEC_RE.test(p.spec)) return true
    // Fallback: category is coffee-type
    if (!p.categoryId) return false
    const cat = categories.find((c) => c.id === p.categoryId)
    if (!cat) return false
    const parentName = cat.parentId ? (categories.find((c) => c.id === cat.parentId)?.name ?? '') : ''
    return /coffee|咖啡/i.test(cat.name) || /coffee|咖啡/i.test(parentName)
  }

  function sugarLabel(sugar: string): string {
    if (lang === 'zh') {
      if (sugar === 'no_sugar') return '无糖'
      if (sugar === '25')       return '微糖 25%'
      if (sugar === '50')       return '半糖 50%'
      if (sugar === '75')       return '少糖 75%'
      if (sugar === '100')      return '正常糖 100%'
    } else {
      // en and km both use English (no km sugar translations in project)
      if (sugar === 'no_sugar') return 'No sugar'
      if (sugar === '25')       return '25% sugar'
      if (sugar === '50')       return '50% sugar'
      if (sugar === '75')       return '75% sugar'
      if (sugar === '100')      return '100% sugar'
    }
    return sugar
  }

  function addToCart(id: string, sugar?: string) {
    setCart((prev) => {
      const found = prev.find((c) => c.id === id && c.sugar === sugar)
      if (found) return prev.map((c) => c.id === id && c.sugar === sugar ? { ...c, quantity: c.quantity + 1 } : c)
      return [...prev, { id, quantity: 1, sugar }]
    })
  }

  function removeFromCart(id: string, sugar?: string) {
    setCart((prev) =>
      prev.map((c) => c.id === id && c.sugar === sugar ? { ...c, quantity: c.quantity - 1 } : c).filter((c) => c.quantity > 0),
    )
  }

  function removeFromCartAny(id: string) {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.id === id)
      if (idx === -1) return prev
      const updated = prev.map((c, i) => i === idx ? { ...c, quantity: c.quantity - 1 } : c)
      return updated.filter((c) => c.quantity > 0)
    })
  }

  function handleAddClick(productId: string) {
    if (needsSugar(productId)) {
      setPendingSugar('50')
      setSugarModal(productId)
    } else {
      addToCart(productId)
    }
  }

  async function handleCheckout() {
    if (!canCheckout || submitting) return
    const code = new URLSearchParams(window.location.search).get('code')
    if (!code) return

    // 尝试从 Telegram WebApp 获取顾客身份（普通浏览器会 null）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    let customerTelegramId: string | null = null
    if (tg?.initData) {
      try {
        const userStr = new URLSearchParams(tg.initData).get('user')
        if (userStr) customerTelegramId = String(JSON.parse(userStr).id)
      } catch { /* 解析失败则保持 null */ }
    }

    setSubmitting(true)
    setSubmitError('')

    // 把取餐方式 + 顾客备注合并为 remark 字段透传给 API（API 写入 CustomerOrder.remark）
    const methodLabel = pickupMethod === 'dineIn' ? fulfillTpl.dineIn : fulfillTpl.delivery
    const remarkLines = [`${fulfillTpl.title}: ${methodLabel}`]
    if (orderRemark.trim()) remarkLines.push(`${T[lang].remarksLabel}: ${orderRemark.trim()}`)
    const remark = remarkLines.join(' | ')

    try {
      const res = await fetch('/api/public/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeCode: code,
          items: cart.map((c) => ({ productId: c.id, quantity: c.quantity, ...(c.sugar ? { sugar: c.sugar } : {}) })),
          ...(customerTelegramId ? { customerTelegramId } : {}),
          ...(selectedCouponId ? { couponId: selectedCouponId } : {}),
          pickupMethod,
          ...(pickupMethod === 'delivery' ? {
            customerName:    deliveryInfo.customerName    || undefined,
            customerPhone:   deliveryInfo.customerPhone   || undefined,
            deliveryAddress: deliveryInfo.deliveryAddress || undefined,
            deliveryNote:    deliveryInfo.deliveryNote    || undefined,
            ...(deliveryInfo.deliveryLat != null && deliveryInfo.deliveryLng != null
              ? { deliveryLat: deliveryInfo.deliveryLat, deliveryLng: deliveryInfo.deliveryLng } : {}),
            ...(deliveryInfo.deliveryAddressPhotoUrl
              ? { deliveryAddressPhotoUrl: deliveryInfo.deliveryAddressPhotoUrl } : {}),
          } : {}),
          remark,
          lang,
          ...(campaignCode ? { campaignCode, campaignIntent } : {}),
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        const msg =
          body.error === 'DELIVERY_INFO_REQUIRED'? (body.message ?? '请填写联系电话和送货/上门地址') :
          body.error === 'PRODUCT_UNAVAILABLE'   ? ui.errSubmitProduct :
          body.error === 'COUPON_ALREADY_USED'   ? '该优惠券已被使用，请重新选择' :
          body.error === 'COUPON_INVALID'        ? '优惠券不可用' :
          body.error === 'COUPON_EXPIRED'        ? '优惠券已过期' :
          body.error === 'COUPON_MIN_NOT_MET'    ? (body.message ?? '未满最低消费') :
          body.error === 'COUPON_NEED_TG'        ? '使用优惠券需绑定 Telegram 身份' :
          ui.errSubmitFail
        setSubmitError(msg)
        if (typeof body.error === 'string' && body.error.startsWith('COUPON_')) setSelectedCouponId(null)
        return
      }
      setOrderResult({ orderNo: body.orderNo, totalAmount: body.totalAmount })
      setCart([])
      setOrderRemark('')
      setPickupMethod('dineIn')
      setSelectedCouponId(null)
      setShowConfirm(false)
      // 写本设备订单号到 localStorage（按 storeCode 维度，供 /menu/orders 非 TG 路径查询）
      try {
        const key = `menu_orders_${code}`
        const prev = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
        const next = [body.orderNo, ...prev.filter((n) => n !== body.orderNo)].slice(0, 30)
        localStorage.setItem(key, JSON.stringify(next))
      } catch { /* localStorage 不可用时静默 */ }
    } catch {
      setSubmitError(ui.errSubmitFail)
    } finally {
      setSubmitting(false)
    }
  }

  // ── 加载态 ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={s.centerPage}>
        <div style={{ color: '#ccc', fontSize: 14 }}>{T.zh.loading}</div>
      </div>
    )
  }

  // ── 错误态 ────────────────────────────────────────────────────────────────
  if (fetchError) {
    const msg =
      fetchError === 'no_code'      ? ui.errNoCode :
      fetchError === 'STORE_NOT_FOUND' ? ui.errNotFound :
      ui.errNetwork
    return (
      <div style={s.centerPage}>
        <div style={s.errCard}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: 15, color: '#333', fontWeight: 600, textAlign: 'center' }}>{msg}</div>
          <div style={s.langSwitcherErr}>
            {(['zh', 'en', 'km'] as Lang[]).map((l) => (
              <button key={l} style={{ ...s.langBtnPlain, ...(lang === l ? s.langBtnPlainOn : {}) }} onClick={() => setLang(l)}>
                {LANG_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── 正常态 ────────────────────────────────────────────────────────────────
  const storeName = (storeData?.name && storeData.name.trim()) || '店小二'
  const isOpen    = storeData?.isOpen ?? false

  return (
    <>
      <main style={s.page}>

        {/* ── Sticky 顶部条：仅搜索 + 语言切换（门店名只在下方门头展示一次） ── */}
        <div style={s.stickyTopWrap}>
          <div style={s.searchRow}>
            <span style={s.searchIcon}>🔍</span>
            <input
              style={s.searchInput}
              type="text"
              placeholder={lang === 'zh' ? '搜索商品…' : lang === 'en' ? 'Search products…' : 'ស្វែងរកទំនិញ…'}
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
            />
            {searchKeyword && (
              <button type="button" style={s.searchClear} onClick={() => setSearchKeyword('')}>×</button>
            )}
            <div style={s.stickyLangs}>
              {(['zh', 'en', 'km'] as Lang[]).map((l) => (
                <button
                  key={l}
                  style={{ ...s.stickyLangBtn, ...(lang === l ? s.stickyLangBtnOn : {}) }}
                  onClick={() => setLang(l)}
                >
                  {LANG_LABELS[l]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── 1. 顶部门店头图 ── */}
        <div style={{
          ...s.banner,
          ...(storeData?.bannerUrl ? {
            backgroundImage: `url(${storeData.bannerUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          } : {}),
        }}>
          <div style={s.bannerMask} />
          <button style={s.circleBtn} onClick={() => history.back()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>

        {/* ── 2. 门店信息卡片 ── */}
        <div style={s.storeCard}>
          <div style={s.storeLogo}>🏪</div>
          <div style={s.storeBody}>
            <div style={s.storeTopRow}>
              <span style={s.storeName}>{storeName}</span>
              <span style={isOpen ? s.openBadge : s.closedBadge}>
                {isOpen ? ui.open : ui.closed}
              </span>
            </div>
          </div>
        </div>

        {/* ── 活动播报 ── */}
        {storeData?.announcement && (
          <div style={s.announcementBar}>
            <span style={s.announcementIcon}>🎁</span>
            <span style={s.announcementText}>{storeData.announcement}</span>
          </div>
        )}

        {/* ── 活动文案条 ── */}
        {storeData?.promoText && (
          <div style={s.promoBar}>
            <span style={s.promoIcon}>🎉</span>
            <span style={s.promoText}>{storeData.promoText}</span>
          </div>
        )}

        {/* ── 快捷入口（优惠券/订单/收藏/地址） ── */}
        <div style={s.quickEntryRow}>
          <Link href={`/me/coupons?code=${encodeURIComponent(storeCode)}`} style={s.quickEntry}>
            <span style={s.quickEntryIcon}>🎟️</span>
            <span style={s.quickEntryLabel}>
              {lang === 'zh' ? '优惠券' : lang === 'en' ? 'Coupons' : 'គូប៉ុង'}
            </span>
          </Link>
          <Link
            href={storeCode ? `/menu/orders?code=${storeCode}` : '/menu'}
            style={s.quickEntry}
          >
            <span style={s.quickEntryIcon}>📦</span>
            <span style={s.quickEntryLabel}>
              {lang === 'zh' ? '订单' : lang === 'en' ? 'Orders' : 'បញ្ជា'}
            </span>
          </Link>
          <button
            type="button"
            style={s.quickEntry}
            onClick={() => alert(lang === 'zh' ? '收藏即将开放' : lang === 'en' ? 'Favorites coming soon' : 'កំពុងអភិវឌ្ឍ')}
          >
            <span style={s.quickEntryIcon}>⭐</span>
            <span style={s.quickEntryLabel}>
              {lang === 'zh' ? '收藏' : lang === 'en' ? 'Favs' : 'ចំណូល'}
            </span>
          </button>
          <button
            type="button"
            style={s.quickEntry}
            onClick={() => {
              // 有历史外卖地址 → 弹快速确认；否则直接进入地图/地址编辑
              if (deliveryInfo.deliveryAddress && deliveryInfo.deliveryAddress.trim()) {
                setAddrQuickOpen(true)
              } else {
                setPickupMethod('delivery')
                setDeliveryEditOpen(true)
              }
            }}
          >
            <span style={s.quickEntryIcon}>📍</span>
            <span style={s.quickEntryLabel}>
              {lang === 'zh' ? '地址' : lang === 'en' ? 'Address' : 'អាសយដ្ឋាន'}
            </span>
          </button>
        </div>

        {/* ── 3. 商品展示区（左分类栏 / 右商品） ── */}
        <div style={hasL1Cats ? s.catRightLayout : { marginTop: 4 }}>
          {/* 左侧竖向分类栏 */}
          {hasL1Cats && (
            <div style={s.catLeftSidebar}>
              <button
                type="button"
                style={{ ...s.catLeftItem, ...(activeCatId === null ? s.catLeftItemOn : {}) }}
                onClick={() => setActiveCatId(null)}
              >
                {gl(ALL_CAT, lang)}
              </button>
              {l1Cats.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  style={{ ...s.catLeftItem, ...(activeCatId === cat.id ? s.catLeftItemOn : {}) }}
                  onClick={() => setActiveCatId(cat.id)}
                >
                  {categoryLabel(cat.name, lang)}
                </button>
              ))}
            </div>
          )}

          <div style={s.productCol}>
            {displayGroups.length === 0 ? (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: '#ccc', fontSize: 14 }}>
                {ui.empty}
              </div>
            ) : (
              displayGroups.map(({ gid, title, items }) => (
                <div key={gid}>
                  <div style={s.catHeading}>{title}</div>
                  {items.map((product, idx) => {
                    const qty   = cart.filter((c) => c.id === product.id).reduce((s, c) => s + c.quantity, 0)
                    const color = CARD_COLORS[idx % CARD_COLORS.length]
                    const emoji = CARD_EMOJIS[idx % CARD_EMOJIS.length]
                    return (
                      <div key={product.id} style={s.productCard}>
                        {product.imageUrl ? (
                          <div
                            style={{ ...s.productImg, background: '#f5f5f5', overflow: 'hidden', cursor: 'zoom-in' }}
                            onClick={() => setLightboxUrl(product.imageUrl)}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={product.imageUrl}
                              alt={product.name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          </div>
                        ) : (
                          <div style={{ ...s.productImg, background: color }}>
                            <span style={s.productEmoji}>{emoji}</span>
                          </div>
                        )}
                        <div style={s.productMeta}>
                          <div style={s.productName}>
                            {pName(product, lang)}
                            {idx === 0 && <span style={s.recommendBadge}>{ui.recommendBadge}</span>}
                          </div>
                          {product.spec && <div style={s.productSpec}>{product.spec}</div>}
                          {pDesc(product, lang) && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, lineHeight: 1.4 }}>{pDesc(product, lang)}</div>}
                          <div style={s.productFoot}>
                            <span style={s.productPrice}>
                              <span style={s.priceSign}>$</span>{product.price.toFixed(2)}
                            </span>
                            {qty === 0 ? (
                              <button style={s.addBtn} onClick={() => handleAddClick(product.id)}>
                                <span style={s.plus}>+</span>
                              </button>
                            ) : (
                              <div style={s.qtyRow}>
                                <button style={s.qtyMinus} onClick={() => removeFromCartAny(product.id)}>−</button>
                                <span style={s.qtyNum}>{qty}</span>
                                <button style={s.qtyPlus} onClick={() => handleAddClick(product.id)}>+</button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      </main>

      {/* ── 糖度选择弹窗 ── */}
      {sugarModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 900, display: 'flex', alignItems: 'flex-end' }}
          onClick={() => setSugarModal(null)}
        >
          <div
            style={{ width: '100%', background: '#fff', borderRadius: '16px 16px 0 0', padding: '20px 20px 32px', boxSizing: 'border-box' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16, textAlign: 'center', color: '#1a1a1a' }}>
              {lang === 'en' ? 'Sugar level' : lang === 'km' ? 'កម្រិតស្ករ' : '糖度选择'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              {(['no_sugar', '25', '50', '75', '100'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPendingSugar(s)}
                  style={{
                    padding: '10px 0',
                    borderRadius: 10,
                    border: pendingSugar === s ? '2px solid var(--blue, #2563eb)' : '2px solid #e5e7eb',
                    background: pendingSugar === s ? '#eff6ff' : '#fafafa',
                    color: pendingSugar === s ? 'var(--blue, #2563eb)' : '#374151',
                    fontWeight: pendingSugar === s ? 700 : 400,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  {sugarLabel(s)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { addToCart(sugarModal, pendingSugar); setSugarModal(null) }}
              style={{
                width: '100%', padding: '13px 0', borderRadius: 12, border: 'none',
                background: 'var(--blue, #2563eb)', color: '#fff', fontWeight: 700, fontSize: 16, cursor: 'pointer',
              }}
            >
              {lang === 'en' ? 'Add to cart' : lang === 'km' ? 'បន្ថែមទៅរទេះ' : '加入购物车'}
            </button>
          </div>
        </div>
      )}

      {/* ── 商品图放大查看 ── */}
      {lightboxUrl && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            cursor: 'zoom-out',
          }}
          onClick={() => setLightboxUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }}
          />
          <button
            type="button"
            aria-label="close"
            onClick={(e) => { e.stopPropagation(); setLightboxUrl(null) }}
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.18)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.3)',
              fontSize: 20,
              lineHeight: 1,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── 下单确认弹层 ── */}
      {!orderResult && showConfirm && (
        <div style={s.successOverlay}>
          <div style={s.confirmModal}>
            {/* 固定头部 */}
            <div style={s.confirmHeader}>
              <span style={s.confirmHeaderIcon}>📋</span>
              <span style={s.confirmHeaderTitle}>{ui.confirmTitle}</span>
            </div>

            {/* 可滚动内容区 */}
            <div style={s.confirmBody}>
              {/* 门店行 */}
              <div style={s.chkRow}>
                <span style={s.chkRowKey}>📍 {ui.storeLabel}</span>
                <span style={s.chkRowVal}>{storeName}</span>
              </div>

              {/* 商品清单 */}
              <div style={s.confirmItemList}>
                {confirmItems.map((item, idx) => (
                  <div key={item.id + (item.sugar ?? '') + idx} style={s.confirmItem}>
                    <div style={s.confirmItemName}>
                      {pName(item, lang)}
                      {item.spec && <span style={s.confirmItemSpec}> · {item.spec}</span>}
                      {item.sugar && <span style={s.confirmItemSpec}> · {sugarLabel(item.sugar)}</span>}
                    </div>
                    <div style={s.confirmItemRight}>
                      <span style={s.confirmItemQty}>×{item.quantity}</span>
                      <span style={s.confirmItemAmt}>${item.lineAmount.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* 配送/上门地址卡片（仅 delivery 显示） */}
              {pickupMethod === 'delivery' && (
                <button type="button" style={addr.card} onClick={() => setDeliveryEditOpen(true)}>
                  {deliveryInfo.deliveryAddress ? (
                    <>
                      <div style={addr.addrLine}>📍 {deliveryInfo.deliveryAddress}</div>
                      <div style={addr.subLine}>
                        {deliveryInfo.customerName ? `${deliveryInfo.customerName} · ` : ''}
                        {deliveryInfo.customerPhone || ''}
                        {(deliveryInfo.deliveryLat != null && deliveryInfo.deliveryLng != null) && '  ·  📌 已获取定位'}
                      </div>
                      {deliveryInfo.deliveryNote && <div style={addr.noteLine}>{deliveryInfo.deliveryNote}</div>}
                      {deliveryInfo.deliveryAddressPhotoUrl && (
                        <div style={addr.noteLine}>📷 {lang === 'en' ? 'photo attached' : lang === 'km' ? 'រូបភាពភ្ជាប់' : '已附门牌照片'}</div>
                      )}
                    </>
                  ) : (
                    <div style={addr.placeholder}>
                      📍 {lang === 'en' ? 'Please add delivery / on-site address ›'
                         : lang === 'km' ? 'សូមបន្ថែមអាសយដ្ឋានដឹក/សេវាដល់ផ្ទះ ›'
                         : '请填写送货/上门地址 ›'}
                    </div>
                  )}
                </button>
              )}

              {/* 取餐方式 */}
              <div style={s.chkSection}>
                <div style={s.chkSectionLabel}>{fulfillTpl.title}</div>
                <div style={s.chkPickupRow}>
                  {(['dineIn', 'delivery'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      style={{ ...s.chkPickupBtn, ...(pickupMethod === m ? s.chkPickupBtnOn : {}) }}
                      onClick={() => setPickupMethod(m)}
                    >
                      {m === 'dineIn' ? `🍽️ ${fulfillTpl.dineIn}` : `🛵 ${fulfillTpl.delivery}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* 备注 */}
              <div style={s.chkSection}>
                <div style={s.chkSectionLabel}>{ui.remarksLabel}</div>
                <textarea
                  style={s.chkRemarks}
                  rows={2}
                  placeholder={ui.remarksPh}
                  value={orderRemark}
                  onChange={(e) => setOrderRemark(e.target.value.slice(0, 200))}
                />
              </div>

              {/* 优惠券选择 */}
              <div
                style={{ ...s.chkRow, cursor: (couponState && (couponState.available.length > 0 || selectedCouponId)) ? 'pointer' : 'default' }}
                onClick={() => { if (couponState && (couponState.available.length > 0 || couponState.selectedCoupon)) setCouponPickerOpen(true) }}
              >
                <span style={s.chkRowKey}>🎟️ {ui.couponLabel}</span>
                <span style={s.chkRowMuted}>
                  {couponState?.selectedCoupon
                    ? couponState.selectedCoupon.name
                    : couponState && couponState.available.length > 0
                      ? `${couponState.available.length} 张可用 ›`
                      : ui.noCoupon}
                </span>
              </div>
              {couponMsg && <div style={{ ...s.chkRow, color: '#fa8c16', fontSize: 12 }}>{couponMsg}</div>}

              {/* 商品金额 */}
              <div style={s.chkRow}>
                <span style={s.chkRowKey}>{ui.itemCount(cartCount)}</span>
                <span style={s.chkRowMuted}>${cartTotal.toFixed(2)}</span>
              </div>

              {/* 优惠合计 */}
              <div style={s.chkRow}>
                <span style={s.chkRowKey}>{ui.discountLabel}</span>
                <span style={s.chkRowMuted}>-${(couponState?.discountAmount ?? 0).toFixed(2)}</span>
              </div>

              <div style={s.confirmTotal}>
                <span style={s.confirmTotalLabel}>{payableLabel}</span>
                <span style={s.confirmTotalAmount}>${(couponState?.payableAmount ?? cartTotal).toFixed(2)}</span>
              </div>
              {submitError && <div style={s.confirmErr}>{submitError}</div>}
            </div>

            {/* 固定底部操作栏 */}
            <div style={s.confirmFooter}>
              <div style={s.confirmBtns}>
                <button
                  style={s.confirmBackBtn}
                  onClick={() => { setShowConfirm(false); setSubmitError('') }}
                >
                  {ui.backToEdit}
                </button>
                <button
                  style={{ ...s.confirmSubmitBtn, ...(submitting ? s.confirmSubmitBtnDisabled : {}) }}
                  disabled={submitting}
                  onClick={handleCheckout}
                >
                  {submitting ? ui.submitting : ui.confirmSubmit}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 优惠券选择弹窗 ── */}
      {couponPickerOpen && couponState && (
        <div style={cpk.mask} onClick={() => setCouponPickerOpen(false)}>
          <div style={cpk.panel} onClick={(e) => e.stopPropagation()}>
            <div style={cpk.title}>🎟️ {ui.couponLabel}</div>
            <div style={cpk.list}>
              <label style={{ ...cpk.item, ...(selectedCouponId == null ? cpk.itemOn : {}) }}>
                <input type="radio" checked={selectedCouponId == null} onChange={() => setSelectedCouponId(null)} style={{ marginRight: 8 }} />
                <div style={{ flex: 1, fontWeight: 600 }}>{noneLabel}</div>
              </label>
              {couponState.available.map((c) => (
                <label key={c.id} style={{ ...cpk.item, ...(selectedCouponId === c.id ? cpk.itemOn : {}) }}>
                  <input type="radio" checked={selectedCouponId === c.id} onChange={() => setSelectedCouponId(c.id)} style={{ marginRight: 8 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                      {c.type === 'AMOUNT_OFF' ? `满 $${c.minSpend.toFixed(2)} 减 $${(c.amountOff ?? 0).toFixed(2)}` : `${c.percentOff ?? 0}% off · 满 $${c.minSpend.toFixed(2)}`}
                    </div>
                  </div>
                </label>
              ))}
              {couponState.unavailable.filter((c) => c.name).map((c) => (
                <div key={c.id} style={{ ...cpk.item, opacity: 0.5 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: '#fa8c16', marginTop: 2 }}>
                      {c.reason === 'MIN_NOT_MET' ? `未满 $${c.minSpend.toFixed(2)} 不可用` : '不可用'}
                    </div>
                  </div>
                </div>
              ))}
              {couponState.available.length === 0 && couponState.unavailable.filter((c) => c.name).length === 0 && (
                <div style={cpk.empty}>{ui.noCoupon}</div>
              )}
            </div>
            <button type="button" style={cpk.done} onClick={() => setCouponPickerOpen(false)}>{couponDoneLabel}</button>
          </div>
        </div>
      )}

      {/* ── 地址快速确认弹层（首页地址快捷入口） ── */}
      {addrQuickOpen && (
        <AddressQuickModal
          info={deliveryInfo}
          lang={lang}
          onClose={() => setAddrQuickOpen(false)}
          onUse={() => {
            setAddrQuickOpen(false)
            setPickupMethod('delivery')
          }}
          onEdit={() => {
            setAddrQuickOpen(false)
            setPickupMethod('delivery')
            setDeliveryEditOpen(true)
          }}
        />
      )}

      {/* ── 配送/上门地址编辑弹层 ── */}
      {deliveryEditOpen && (
        <DeliveryEditModal
          initial={deliveryInfo}
          lang={lang}
          onClose={() => setDeliveryEditOpen(false)}
          onSave={(v) => { setDeliveryInfo(v); setDeliveryEditOpen(false) }}
        />
      )}

      {/* ── 下单成功覆盖弹层 ── */}
      {orderResult && (
        <div style={s.successOverlay}>
          <div style={s.successModal}>
            <div style={s.successCheckCircle}>✓</div>
            <div style={s.successModalStoreName}>{storeName}</div>
            <div style={s.successModalTitle}>{ui.orderSubmitted}</div>
            <div style={s.successModalOrderNo}>{orderResult.orderNo}</div>
            <div style={s.successStatusPill}>
              <span style={{ color: '#fa8c16', marginRight: 4 }}>●</span>
              {ui.statusPending}
            </div>
            <div style={s.successModalHint}>{ui.orderHint2}</div>
            <div style={s.successModalAmount}>${orderResult.totalAmount.toFixed(2)}</div>

            {CUSTOMER_BOT && storeCode && !customerBound && (
              <>
                <a
                  href={`https://t.me/${CUSTOMER_BOT}?start=bind_${encodeURIComponent(storeCode)}${orderResult.orderNo ? `_${encodeURIComponent(orderResult.orderNo)}` : ''}`}
                  target="_blank"
                  rel="noreferrer"
                  style={s.bindTgBtn}
                >
                  {ui.bindTgBtn.replace('{store}', storeName)}
                </a>
                <div style={s.bindTgHint}>{ui.bindTgHint}</div>
              </>
            )}

            <button
              style={s.retryBtnFull}
              onClick={() => { setOrderResult(null); setSubmitError(''); setShowConfirm(false) }}
            >
              {ui.retryCart}
            </button>
            {storeCode && (
              <a href={`/menu/orders?code=${storeCode}`} style={s.myOrdersBtnLink}>
                {lang === 'zh' ? '查看订单进度 →' : lang === 'en' ? 'View Order Status →' : 'មើលស្ថានភាព →'}
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── 购物车展开面板（仅在 cart 非空且 cartExpand 为 true 时显示） ── */}
      {cartExpand && cart.length > 0 && (
        <div style={s.cartExpandMask} onClick={() => setCartExpand(false)}>
          <div style={s.cartExpandPanel} onClick={(e) => e.stopPropagation()}>
            <div style={s.cartExpandHeader}>
              <span style={s.cartExpandTitle}>
                {lang === 'zh' ? `已选 ${cartCount} 件` : lang === 'en' ? `${cartCount} item(s)` : `${cartCount} មុខ`}
              </span>
              <button type="button" style={s.cartExpandClear} onClick={() => setCart([])}>
                {lang === 'zh' ? '清空' : lang === 'en' ? 'Clear' : 'សម្អាត'}
              </button>
            </div>
            <div style={s.cartExpandList}>
              {cart.map((c) => {
                const p = apiProducts.find((ap) => ap.id === c.id)
                if (!p) return null
                const itemKey = c.id + (c.sugar ?? '')
                const specParts = [p.spec, c.sugar ? sugarLabel(c.sugar) : null].filter(Boolean)
                return (
                  <div key={itemKey} style={s.cartItemRow}>
                    <div style={s.cartItemInfo}>
                      <div style={s.cartItemName}>{pName(p, lang)}</div>
                      {specParts.length > 0 && <div style={s.cartItemSpec}>{specParts.join(' · ')}</div>}
                    </div>
                    <div style={s.cartItemRight}>
                      <span style={s.cartItemPrice}>${(p.price * c.quantity).toFixed(2)}</span>
                      <div style={s.cartItemQtyRow}>
                        <button style={s.qtyMinus} onClick={() => removeFromCart(c.id, c.sugar)}>−</button>
                        <span style={s.qtyNum}>{c.quantity}</span>
                        <button style={s.qtyPlus} onClick={() => needsSugar(c.id) ? (setPendingSugar(c.sugar ?? '50'), setSugarModal(c.id)) : addToCart(c.id, c.sugar)}>+</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── 底部购物车浮层 ── */}
      <div style={s.cartBar}>
        <div style={{ ...s.cartLeft, cursor: cart.length > 0 ? 'pointer' : 'default' }}
             onClick={() => cart.length > 0 && setCartExpand((v) => !v)}>
          <div style={s.cartIconBox}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" color="#fff">
              <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
            </svg>
            {cartCount > 0 && (
              <span style={s.cartBadge}>{cartCount > 99 ? '99+' : cartCount}</span>
            )}
          </div>
          <div>
            <div style={{ ...s.cartAmount, color: cartCount > 0 ? PRIMARY : '#bbb' }}>
              ${cartTotal.toFixed(2)}
            </div>
            <div style={{ ...s.cartHint, color: submitError ? '#ff4d4f' : '#c0c0c0' }}>
              {submitError || (cartCount === 0 ? ui.notSelected : ui.itemCount(cartCount))}
              {cartCount > 0 && !submitError && (
                <span style={s.discountInline}> · {ui.discountLabel} $0.00</span>
              )}
            </div>
          </div>
        </div>
        <button
          style={{ ...s.checkoutBtn, ...(canCheckout && !submitting ? s.checkoutBtnOn : {}) }}
          disabled={!canCheckout || submitting}
          onClick={() => { setCartExpand(false); setShowConfirm(true) }}
        >
          {submitting ? ui.submitting : canCheckout ? ui.checkout : ui.selectFirst}
        </button>
      </div>

      {/* ── 顾客底部导航（首页/点单/订单/消息/我的） ── */}
      <CustomerBottomNav code={storeCode} lang={lang} />
    </>
  )
}

// ─── 样式 ─────────────────────────────────────────────────────────────────────

const BANNER_BG = [
  'repeating-linear-gradient(-45deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 1px, transparent 1px, transparent 14px)',
  'radial-gradient(ellipse at 75% 80%, rgba(255,220,100,0.30) 0%, transparent 52%)',
  'radial-gradient(ellipse at 18% 22%, rgba(255,255,255,0.20) 0%, transparent 44%)',
  'linear-gradient(148deg, #ffb347 0%, #ff6b00 52%, #e84e00 100%)',
].join(', ')

const s: Record<string, React.CSSProperties> = {

  centerPage: {
    minHeight: '100dvh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f0f0f0',
    padding: 24,
  },
  errCard: {
    background: '#fff',
    borderRadius: 16,
    padding: '32px 24px',
    maxWidth: 320,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
  },
  langSwitcherErr: {
    display: 'flex',
    gap: 4,
    marginTop: 4,
  },
  langBtnPlain: {
    border: '1px solid #e0e0e0',
    background: '#fff',
    color: '#888',
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 12,
    cursor: 'pointer',
  },
  langBtnPlainOn: {
    borderColor: PRIMARY,
    color: PRIMARY,
    background: '#fff5ee',
  },

  page: {
    maxWidth: 480,
    margin: '0 auto',
    background: '#f0f0f0',
    minHeight: '100dvh',
    paddingBottom: 148, // cart bar (~80) + bottom nav (56) + safe-area
  },

  // ── Sticky 顶部条 ──
  stickyTop: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 30,
    background: '#fff',
    borderBottom: '1px solid #ebebeb',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    minHeight: 48,
    boxSizing: 'border-box' as const,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  stickyLogo: {
    fontSize: 18,
    flexShrink: 0,
    lineHeight: 1,
  },
  stickyName: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden' as const,
  },
  stickyNameText: {
    fontSize: 14,
    fontWeight: 700,
    color: '#1a1a1a',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
    minWidth: 0,
  },
  stickyLangs: {
    display: 'flex',
    background: '#f5f5f5',
    borderRadius: 14,
    padding: 2,
    gap: 1,
    flexShrink: 0,
  },
  stickyLangBtn: {
    border: 'none',
    background: 'transparent',
    color: '#888',
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 8px',
    borderRadius: 12,
    cursor: 'pointer',
    lineHeight: 1.4,
  },
  stickyLangBtnOn: {
    background: '#fff',
    color: PRIMARY,
    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
  },
  // ── 新增：sticky 顶部容器 + 搜索栏 ──
  stickyTopWrap: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 30,
    background: '#fff',
    borderBottom: '1px solid #ebebeb',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 12px 8px',
    background: '#fff',
  },
  searchIcon: { fontSize: 14, color: '#999', flexShrink: 0 },
  searchInput: {
    flex: 1,
    height: 36,
    padding: '0 14px',
    border: '1px solid #ececec',
    borderRadius: 18,
    fontSize: 13,
    background: '#fafafa',
    color: '#1a1a1a',
    outline: 'none',
  },
  searchClear: {
    width: 26, height: 26,
    border: 'none', background: 'transparent',
    color: '#999', fontSize: 18, cursor: 'pointer', lineHeight: 1,
  },
  // ── 快捷入口 ──
  quickEntryRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1fr',
    background: '#fff',
    margin: '10px 12px 0',
    padding: '14px 4px',
    borderRadius: 14,
    boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
  },
  quickEntry: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 4,
    background: 'transparent',
    border: 'none',
    textDecoration: 'none',
    color: 'inherit',
    cursor: 'pointer',
  },
  quickEntryIcon: {
    fontSize: 20, lineHeight: 1,
    width: 40, height: 40, borderRadius: 12,
    background: '#f6f7f9',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  quickEntryLabel: { fontSize: 11, color: '#666', fontWeight: 600, letterSpacing: '0.02em' },
  // ── 横向分类 tab ──
  catTabsScroll: {
    display: 'flex',
    gap: 18,
    overflowX: 'auto' as const,
    padding: '8px 16px 6px',
    background: '#fff',
    marginTop: 1,
    position: 'sticky' as const,
    top: 84,
    zIndex: 25,
    borderBottom: '1px solid #f0f0f0',
    WebkitOverflowScrolling: 'touch' as const,
  },
  catTabBtn: {
    flexShrink: 0,
    padding: '6px 0 8px',
    fontSize: 13,
    fontWeight: 500,
    color: '#888',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    letterSpacing: '0.01em',
  },
  catTabBtnOn: {
    color: '#1a1a1a',
    fontWeight: 700,
    borderBottom: `2px solid ${PRIMARY}`,
  },
  // ── 右侧竖向分类栏 ──
  catRightLayout: {
    display: 'flex',
    alignItems: 'flex-start' as const,
    marginTop: 4,
  },
  catLeftSidebar: {
    width: 76,
    flexShrink: 0,
    background: '#fafafa',
    borderRight: '1px solid #ebebeb',
    display: 'flex',
    flexDirection: 'column' as const,
    position: 'sticky' as const,
    top: 56,
    maxHeight: 'calc(100dvh - 56px - 80px - 56px - env(safe-area-inset-bottom))',
    overflowY: 'auto' as const,
    minHeight: 180,
  },
  catLeftItem: {
    padding: '12px 6px',
    background: 'none',
    border: 'none',
    borderLeft: '3px solid transparent',
    fontSize: 12,
    fontWeight: 500,
    color: '#666',
    textAlign: 'center' as const,
    lineHeight: 1.4,
    cursor: 'pointer',
    wordBreak: 'break-all' as const,
  },
  catLeftItemOn: {
    background: '#fff',
    borderLeftColor: PRIMARY,
    color: PRIMARY,
    fontWeight: 700,
  },
  // ── 购物车展开面板 ──
  cartExpandMask: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    zIndex: 55,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  cartExpandPanel: {
    width: '100%',
    maxWidth: 480,
    background: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '60dvh',
    marginBottom: 'calc(80px + 56px + env(safe-area-inset-bottom))',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden' as const,
  },
  cartExpandHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid #eee',
    background: '#fafafa',
  },
  cartExpandTitle: { fontSize: 14, fontWeight: 700, color: '#1a1a1a' },
  cartExpandClear: {
    fontSize: 13, color: '#fa541c',
    background: 'transparent', border: 'none',
    cursor: 'pointer', fontWeight: 600,
  },
  cartExpandList: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '0 16px',
  },
  cartItemRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 0',
    borderBottom: '1px solid #f5f5f5',
  },
  cartItemInfo: { flex: 1, minWidth: 0 },
  cartItemName: { fontSize: 14, fontWeight: 600, color: '#1a1a1a' },
  cartItemSpec: { fontSize: 11, color: '#aaa', marginTop: 2 },
  cartItemRight: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-end',
    gap: 6,
    flexShrink: 0,
  },
  cartItemPrice: { fontSize: 14, fontWeight: 700, color: PRIMARY },
  cartItemQtyRow: { display: 'flex', alignItems: 'center', gap: 8 },
  // ── 推荐徽标（商品名旁） ──
  recommendBadge: {
    display: 'inline-block',
    marginLeft: 6,
    padding: '1px 6px',
    borderRadius: 4,
    background: `${PRIMARY}1a`,
    color: PRIMARY,
    fontSize: 10,
    fontWeight: 800,
    verticalAlign: 'middle' as const,
    letterSpacing: '0.04em',
  },
  // ── cartBar 优惠内联文本 ──
  discountInline: {
    color: '#fa8c16',
    fontWeight: 600,
  },
  // ── confirm modal 行 + 分段 ──
  chkRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 0',
    borderTop: '1px solid #f5f5f5',
    fontSize: 13,
  },
  chkRowKey: { color: '#666', fontWeight: 600 },
  chkRowVal: { color: '#1a1a1a', fontWeight: 700, maxWidth: '65%', textAlign: 'right' as const, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  chkRowMuted: { color: '#aaa', fontWeight: 500 },
  chkSection: {
    padding: '10px 0',
    borderTop: '1px solid #f5f5f5',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  chkSectionLabel: { fontSize: 12, color: '#888', fontWeight: 600 },
  chkPickupRow: { display: 'flex', gap: 8 },
  chkPickupBtn: {
    flex: 1,
    height: 36,
    background: '#fafafa',
    border: '1px solid #e5e5e5',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    color: '#666',
    cursor: 'pointer',
  },
  chkPickupBtnOn: {
    background: `${PRIMARY}15`,
    borderColor: PRIMARY,
    color: PRIMARY,
  },
  chkRemarks: {
    width: '100%',
    fontSize: 13,
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid #e5e5e5',
    background: '#fafafa',
    color: '#1a1a1a',
    outline: 'none',
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
    lineHeight: 1.5,
  },

  banner: {
    height: 112,
    background: BANNER_BG,
    position: 'relative',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '14px 14px 10px',
  },
  bannerMask: {
    position: 'absolute',
    top: 0, right: 0, bottom: 0, left: 0,
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0) 55%)',
    pointerEvents: 'none',
  },
  circleBtn: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.30)',
    border: 'none',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    position: 'relative',
    zIndex: 1,
    flexShrink: 0,
  },

  langSwitcher: {
    display: 'flex',
    background: 'rgba(0,0,0,0.28)',
    borderRadius: 20,
    padding: 2,
    gap: 1,
    position: 'relative',
    zIndex: 1,
  },
  langBtn: {
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.70)',
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 9px',
    borderRadius: 16,
    cursor: 'pointer',
    lineHeight: 1.4,
  },
  langBtnOn: {
    background: '#fff',
    color: PRIMARY,
  },

  storeCard: {
    background: '#fff',
    margin: '0 12px',
    marginTop: -36,
    borderRadius: 16,
    padding: '16px 16px 14px',
    boxShadow: '0 6px 24px rgba(0,0,0,0.08), 0 1px 0 rgba(255,255,255,0.6) inset',
    display: 'flex',
    gap: 14,
    alignItems: 'center',
    position: 'relative',
    zIndex: 2,
  },
  storeLogo: {
    width: 60,
    height: 60,
    borderRadius: 14,
    background: `linear-gradient(135deg, #fff7eb, #ffe7d0)`,
    border: '1px solid rgba(255,140,40,0.18)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 30,
    flexShrink: 0,
    boxShadow: `0 4px 12px rgba(255,140,40,0.18)`,
  },
  storeBody: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    justifyContent: 'center',
  },
  storeTopRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  storeName: {
    fontSize: 21,
    fontWeight: 800,
    color: '#1a1a1a',
    letterSpacing: '-0.3px',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  openBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: '#52c41a',
    background: 'rgba(82,196,26,0.10)',
    border: 'none',
    borderRadius: 999,
    padding: '3px 10px',
    letterSpacing: '0.04em',
  },
  closedBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: '#8c8c8c',
    background: 'rgba(140,140,140,0.10)',
    border: 'none',
    borderRadius: 999,
    padding: '3px 10px',
    letterSpacing: '0.04em',
  },

  productCol: {
    flex: 1,
    minWidth: 0,
  },
  catHeading: {
    fontSize: 11,
    fontWeight: 600,
    color: '#aaa',
    padding: '12px 16px 6px',
    background: '#f0f0f0',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  // ── 分类左右布局 ──
  catLayout: {
    display: 'flex',
    alignItems: 'flex-start',
    marginTop: 8,
  },
  catSidebar: {
    width: 76,
    flexShrink: 0,
    background: '#ebebeb',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 0,
    minHeight: 200,
    position: 'sticky' as const,
    top: 48,
    alignSelf: 'flex-start' as const,
    maxHeight: 'calc(100dvh - 48px - 92px)',
    overflowY: 'auto' as const,
  },
  catSideItem: {
    width: '100%',
    padding: '14px 6px',
    background: 'none',
    border: 'none',
    borderLeft: '3px solid transparent',
    fontSize: 12,
    fontWeight: 500,
    color: '#666',
    textAlign: 'center' as const,
    lineHeight: 1.4,
    cursor: 'pointer',
    wordBreak: 'break-all' as const,
  },
  catSideItemOn: {
    background: '#fff',
    borderLeftColor: PRIMARY,
    color: PRIMARY,
    fontWeight: 700,
  },
  catContent: {
    flex: 1,
    minWidth: 0,
  },

  productCard: {
    background: '#fff',
    marginBottom: 1,
    padding: '18px 16px',
    display: 'flex',
    gap: 14,
    alignItems: 'flex-start',
  },
  productImg: {
    width: 92,
    height: 92,
    borderRadius: 14,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
  },
  productEmoji: {
    fontSize: 36,
  },
  productMeta: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingTop: 2,
  },
  productName: {
    fontSize: 15,
    fontWeight: 600,
    color: '#111',
    lineHeight: 1.35,
  },
  productSpec: {
    fontSize: 12,
    color: '#aaa',
    lineHeight: 1.3,
  },
  productFoot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  productPrice: {
    fontSize: 19,
    fontWeight: 800,
    color: '#e53e3e',
    lineHeight: 1,
  },
  priceSign: {
    fontSize: 12,
    fontWeight: 700,
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: PRIMARY,
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    boxShadow: `0 3px 10px ${PRIMARY}55`,
  },
  plus: {
    color: '#fff',
    fontSize: 22,
    lineHeight: 1,
    fontWeight: 300,
  },
  qtyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  qtyMinus: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    border: `1.5px solid ${PRIMARY}`,
    background: '#fff',
    color: PRIMARY,
    fontSize: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    lineHeight: 1,
    fontWeight: 500,
  },
  qtyNum: {
    fontSize: 15,
    fontWeight: 700,
    color: '#1a1a1a',
    minWidth: 16,
    textAlign: 'center',
  },
  qtyPlus: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    background: PRIMARY,
    border: 'none',
    color: '#fff',
    fontSize: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    lineHeight: 1,
    fontWeight: 300,
    boxShadow: `0 3px 10px ${PRIMARY}55`,
  },

  cartBar: {
    position: 'fixed',
    bottom: 'calc(56px + env(safe-area-inset-bottom) + 10px)',
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'calc(100% - 20px)',
    maxWidth: 464,
    background: 'linear-gradient(135deg, #2a2a35 0%, #161620 100%)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 32,
    padding: '10px 14px 10px 16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    boxShadow: '0 10px 32px rgba(0,0,0,0.32), 0 2px 6px rgba(0,0,0,0.18)',
    zIndex: 60,
  },

  // 下单成功态 — 全屏覆盖弹层
  successOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex',
    alignItems: 'flex-end',      // 底部对齐，bottom sheet 样式
    justifyContent: 'center',
    zIndex: 200,
    padding: 0,
  },
  successModal: {
    background: '#fff',
    borderRadius: 20,
    padding: '36px 28px 28px',
    width: '100%',
    maxWidth: 340,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
  },
  successCheckCircle: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: '#52c41a',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 4,
  },
  successModalStoreName: {
    fontSize: 13,
    fontWeight: 600,
    color: '#888',
    marginBottom: 4,
    textAlign: 'center' as const,
    maxWidth: 280,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  successModalTitle: {
    fontSize: 20,
    fontWeight: 800,
    color: '#1a1a1a',
  },
  successModalOrderNo: {
    fontSize: 11,
    color: '#bbb',
    letterSpacing: '0.06em',
    fontVariantNumeric: 'tabular-nums',
  },
  successStatusPill: {
    display: 'flex',
    alignItems: 'center',
    background: '#fff7e6',
    border: '1px solid #ffe58f',
    borderRadius: 20,
    padding: '5px 14px',
    fontSize: 13,
    fontWeight: 600,
    color: '#fa8c16',
    marginTop: 2,
  },
  successModalHint: {
    fontSize: 13,
    color: '#8c8c8c',
    textAlign: 'center',
    lineHeight: 1.5,
    marginTop: 2,
  },
  successModalAmount: {
    fontSize: 26,
    fontWeight: 800,
    color: '#1677ff',
    letterSpacing: '-0.5px',
    marginTop: 2,
  },
  retryBtnFull: {
    marginTop: 8,
    width: '100%',
    background: PRIMARY,
    color: '#fff',
    border: 'none',
    borderRadius: 24,
    padding: '14px 0',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  announcementBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    margin: '10px 12px 0',
    padding: '12px 14px',
    background: 'linear-gradient(135deg, #fff4e8 0%, #ffe2c7 100%)',
    border: '1px solid rgba(255,140,40,0.18)',
    borderRadius: 14,
    boxShadow: '0 2px 10px rgba(255,140,40,0.08)',
  },
  announcementIcon: { fontSize: 20, lineHeight: 1, flexShrink: 0 },
  announcementText: { fontSize: 13, color: '#7a4a00', lineHeight: 1.45, fontWeight: 600 },

  promoBar: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '10px 16px',
    background: 'linear-gradient(90deg, #fff5ee 0%, #fff0e6 100%)',
    borderBottom: '1px solid #ffd6b3',
  },
  promoIcon: { fontSize: 15, lineHeight: '1.5', flexShrink: 0, marginTop: 1 },
  promoText: { fontSize: 13, color: '#c04a00', lineHeight: 1.5, fontWeight: 500 },

  myOrdersBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '13px 16px',
    background: '#fffaf7',
    borderTop: '1px solid #ffe8d6',
    borderBottom: '1px solid #ffe8d6',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  myOrdersBarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  myOrdersBarIcon: {
    fontSize: 20,
    lineHeight: 1,
  },
  myOrdersBarLabel: {
    fontSize: 15,
    fontWeight: 600,
    color: '#1a1a1a',
  },
  myOrdersBarArrow: {
    fontSize: 22,
    color: '#c0a090',
    lineHeight: 1,
    fontWeight: 300,
  },
  myOrdersBtnLink: {
    display: 'block',
    textAlign: 'center' as const,
    marginTop: 4,
    fontSize: 13,
    fontWeight: 600,
    color: PRIMARY,
    textDecoration: 'none',
    padding: '6px 0',
  },
  bindTgBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 48,
    marginTop: 14,
    background: '#0088cc',
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 700,
    textDecoration: 'none' as const,
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,136,204,0.25)',
  },
  bindTgHint: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center' as const,
    marginTop: 6,
    marginBottom: 4,
    lineHeight: 1.5,
  },
  confirmModal: {
    background: '#fff',
    borderRadius: '20px 20px 0 0',   // bottom sheet 圆角
    width: '100%',
    maxWidth: 480,
    // 高度约束：fallback 先用 92vh，支持 dvh 的设备用 92dvh
    maxHeight: '92vh',
    // @ts-ignore — dvh 部分安卓/Huawei 浏览器识别，作为优化覆盖
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(typeof window !== 'undefined' ? {} : {}), // SSR guard
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  confirmHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0 as const,         // 头部不压缩
    padding: '20px 20px 12px',
    borderBottom: '1px solid #f0f0f0',
  },
  confirmBody: {
    flex: 1,
    overflowY: 'auto' as const,
    WebkitOverflowScrolling: 'touch' as const,
    padding: '0 20px 8px',
  },
  confirmFooter: {
    flexShrink: 0 as const,         // 底部按钮区不压缩
    padding: '12px 20px',
    paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
    background: '#fff',
    borderTop: '1px solid #f0f0f0',
  },
  confirmHeaderIcon: { fontSize: 18 },
  confirmHeaderTitle: { fontSize: 17, fontWeight: 700, color: '#1a1a1a' },
  confirmItemList: {
    display: 'flex',
    flexDirection: 'column',
    marginBottom: 12,
  },
  confirmItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 0',
    borderBottom: '1px solid #f5f5f5',
  },
  confirmItemName: { fontSize: 14, fontWeight: 500, color: '#1a1a1a', flex: 1, marginRight: 12 },
  confirmItemSpec: { fontSize: 12, color: '#aaa', fontWeight: 400 },
  confirmItemRight: { display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 },
  confirmItemQty: { fontSize: 13, color: '#8c8c8c' },
  confirmItemAmt: { fontSize: 14, fontWeight: 600, color: '#e53e3e', minWidth: 56, textAlign: 'right' as const },
  confirmTotal: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    borderTop: '1px solid #ebebeb',
    marginBottom: 12,
  },
  confirmTotalLabel: { fontSize: 13, color: '#8c8c8c' },
  confirmTotalAmount: { fontSize: 22, fontWeight: 800, color: '#1677ff', letterSpacing: '-0.4px' },
  confirmErr: { fontSize: 12, color: '#ff4d4f', textAlign: 'center' as const, marginBottom: 8 },
  confirmBtns: { display: 'flex', gap: 10 },
  confirmBackBtn: {
    flex: 1,
    background: '#f5f5f5',
    color: '#555',
    border: 'none',
    borderRadius: 24,
    padding: '13px 0',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  confirmSubmitBtn: {
    flex: 2,
    background: `linear-gradient(135deg, #ff8c00 0%, ${PRIMARY} 100%)`,
    color: '#fff',
    border: 'none',
    borderRadius: 24,
    padding: '13px 0',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: `0 4px 14px ${PRIMARY}55`,
  },
  confirmSubmitBtnDisabled: {
    background: '#e8e8e8',
    color: '#b0b0b0',
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  cartLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    minWidth: 0,
  },
  myOrdersTab: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    width: 52,
    height: 44,
    textDecoration: 'none',
    color: '#666',
    flexShrink: 0,
    borderRight: '1px solid #ebebeb',
    paddingRight: 8,
    marginRight: 4,
  },
  myOrdersTabIcon: {
    fontSize: 20,
    lineHeight: 1,
  },
  myOrdersTabLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: '#666',
    whiteSpace: 'nowrap' as const,
    lineHeight: 1,
  },
  cartIconBox: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: '#1677ff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    flexShrink: 0,
  },
  cartBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    background: '#ff4d4f',
    color: '#fff',
    fontSize: 10,
    fontWeight: 700,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 3px',
  },
  cartAmount: {
    fontSize: 20,
    fontWeight: 800,
    lineHeight: 1.15,
    letterSpacing: '-0.4px',
  },
  cartHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 2,
  },
  checkoutBtn: {
    background: '#e8e8e8',
    color: '#b0b0b0',
    border: 'none',
    borderRadius: 24,
    padding: '14px 28px',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'not-allowed',
    flexShrink: 0,
    minWidth: 100,
    textAlign: 'center',
  },
  checkoutBtnOn: {
    background: `linear-gradient(135deg, #ff8c00 0%, ${PRIMARY} 100%)`,
    color: '#fff',
    cursor: 'pointer',
    boxShadow: `0 4px 14px ${PRIMARY}55`,
  },
}

// ─── 我的视图样式 ─────────────────────────────────────────────────────────────

const p: Record<string, React.CSSProperties> = {
  wrap: { padding: '12px 12px 24px' },
  headerCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: `linear-gradient(135deg, #ff8c00 0%, ${PRIMARY} 100%)`,
    borderRadius: 16,
    padding: '16px 16px',
    color: '#fff',
    marginBottom: 14,
    boxShadow: `0 4px 16px ${PRIMARY}30`,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.25)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0,
  },
  headerBody: { flex: 1, minWidth: 0 },
  userName: {
    fontSize: 16,
    fontWeight: 700,
    color: '#fff',
    marginBottom: 3,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  userStore: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  memberBadge: {
    fontSize: 11,
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.25)',
    color: '#fff',
    flexShrink: 0,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: '#888',
    letterSpacing: '0.04em',
    padding: '0 4px 6px',
    textTransform: 'uppercase' as const,
  },

  assetGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1fr',
    gap: 4,
    background: '#fff',
    borderRadius: 12,
    padding: '14px 8px',
    marginBottom: 14,
  },
  assetCell: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 4,
    padding: '4px 0',
    cursor: 'pointer',
  },
  assetValue: {
    fontSize: 18,
    fontWeight: 800,
    color: '#1a1a1a',
    letterSpacing: '-0.4px',
  },
  assetLabel: {
    fontSize: 11,
    color: '#888',
  },

  bindCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    border: '1.5px solid #d9f7be',
  },
  bindCardLink: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    border: '1.5px solid #ffd591',
    textDecoration: 'none',
    color: 'inherit',
  },
  bindIcon: {
    width: 38,
    height: 38,
    borderRadius: '50%',
    background: '#0088cc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    color: '#fff',
    flexShrink: 0,
  },
  bindBody: { flex: 1, minWidth: 0 },
  bindTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#1a1a1a',
    marginBottom: 2,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  bindSub: {
    fontSize: 12,
    color: '#888',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  bindArrow: {
    fontSize: 24,
    color: '#c0c0c0',
    flexShrink: 0,
    lineHeight: 1,
  },

  list: {
    background: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '13px 14px',
    borderBottom: '1px solid #f5f5f5',
    textDecoration: 'none',
    color: '#1a1a1a',
    background: 'transparent',
    border: 'none',
    borderTop: 'none',
    width: '100%',
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontSize: 14,
  },
  listIcon: {
    fontSize: 18,
    width: 22,
    textAlign: 'center' as const,
    flexShrink: 0,
  },
  listLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: 500,
    color: '#1a1a1a',
  },
  listArrow: {
    fontSize: 18,
    color: '#c0c0c0',
    flexShrink: 0,
    lineHeight: 1,
  },
  langInline: {
    display: 'flex',
    gap: 4,
    background: '#f5f5f5',
    borderRadius: 12,
    padding: 2,
  },
  langInlineBtn: {
    border: 'none',
    background: 'transparent',
    color: '#666',
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 8px',
    borderRadius: 10,
    cursor: 'pointer',
    lineHeight: 1.4,
  },
  langInlineBtnOn: {
    background: '#fff',
    color: PRIMARY,
    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
  },
}

// ─── 优惠券子页样式 ─────────────────────────────────────────────────────────

const cp: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 0 12px',
  },
  backBtn: {
    background: 'none',
    border: 'none',
    fontSize: 26,
    color: '#1a1a1a',
    cursor: 'pointer',
    padding: '0 6px',
    lineHeight: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
    color: '#1a1a1a',
  },
  tabs: {
    display: 'flex',
    background: '#fff',
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    padding: '8px 0',
    background: 'none',
    border: 'none',
    fontSize: 13,
    fontWeight: 600,
    color: '#888',
    cursor: 'pointer',
    borderRadius: 8,
  },
  tabActive: {
    color: '#fff',
    background: PRIMARY,
  },
  empty: {
    padding: '60px 20px',
    textAlign: 'center' as const,
    color: '#bbb',
    fontSize: 14,
    background: '#fff',
    borderRadius: 12,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
    opacity: 0.4,
  },
}

const cpk: Record<string, React.CSSProperties> = {
  mask:  { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 500, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  panel: { width: '100%', maxWidth: 480, background: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 10, maxHeight: '70vh' },
  title: { fontSize: 15, fontWeight: 700, color: '#1a1a1a' },
  list:  { display: 'flex', flexDirection: 'column' as const, gap: 8, overflowY: 'auto' as const, flex: 1 },
  item:  { display: 'flex', alignItems: 'center', padding: '10px 12px', border: '1px solid #ebebeb', borderRadius: 8, background: '#fff', cursor: 'pointer' },
  itemOn:{ borderColor: '#ff6b00', background: '#fff7e6' },
  empty: { padding: '20px 0', textAlign: 'center' as const, color: '#bbb', fontSize: 13 },
  done:  { height: 40, fontSize: 14, fontWeight: 700, color: '#fff', background: '#ff6b00', border: 'none', borderRadius: 8, cursor: 'pointer' },
}

// ─── 配送/上门地址 ───────────────────────────────────────────────────────────

const addr: Record<string, React.CSSProperties> = {
  card: {
    width: '100%', textAlign: 'left' as const, background: '#fff7e6',
    border: '1px dashed #ffd591', borderRadius: 10, padding: '10px 12px',
    margin: '0 0 10px', cursor: 'pointer',
    display: 'flex', flexDirection: 'column' as const, gap: 4,
  },
  addrLine:    { fontSize: 13, fontWeight: 700, color: '#1a1a1a' },
  subLine:     { fontSize: 12, color: '#666' },
  noteLine:    { fontSize: 11, color: '#999' },
  placeholder: { fontSize: 13, color: '#fa8c16', fontWeight: 600 },
}

const dm: Record<string, React.CSSProperties> = {
  mask:  { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 700, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  panel: { width: '100%', maxWidth: 480, background: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 10, maxHeight: '90vh', overflowY: 'auto' as const },
  title: { fontSize: 15, fontWeight: 700, color: '#1a1a1a' },
  label: { fontSize: 12, color: '#888', marginTop: 4 },
  input: { fontSize: 14, color: '#1a1a1a', background: '#fff', borderRadius: 8, padding: '8px 10px', border: '1px solid #d9d9d9', width: '100%', boxSizing: 'border-box' as const, outline: 'none' },
  err:   { fontSize: 12, color: '#cf1322', background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 6, padding: '6px 8px' },
  ok:    { fontSize: 12, color: '#389e0d' },
  geoBtn:{ height: 36, fontSize: 13, fontWeight: 600, color: '#1677ff', background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 8, cursor: 'pointer' },
  geoBigBtn: {
    width: '100%', minHeight: 56, background: '#1677ff', color: '#fff',
    border: 'none', borderRadius: 12, padding: '10px 14px', cursor: 'pointer',
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: 2,
    boxShadow: '0 2px 8px rgba(22,119,255,0.25)',
  },
  geoBigMain: { fontSize: 16, fontWeight: 700 },
  geoBigSub:  { fontSize: 11, color: 'rgba(255,255,255,0.85)' },
  locPreview: { background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column' as const, gap: 4 },
  locPreviewTitle: { fontSize: 13, fontWeight: 700, color: '#389e0d' },
  locPreviewCoord: { fontSize: 11, color: '#666', fontFamily: 'monospace' as const },
  locPreviewLink:  { fontSize: 12, fontWeight: 700, color: '#1677ff', textDecoration: 'none' },
  photoBox: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  photoUploadEmpty: {
    width: '100%', height: 100, border: '1.5px dashed #d9d9d9', borderRadius: 10,
    background: '#fafafa', display: 'flex', flexDirection: 'column' as const,
    alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer',
    color: '#888', fontSize: 13,
  },
  photoThumbWrap: { position: 'relative' as const },
  photoThumb: { width: '100%', maxHeight: 180, objectFit: 'cover' as const, borderRadius: 10, border: '1px solid #ebebeb' },
  photoReplaceBtn: { position: 'absolute' as const, right: 8, bottom: 8, fontSize: 12, fontWeight: 600, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' },
  actions:    { display: 'flex', gap: 8, marginTop: 8 },
  cancelBtn:  { flex: 1, height: 40, fontSize: 14, color: '#666', background: '#f5f5f5', border: 'none', borderRadius: 8, cursor: 'pointer' },
  saveBtn:    { flex: 2, height: 40, fontSize: 14, fontWeight: 700, color: '#fff', background: '#ff6b00', border: 'none', borderRadius: 8, cursor: 'pointer' },
  saveBtnDis: { background: '#bfbfbf', cursor: 'not-allowed' },
}

type DeliveryForm = {
  customerName: string; customerPhone: string
  deliveryAddress: string; deliveryNote: string
  deliveryLat: number | null; deliveryLng: number | null
  deliveryAddressPhotoUrl: string | null
}

function AddressQuickModal({
  info, lang, onClose, onUse, onEdit,
}: {
  info: DeliveryForm
  lang: 'zh' | 'en' | 'km'
  onClose: () => void
  onUse: () => void
  onEdit: () => void
}) {
  const L = lang === 'en' ? {
    title: 'Use your saved address?',
    use: 'Use this address', edit: 'Edit address',
    coord: 'Coordinates', map: 'Open Google Maps ›',
  } : lang === 'km' ? {
    title: 'ប្រើអាសយដ្ឋានដែលរក្សាទុក?',
    use: 'ប្រើអាសយដ្ឋាននេះ', edit: 'កែសម្រួលអាសយដ្ឋាន',
    coord: 'កូអរដោនេ', map: 'បើក Google Maps ›',
  } : {
    title: '使用最近一次的外卖地址？',
    use: '使用该地址', edit: '修改地址',
    coord: '经纬度', map: '打开 Google Maps ›',
  }
  const hasLoc = info.deliveryLat != null && info.deliveryLng != null

  return (
    <div style={dm.mask} onClick={onClose}>
      <div style={dm.panel} onClick={(e) => e.stopPropagation()}>
        <div style={dm.title}>📍 {L.title}</div>

        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.5 }}>
          {info.deliveryAddress}
        </div>
        {(info.customerName || info.customerPhone) && (
          <div style={{ fontSize: 12, color: '#666' }}>
            {info.customerName ? `${info.customerName} · ` : ''}{info.customerPhone}
          </div>
        )}
        {info.deliveryNote && (
          <div style={{ fontSize: 11, color: '#999' }}>{info.deliveryNote}</div>
        )}
        {hasLoc && (
          <div style={{ fontSize: 11, color: '#666', fontFamily: 'monospace' as const }}>
            {L.coord}: {info.deliveryLat!.toFixed(5)}, {info.deliveryLng!.toFixed(5)}
            <a
              href={`https://maps.google.com/?q=${info.deliveryLat},${info.deliveryLng}`}
              target="_blank" rel="noreferrer"
              style={{ marginLeft: 8, color: '#1677ff', textDecoration: 'none', fontWeight: 700 }}
            >{L.map}</a>
          </div>
        )}
        {info.deliveryAddressPhotoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={info.deliveryAddressPhotoUrl} alt="address"
               style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 10, border: '1px solid #ebebeb' }} />
        )}

        <div style={dm.actions}>
          <button type="button" style={dm.cancelBtn} onClick={onEdit}>{L.edit}</button>
          <button type="button" style={dm.saveBtn} onClick={onUse}>{L.use}</button>
        </div>
      </div>
    </div>
  )
}

function DeliveryPhotoUploader({
  current, onChange, L,
}: {
  current: string | null
  onChange: (url: string | null) => void
  L: { photoUpload: string; photoReplace: string; photoUploading: string; photoFail: string }
}) {
  const ref = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')

  async function compress(file: File): Promise<Blob> {
    // 等比缩到长边 1200，JPEG 0.85
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('decode'))
      i.src = URL.createObjectURL(file)
    })
    const max = 1200
    const w = img.naturalWidth, h = img.naturalHeight
    const r = Math.min(1, max / Math.max(w, h))
    const cw = Math.round(w * r), ch = Math.round(h * r)
    const canvas = document.createElement('canvas')
    canvas.width = cw; canvas.height = ch
    canvas.getContext('2d')!.drawImage(img, 0, 0, cw, ch)
    URL.revokeObjectURL(img.src)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error('canvas')), 'image/jpeg', 0.85)
    })
  }

  async function handlePick(f: File) {
    setBusy(true); setErr('')
    try {
      const blob = await compress(f).catch(() => f)  // 压缩失败则用原图
      const form = new FormData()
      form.append('file', blob, 'address.jpg')
      const res = await fetch('/api/uploads/delivery-photo', { method: 'POST', body: form })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body?.url) onChange(body.url)
      else setErr(body?.message ?? L.photoFail)
    } catch {
      setErr(L.photoFail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={dm.photoBox}>
      <input
        ref={ref} type="file" accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handlePick(f)
          e.target.value = ''
        }}
      />
      {current ? (
        <div style={dm.photoThumbWrap}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current} alt="address" style={dm.photoThumb} />
          <button type="button" style={dm.photoReplaceBtn} onClick={() => ref.current?.click()} disabled={busy}>
            {busy ? L.photoUploading : `📷 ${L.photoReplace}`}
          </button>
        </div>
      ) : (
        <button type="button" style={dm.photoUploadEmpty} onClick={() => ref.current?.click()} disabled={busy}>
          <span style={{ fontSize: 24 }}>📷</span>
          <span>{busy ? L.photoUploading : L.photoUpload}</span>
        </button>
      )}
      {err && <div style={dm.err}>{err}</div>}
    </div>
  )
}

function DeliveryEditModal({
  initial, lang, onClose, onSave,
}: { initial: DeliveryForm; lang: 'zh' | 'en' | 'km'; onClose: () => void; onSave: (v: DeliveryForm) => void }) {
  const [form, setForm] = useState<DeliveryForm>(initial)
  const [geoMsg, setGeoMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [geoBusy, setGeoBusy] = useState(false)

  const L = lang === 'en' ? {
    title: 'Delivery / on-site address',
    name: 'Contact name', phone: 'Phone number',
    address: 'Address', note: 'Door / floor / note',
    useLocMain: '📍 Use current location',
    useLocSub:  'Help the store find you faster',
    locating: 'Locating…',
    save: 'Save address', cancel: 'Cancel',
    needPhoneAddr: 'Phone and address are required',
    locOk: 'Location captured', locFail: 'Cannot get location. Please type the address.',
    phonePh: 'e.g. 855 12 345 678', addrPh: 'Street, building, city',
    locPreviewTitle: '📍 Approximate location saved',
    locPreviewCoord: 'Coordinates',
    locPreviewOpen:  'Open Google Maps ›',
    photoTitle: 'Address photo',
    photoHint:  'Upload a door / front / location photo to help delivery',
    photoUpload: 'Upload photo', photoReplace: 'Replace',
    photoUploading: 'Uploading…', photoFail: 'Upload failed',
  } : lang === 'km' ? {
    title: 'អាសយដ្ឋានដឹក/សេវាដល់ផ្ទះ',
    name: 'ឈ្មោះទំនាក់ទំនង', phone: 'លេខទូរស័ព្ទ',
    address: 'អាសយដ្ឋាន', note: 'ផ្ទះ/ជាន់/សម្គាល់',
    useLocMain: '📍 ទាញទីតាំងបច្ចុប្បន្ន',
    useLocSub:  'ជួយឱ្យហាង/អ្នកដឹករកអ្នកបានឆាប់',
    locating: 'កំពុងកំណត់ទីតាំង…',
    save: 'រក្សាទុក', cancel: 'បោះបង់',
    needPhoneAddr: 'ត្រូវការលេខទូរស័ព្ទ និងអាសយដ្ឋាន',
    locOk: 'ទទួលបានទីតាំង', locFail: 'មិនអាចទាញទីតាំងបាន សូមវាយជាអក្សរ',
    phonePh: 'ឧ. 855 12 345 678', addrPh: 'ផ្លូវ អគារ ទីក្រុង',
    locPreviewTitle: '📍 ទីតាំងប្រហែលត្រូវបានរក្សាទុក',
    locPreviewCoord: 'កូអរដោនេ',
    locPreviewOpen:  'បើក Google Maps ›',
    photoTitle: 'រូបភាពអាសយដ្ឋាន',
    photoHint:  'បង្ហោះរូបទ្វារ ឬទីតាំងជិតៗ ជួយការដឹកជញ្ជូន',
    photoUpload: 'បង្ហោះរូប', photoReplace: 'ប្ដូររូប',
    photoUploading: 'កំពុងបង្ហោះ…', photoFail: 'បង្ហោះបរាជ័យ',
  } : {
    title: '送货/上门地址',
    name: '联系人', phone: '联系电话',
    address: '详细地址', note: '门牌/楼层/备注',
    useLocMain: '📍 一键获取当前位置',
    useLocSub:  '用于帮助商户/配送员更快找到你',
    locating: '定位中…',
    save: '保存地址', cancel: '取消',
    needPhoneAddr: '请填写联系电话和详细地址',
    locOk: '已获取大概位置', locFail: '无法获取当前位置，请手动填写地址',
    phonePh: '例如 855 12 345 678', addrPh: '街道、楼宇、城市',
    locPreviewTitle: '📍 已获取大概位置',
    locPreviewCoord: '经纬度',
    locPreviewOpen:  '打开 Google Maps ›',
    photoTitle: '门牌/位置照片',
    photoHint:  '上传门牌、楼栋入口或附近明显位置，方便配送员找到你',
    photoUpload: '上传照片', photoReplace: '重新上传',
    photoUploading: '上传中…', photoFail: '上传失败',
  }

  function set<K extends keyof DeliveryForm>(k: K, v: DeliveryForm[K]) {
    setForm((p) => ({ ...p, [k]: v }))
  }

  function pickLocation() {
    if (geoBusy) return
    setGeoBusy(true); setGeoMsg(null)
    const done = (lat: number, lng: number) => {
      setForm((p) => ({ ...p, deliveryLat: lat, deliveryLng: lng }))
      setGeoMsg({ ok: true, text: L.locOk })
      setGeoBusy(false)
    }
    const fail = () => {
      setGeoMsg({ ok: false, text: L.locFail })
      setGeoBusy(false)
    }
    // 优先 Telegram WebApp LocationManager
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    const lm = tg?.LocationManager
    try {
      if (lm && typeof lm.init === 'function' && typeof lm.getLocation === 'function') {
        lm.init(() => {
          try {
            lm.getLocation((loc: { latitude?: number; longitude?: number } | null) => {
              if (loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number') done(loc.latitude, loc.longitude)
              else fail()
            })
          } catch { fail() }
        })
        return
      }
    } catch { /* ignore */ }
    // fallback：navigator.geolocation
    if (navigator?.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => done(pos.coords.latitude, pos.coords.longitude),
        () => fail(),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
      )
    } else {
      fail()
    }
  }

  const canSave = form.customerPhone.trim().length > 0 && form.deliveryAddress.trim().length > 0

  return (
    <div style={dm.mask} onClick={onClose}>
      <div style={dm.panel} onClick={(e) => e.stopPropagation()}>
        <div style={dm.title}>📍 {L.title}</div>

        <div style={dm.label}>{L.name}</div>
        <input style={dm.input} value={form.customerName}
               onChange={(e) => set('customerName', e.target.value.slice(0, 60))} />

        <div style={dm.label}>{L.phone} *</div>
        <input style={dm.input} type="tel" inputMode="tel" placeholder={L.phonePh}
               value={form.customerPhone}
               onChange={(e) => set('customerPhone', e.target.value.slice(0, 40))} />

        <div style={dm.label}>{L.address} *</div>
        <textarea style={{ ...dm.input, minHeight: 60, fontFamily: 'inherit', resize: 'vertical' as const }}
                  rows={2} placeholder={L.addrPh}
                  value={form.deliveryAddress}
                  onChange={(e) => set('deliveryAddress', e.target.value.slice(0, 500))} />

        <div style={dm.label}>{L.note}</div>
        <input style={dm.input} value={form.deliveryNote}
               onChange={(e) => set('deliveryNote', e.target.value.slice(0, 300))} />

        {/* 大按钮：一键获取当前位置 */}
        <button type="button" style={dm.geoBigBtn} onClick={pickLocation} disabled={geoBusy}>
          <div style={dm.geoBigMain}>{geoBusy ? L.locating : L.useLocMain}</div>
          <div style={dm.geoBigSub}>{L.useLocSub}</div>
        </button>

        {/* 定位成功预览卡片 */}
        {form.deliveryLat != null && form.deliveryLng != null && (
          <div style={dm.locPreview}>
            <div style={dm.locPreviewTitle}>{L.locPreviewTitle}</div>
            <div style={dm.locPreviewCoord}>
              {L.locPreviewCoord}: {form.deliveryLat.toFixed(5)}, {form.deliveryLng.toFixed(5)}
            </div>
            <a
              href={`https://maps.google.com/?q=${form.deliveryLat},${form.deliveryLng}`}
              target="_blank" rel="noreferrer" style={dm.locPreviewLink}
            >{L.locPreviewOpen}</a>
          </div>
        )}
        {geoMsg && !geoMsg.ok && <div style={dm.err}>{geoMsg.text}</div>}

        {/* 门牌/位置照片 */}
        <div style={dm.label}>{L.photoTitle}</div>
        <div style={{ fontSize: 11, color: '#888', marginTop: -4 }}>{L.photoHint}</div>
        <DeliveryPhotoUploader
          current={form.deliveryAddressPhotoUrl}
          onChange={(url) => set('deliveryAddressPhotoUrl', url)}
          L={L}
        />

        {!canSave && (
          <div style={{ fontSize: 11, color: '#fa8c16' }}>{L.needPhoneAddr}</div>
        )}

        <div style={dm.actions}>
          <button type="button" style={dm.cancelBtn} onClick={onClose}>{L.cancel}</button>
          <button
            type="button"
            style={{ ...dm.saveBtn, ...(canSave ? {} : dm.saveBtnDis) }}
            disabled={!canSave}
            onClick={() => canSave && onSave(form)}
          >
            {L.save}
          </button>
        </div>
      </div>
    </div>
  )
}
