'use client'

import { useState, useEffect, useRef, KeyboardEvent, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import BarcodeScanner from '@/app/components/BarcodeScanner'
import { useLocale } from '@/app/components/LangProvider'
import { useWorkMode } from '@/app/components/WorkModeProvider'
import LangToggleBtn from '@/app/components/LangToggleBtn'
import KhqrSheet from '@/app/components/KhqrSheet'

// ─── HID Scanner Hook ─────────────────────────────────────────────────────────

function useHidScanner(onScan: (code: string) => void) {
  const bufRef = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      const active = document.activeElement
      const isTypingField = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      if (isTypingField) return
      if (e.key === 'Enter') {
        if (bufRef.current.length >= 4) onScan(bufRef.current)
        bufRef.current = ''
        if (timerRef.current) clearTimeout(timerRef.current)
        return
      }
      if (e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey) {
        bufRef.current += e.key
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          if (bufRef.current.length >= 4) onScan(bufRef.current)
          bufRef.current = ''
        }, 80)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [onScan])
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Product = {
  id: string
  barcode: string
  name: string
  spec: string | null
  sellPrice: number
  // imageUrl 由 /api/products 返回（route.ts 已 select）；仅 AI 拍照识别 mock 候选卡片读取
  imageUrl?: string | null
  imageUrls?: string[] | null
}

type PhotoCandidate = {
  productId: string
  name: string
  spec: string | null
  price: number
  imageUrl: string | null
  confidence: number
  reason: string[]
}

type PhotoRecognizeResponse = {
  candidates?: PhotoCandidate[]
  needManualConfirm?: true
  errorCode?: string
  fallbackMessage?: string
  usage?: {
    usedToday: number
    dailyLimit: number
  }
}

type PhotoMultiAiHint = {
  name?: string | null
  brand?: string | null
  spec?: string | null
  category?: string | null
  color?: string | null
  packageText?: string | null
  confidence?: number | null
}

type PhotoMultiItem = {
  itemIndex: number
  aiHint?: PhotoMultiAiHint | null
  candidates?: PhotoCandidate[]
  needManualConfirm?: true
}

type PhotoRecognizeMultiResponse = {
  items?: PhotoMultiItem[]
  itemCount?: number
  needManualConfirm?: true
  errorCode?: string | null
  fallbackMessage?: string | null
  usage?: {
    usedToday: number
    dailyLimit: number
  }
}

type PhotoDebugInfo = {
  fileType?: string
  fileSize?: number
  compressedMime?: string
  compressedSize?: number
  apiStatus?: number
  errorCode?: string
  stage?: string
}

type CartItem = {
  key: string
  product: Product
  qty: number
}

type SaleSummary = {
  saleCount: number
  refundCount: number
  netAmount: number
  cashSaleAmount?: number
  khqrSaleAmount?: number
}

function productImageUrl(product: Product): string | null {
  return product.imageUrl ?? product.imageUrls?.find((url) => typeof url === 'string' && url.trim()) ?? null
}

type SaleSuccess = {
  orderNo: string
  totalAmount: number
  itemCount: number
  createdAt: string
  paymentMethod: 'CASH' | 'KHQR'
  cartSnapshot: CartItem[]
}

type PendingPayment = {
  id: string
  orderNo: string
  amount: number
  khqrPayload: string | null
  khqrImageUrl: string | null
  createdAt: string
  cartSnapshot: CartItem[]
}

type DeferredOrder = {
  orderNo: string
  totalAmount: number
  itemCount: number
  createdAt: string
  cartSnapshot: CartItem[]
}

type RestorablePosItem = {
  productId: string
  name: string
  spec: string | null
  price: number
  qty: number
  lineAmount: number
  imageUrl?: string | null
}

type RestorePrompt = {
  items: CartItem[]
  totalAmount: number
  itemCount: number
  status: string
}

type Status = 'idle' | 'querying' | 'submitting'
type PayStep = 'none' | 'selecting' | 'khqr_pending'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SalePage() {
  const { t } = useLocale()
  const {
    tier,
    realRole,
    effectiveRole,
    isOwnerInStaffMode,
    storeName: contextStoreName,
    storeCode: contextStoreCode,
    tenantName: contextTenantName,
  } = useWorkMode()
  const [barcodeInput, setBarcodeInput] = useState('')
  const [qty, setQty] = useState(1)
  const [product, setProduct] = useState<Product | null>(null)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [cart, setCart] = useState<CartItem[]>([])
  const [success, setSuccess] = useState<SaleSuccess | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [payStep, setPayStep] = useState<PayStep>('none')
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)
  const [khqrUnavailable, setKhqrUnavailable] = useState(false)
  const [checkoutMode, setCheckoutMode] = useState<'DIRECT_PAYMENT' | 'DEFERRED_PAYMENT'>('DIRECT_PAYMENT')
  const [deferredOrder, setDeferredOrder] = useState<DeferredOrder | null>(null)
  // AI 拍照识别弹层（Phase 2B：真实 API 只返回候选，店员必须手动确认加入本单）
  const [photoModalOpen, setPhotoModalOpen] = useState(false)
  const [photoStatus, setPhotoStatus] = useState<'idle' | 'loading'>('idle')
  const [photoCandidates, setPhotoCandidates] = useState<PhotoCandidate[]>([])
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [photoDebug, setPhotoDebug] = useState<PhotoDebugInfo | null>(null)
  const [photoDebugOpen, setPhotoDebugOpen] = useState(false)
  const [photoUsage, setPhotoUsage] = useState<{ usedToday: number; dailyLimit: number } | null>(null)
  const [photoMultiModalOpen, setPhotoMultiModalOpen] = useState(false)
  const [photoMultiStatus, setPhotoMultiStatus] = useState<'idle' | 'loading'>('idle')
  const [photoMultiItems, setPhotoMultiItems] = useState<PhotoMultiItem[]>([])
  const [photoMultiError, setPhotoMultiError] = useState<string | null>(null)
  const [photoMultiDebug, setPhotoMultiDebug] = useState<PhotoDebugInfo | null>(null)
  const [photoMultiDebugOpen, setPhotoMultiDebugOpen] = useState(false)
  const [photoMultiUsage, setPhotoMultiUsage] = useState<{ usedToday: number; dailyLimit: number } | null>(null)
  const [photoMultiHandled, setPhotoMultiHandled] = useState<Record<number, 'added' | 'ignored'>>({})
  const [photoMultiManualHintIndex, setPhotoMultiManualHintIndex] = useState<number | null>(null)
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false)
  const [recentProductIds, setRecentProductIds] = useState<string[]>([])
  const [storeCode, setStoreCode] = useState<string | null>(null)
  const [summary, setSummary] = useState<SaleSummary | null>(null)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [restorePrompt, setRestorePrompt] = useState<RestorePrompt | null>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const restoreCheckedRef = useRef(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const scanSucceededRef = useRef(false)
  const [cameraFailCount, setCameraFailCount] = useState(0)
  const [hidFailCount, setHidFailCount] = useState(0)
  const isHidTier = tier === 'STANDARD' || tier === 'MULTI_STORE'
  const [manualOpen, setManualOpen] = useState(false)
  const [scannerMsg, setScannerMsg] = useState<{ type: 'ok' | 'fail'; text: string } | null>(null)
  const isPhotoMultiEnabled = process.env.NEXT_PUBLIC_AI_PHOTO_MULTI_ENABLED === '1'

  function focusInput() {
    // defer one tick so the input is visible/mounted before focusing
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  // ── 商品列表（自动补全 + 下拉）─────────────────────────────────────────────
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [suggestions, setSuggestions] = useState<Product[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [dropOpen, setDropOpen] = useState(false)
  const [dropSearch, setDropSearch] = useState('')
  const suggestWrapRef = useRef<HTMLDivElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const displayStoreName = contextStoreName ?? contextTenantName ?? 'E-Shop'
  const displayStoreCode = contextStoreCode ?? storeCode
  const storeInitial = displayStoreName.trim().slice(0, 1).toUpperCase() || '店'
  const storeAvatarUrl = displayStoreCode && !avatarFailed ? `/api/public/stores/${displayStoreCode}/banner` : null
  const cartItemCount = cart.reduce((sum, item) => sum + item.qty, 0)

  useEffect(() => {
    apiFetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.checkoutMode) setCheckoutMode(data.checkoutMode)
        if (data?.storeCode) setStoreCode(data.storeCode)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    apiFetch('/api/products')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Product[]) => setAllProducts(list))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const today = new Date()
    const yyyy = today.getFullYear()
    const mm = String(today.getMonth() + 1).padStart(2, '0')
    const dd = String(today.getDate()).padStart(2, '0')
    const date = `${yyyy}-${mm}-${dd}`
    const params = new URLSearchParams({ dateFrom: date, dateTo: date, pageSize: '1' })
    apiFetch(`/api/records?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setSummary(data?.summary ?? null))
      .catch(() => setSummary(null))
  }, [])

  useEffect(() => {
    if (!storeCode || allProducts.length === 0 || restoreCheckedRef.current) return
    restoreCheckedRef.current = true
    fetch(`/api/pos/session/current?storeCode=${encodeURIComponent(storeCode)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const session = body?.session
        if (!session || (session.displayStatus && String(session.displayStatus).startsWith('EXPIRED'))) return
        if (session.status !== 'DRAFT' && session.status !== 'AWAITING_PAYMENT') return
        const rawItems = Array.isArray(session.items) ? session.items as RestorablePosItem[] : []
        if (rawItems.length === 0) return
        const nextItems: CartItem[] = []
        for (const item of rawItems) {
          const p = allProducts.find((product) => product.id === item.productId)
          if (!p) continue
          nextItems.push({
            key: `${p.id}-restore-${nextItems.length}`,
            product: p,
            qty: Math.max(1, Number(item.qty) || 1),
          })
        }
        if (nextItems.length === 0) return
        setRestorePrompt({
          items: nextItems,
          totalAmount: Number(session.totalAmount) || nextItems.reduce((sum, item) => sum + item.product.sellPrice * item.qty, 0),
          itemCount: Number(session.itemCount) || nextItems.reduce((sum, item) => sum + item.qty, 0),
          status: session.status,
        })
      })
      .catch(() => {})
  }, [storeCode, allProducts])

  useEffect(() => {
    const q = barcodeInput.trim()
    if (!q || allProducts.length === 0) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    const ql = q.toLowerCase()
    const isNumeric = /^\d+$/.test(q)
    const matches = allProducts.filter(
      (p) =>
        p.barcode.toLowerCase().includes(ql) ||
        p.name.toLowerCase().includes(ql) ||
        (p.spec ?? '').toLowerCase().includes(ql),
    )
    matches.sort((a, b) => {
      if (isNumeric) {
        return (a.barcode.toLowerCase().startsWith(ql) ? 0 : 1) -
               (b.barcode.toLowerCase().startsWith(ql) ? 0 : 1)
      }
      return (a.name.toLowerCase().includes(ql) ? 0 : 1) -
             (b.name.toLowerCase().includes(ql) ? 0 : 1)
    })
    const top = matches.slice(0, 5)
    setSuggestions(top)
    setShowSuggestions(top.length > 0)
  }, [barcodeInput, allProducts])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (suggestWrapRef.current && !suggestWrapRef.current.contains(e.target as Node))
        setShowSuggestions(false)
      if (dropRef.current && !dropRef.current.contains(e.target as Node))
        setDropOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filteredDrop = dropSearch.trim()
    ? allProducts.filter((p) => {
        const q = dropSearch.toLowerCase()
        return (
          p.barcode.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          (p.spec ?? '').toLowerCase().includes(q)
        )
      })
    : allProducts

  function selectProduct(p: Product) {
    rememberProduct(p)
    setProduct(p)
    setBarcodeInput(p.barcode)
    setQty(1)
    setShowSuggestions(false)
    setDropSearch('')
    setDropOpen(false)
    setQueryError(null)
  }

  const safeQty = Math.max(1, qty)
  const cartTotal = cart.reduce((sum, i) => sum + i.product.sellPrice * i.qty, 0)
  const selectedProductImageUrl = product ? productImageUrl(product) : null
  const recentQuickProducts = (
    recentProductIds.length > 0
      ? recentProductIds
          .map((id) => allProducts.find((p) => p.id === id))
          .filter((p): p is Product => Boolean(p))
      : allProducts
  ).slice(0, 4)

  function rememberProduct(p: Product) {
    setRecentProductIds((prev) => [p.id, ...prev.filter((id) => id !== p.id)].slice(0, 8))
  }

  // ── 按条码查询 ─────────────────────────────────────────────────────────────

  async function queryProductByBarcode(barcode: string) {
    if (!barcode) return
    setQueryError(null)
    setProduct(null)
    setStatus('querying')
    try {
      const res = await apiFetch(`/api/products?barcode=${encodeURIComponent(barcode)}`)
      if (res.ok) {
        setProduct(await res.json())
        setQty(1)
        setHidFailCount(0) // reset on success
      } else {
        const body = await res.json().catch(() => ({}))
        setQueryError(body.error === 'PRODUCT_NOT_FOUND' ? t('sale.notFound') : t('sale.queryFailed'))
        if (body.error === 'PRODUCT_NOT_FOUND' && isHidTier) {
          setHidFailCount((c) => Math.min(c + 1, 5))
        }
      }
    } catch {
      setQueryError(t('common.networkError'))
    } finally {
      setStatus('idle')
    }
  }

  function queryProduct() {
    setShowSuggestions(false)
    queryProductByBarcode(barcodeInput.trim())
  }

  function handleBarcodeKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') queryProduct()
    if (e.key === 'Escape') setShowSuggestions(false)
  }

  const handleHidScan = useCallback((code: string) => {
    setScannerMsg(null)
    const clean = code.trim()
    if (!clean) return
    const hit = allProducts.find((p) => p.barcode === clean) ||
      allProducts.find((p) => p.barcode.toLowerCase() === clean.toLowerCase())
    if (hit) {
      selectProduct(hit)
      setScannerMsg({ type: 'ok', text: t('sale.scanSelected').replace('{name}', hit.name) })
      setTimeout(() => setScannerMsg(null), 2500)
    } else {
      queryProductByBarcode(clean)
      setScannerMsg({ type: 'fail', text: t('sale.scanNotFound').replace('{code}', clean) })
    }
  }, [allProducts]) // eslint-disable-line react-hooks/exhaustive-deps
  useHidScanner(handleHidScan)

  // ── 扫码 ──────────────────────────────────────────────────────────────────

  /** 打开摄像头扫码（仅一维商品条码，不扫二维码） */
  function scanBarcode() {
    scanSucceededRef.current = false
    setQueryError(null)
    setScannerOpen(true)
  }

  /** 摄像头扫码成功：回填条码、触发查询、重置失败计数 */
  function handleScanned(barcode: string) {
    scanSucceededRef.current = true
    setCameraFailCount(0)
    setHidFailCount(0)
    setScannerOpen(false)
    setBarcodeInput(barcode)
    queryProductByBarcode(barcode)
    focusInput()
  }

  /** 用户手动关闭扫码窗口（未扫到结果）：记录失败次数 */
  function handleScannerClose() {
    if (!scanSucceededRef.current) {
      setCameraFailCount((c) => Math.min(c + 1, 5))
    }
    scanSucceededRef.current = false
    setScannerOpen(false)
  }

  /** 摄像头启动失败：关闭弹窗、记录失败次数、展示错误 */
  function handleCameraError(msg: string) {
    setScannerOpen(false)
    setCameraFailCount((c) => Math.min(c + 1, 5))
    setQueryError(msg)
  }

  // ── 购物车操作 ─────────────────────────────────────────────────────────────

  function addProductToCart(p: Product, quantity = 1) {
    const addQty = Math.max(1, quantity)
    rememberProduct(p)
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === p.id)
      if (existing) {
        return prev.map((i) =>
          i.product.id === p.id ? { ...i, qty: i.qty + addQty } : i
        )
      }
      return [...prev, { key: `${p.id}-${Date.now()}`, product: p, qty: addQty }]
    })
  }

  function addToCart() {
    if (!product) return
    addProductToCart(product, safeQty)
    setProduct(null)
    setBarcodeInput('')
    setQty(1)
    setQueryError(null)
    setHidFailCount(0)
    focusInput()
  }

  function removeFromCart(key: string) {
    setCart((prev) => prev.filter((i) => i.key !== key))
  }

  // ── POS Session mirror sync（fire-and-forget；只镜像到 PosSession 表，不动主销售链路） ──
  // 失败仅 console.warn；任何错误都不阻断 /api/sales 提交、KhqrSheet、CASH 流程。
  function postPosMirror(path: 'update' | 'complete' | 'cancel', body: object) {
    apiFetch(`/api/pos/session/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }).catch((e) => console.warn('[pos-mirror]', path, e))
  }

  function continueRestoredOrder() {
    if (!restorePrompt) return
    setCart(restorePrompt.items)
    setProduct(null)
    setBarcodeInput('')
    setQty(1)
    setQueryError(null)
    setSuccess(null)
    setDeferredOrder(null)
    setPendingPayment(null)
    setPayStep('none')
    setModalError(null)
    setRestorePrompt(null)
    posMirrorSigRef.current = ''
    setScannerMsg({ type: 'ok', text: t('sale.restoreSuccess') })
    focusInput()
  }

  async function cancelRestoredOrder() {
    setRestoreBusy(true)
    try {
      await apiFetch('/api/pos/session/cancel', { method: 'POST' })
      posMirrorSigRef.current = '__terminal__'
      setRestorePrompt(null)
      setScannerMsg({ type: 'ok', text: t('sale.restoreCancelled') })
    } catch {
      setSubmitError(t('sale.restoreCancelFailed'))
    } finally {
      setRestoreBusy(false)
    }
  }

  const posMirrorSigRef = useRef<string>('')

  useEffect(() => {
    if (success) {
      // 销售完成 → 终态
      posMirrorSigRef.current = '__terminal__'
      postPosMirror('complete', {
        orderNo: success.orderNo,
        totalAmount: success.totalAmount,
        paymentMethod: success.paymentMethod,
      })
      return
    }

    // 解析当前镜像负载
    let activeItems: CartItem[] = []
    let mirrorStatus: 'DRAFT' | 'AWAITING_PAYMENT' = 'DRAFT'
    let mPM: 'CASH' | 'KHQR' | null = null
    let mPS: 'PENDING' | 'PAID' | null = null
    let mKQ: string | null = null
    let mKI: string | null = null

    if (pendingPayment) {
      activeItems = pendingPayment.cartSnapshot
      mirrorStatus = 'AWAITING_PAYMENT'
      mPM = 'KHQR'; mPS = 'PENDING'
      mKQ = pendingPayment.khqrPayload
      mKI = pendingPayment.khqrImageUrl
    } else if (deferredOrder) {
      activeItems = deferredOrder.cartSnapshot
      mirrorStatus = 'AWAITING_PAYMENT'
    } else if (cart.length > 0) {
      activeItems = cart
      mirrorStatus = 'DRAFT'
    } else {
      // 无活动状态：仅当上一次发过非终态时才补一次 cancel
      if (!posMirrorSigRef.current || posMirrorSigRef.current === '__terminal__') return
      posMirrorSigRef.current = '__terminal__'
      postPosMirror('cancel', {})
      return
    }

    const items = activeItems.map((ci) => ({
      productId: ci.product.id,
      name: ci.product.name,
      spec: ci.product.spec,
      imageUrl: productImageUrl(ci.product),
      price: ci.product.sellPrice,
      qty: ci.qty,
      lineAmount: +(ci.product.sellPrice * ci.qty).toFixed(2),
    }))

    const sig = JSON.stringify({
      s: mirrorStatus, pm: mPM, ps: mPS,
      kq: !!mKQ, ki: !!mKI,
      items: items.map((i) => `${i.productId}:${i.qty}`).join('|'),
    })
    if (sig === posMirrorSigRef.current) return
    posMirrorSigRef.current = sig

    // 400ms 防抖：避免 +/- 连点造成的高频写
    const t = setTimeout(() => {
      postPosMirror('update', {
        items,
        status: mirrorStatus,
        paymentMethod: mPM,
        paymentStatus: mPS,
        khqrPayload: mKQ,
        khqrImageUrl: mKI,
      })
    }, 400)
    return () => clearTimeout(t)
  }, [cart, payStep, pendingPayment, deferredOrder, success])

  // mock 候选：取当前 allProducts 前 3 个；置信度硬编码三档（仅 UI 真实感，不参与决策）
  const photoMockCandidates: Array<Product & { confidence: number }> = allProducts
    .slice(0, 3)
    .map((p, i) => ({ ...p, confidence: [0.92, 0.84, 0.76][i] ?? 0.7 }))

  function openPhotoModal() {
    setPhotoModalOpen(true)
    setPhotoError(null)
    setPhotoCandidates([])
    setPhotoDebug(null)
    setPhotoDebugOpen(false)
    setPhotoUsage(null)
    setPhotoStatus('idle')
  }

  function openPhotoMultiModal() {
    setPhotoMultiModalOpen(true)
    setPhotoMultiError(null)
    setPhotoMultiItems([])
    setPhotoMultiDebug(null)
    setPhotoMultiDebugOpen(false)
    setPhotoMultiUsage(null)
    setPhotoMultiHandled({})
    setPhotoMultiManualHintIndex(null)
    setPhotoMultiStatus('idle')
  }

  function setPhotoFailure(message: string, debug: PhotoDebugInfo) {
    setPhotoError(message)
    setPhotoDebug((prev) => ({ ...(prev ?? {}), ...debug }))
  }

  function setPhotoMultiFailure(message: string, debug: PhotoDebugInfo) {
    setPhotoMultiError(message)
    setPhotoMultiDebug((prev) => ({ ...(prev ?? {}), ...debug }))
  }

  function aiPhotoErrorMessage(errorCode: string): string {
    if (errorCode === 'AI_MULTI_BETA_DISABLED') return t('sale.aiMultiBetaDisabled')
    if (errorCode === 'AI_DISABLED_BY_OPS') return t('sale.aiDisabledByOps')
    if (errorCode === 'AI_DAILY_LIMIT_REACHED') return t('sale.aiDailyLimitReached')
    if (errorCode === 'AI_NOT_CONFIGURED') return t('sale.aiNotConfigured')
    if (errorCode === 'AI_TIMEOUT') return t('sale.aiTimeout')
    if (errorCode === 'AI_EMPTY') return t('sale.aiEmpty')
    if (errorCode === 'AI_FAILED') return t('sale.aiFailed')
    if (errorCode === 'INVALID_IMAGE') return t('sale.invalidImage')
    if (errorCode === 'INVALID_MIME') return t('sale.invalidMime')
    return t('sale.aiGenericFailed')
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : ''
        const [, base64 = ''] = result.split(',')
        resolve(base64)
      }
      reader.onerror = () => reject(new Error('FILE_READ_FAILED'))
      reader.readAsDataURL(blob)
    })
  }

  async function compressPhotoForRecognize(file: File): Promise<{ blob: Blob; mime: string }> {
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'))
        el.src = url
      })
      const MAX_DIM = 1280
      let w = img.naturalWidth
      let h = img.naturalHeight
      if (w > MAX_DIM || h > MAX_DIM) {
        if (w >= h) {
          h = Math.round((h * MAX_DIM) / w)
          w = MAX_DIM
        } else {
          w = Math.round((w * MAX_DIM) / h)
          h = MAX_DIM
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('COMPRESS_FAILED')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)

      const TARGET = 500 * 1024
      const HARD_LIMIT = 1024 * 1024
      const MIN_QUALITY = 0.55
      let quality = 0.82
      let best: Blob | null = null
      while (quality >= MIN_QUALITY) {
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
        })
        if (blob) {
          best = blob
          if (blob.size <= TARGET) break
        }
        quality = Math.round((quality - 0.08) * 100) / 100
      }
      if (!best) throw new Error('COMPRESS_FAILED')
      const finalBlob = best.type ? best : new Blob([best], { type: 'image/jpeg' })
      if (finalBlob.size > HARD_LIMIT) throw new Error('IMAGE_TOO_LARGE_AFTER_COMPRESS')
      return { blob: finalBlob, mime: finalBlob.type || 'image/jpeg' }
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  async function handlePhotoFile(file: File | null | undefined) {
    if (!file) {
      setPhotoFailure(t('sale.photoNoFile'), { stage: 'failed_before_post' })
      return
    }
    setPhotoError(null)
    setPhotoCandidates([])
    setPhotoDebugOpen(false)
    setPhotoUsage(null)
    setPhotoDebug({
      fileType: file.type || '(empty)',
      fileSize: file.size,
      stage: 'file_selected',
    })

    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp'])
    if (!allowed.has(file.type)) {
      setPhotoFailure(t('sale.photoUnsupported'), {
        errorCode: 'INVALID_MIME',
        stage: 'failed_before_post',
      })
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoFailure(t('sale.photoTooLarge'), {
        errorCode: 'IMAGE_TOO_LARGE',
        stage: 'failed_before_post',
      })
      return
    }

    setPhotoStatus('loading')
    let stage = 'file_selected'
    try {
      stage = 'compressing'
      setPhotoDebug((prev) => ({ ...(prev ?? {}), stage }))
      const { blob, mime } = await compressPhotoForRecognize(file)
      stage = 'compressed'
      setPhotoDebug((prev) => ({
        ...(prev ?? {}),
        compressedMime: mime,
        compressedSize: blob.size,
        stage,
      }))
      const imageBase64 = await blobToBase64(blob)
      stage = 'posting'
      setPhotoDebug((prev) => ({ ...(prev ?? {}), stage }))
      const res = await apiFetch('/api/sales/photo-recognize', {
        method: 'POST',
        body: JSON.stringify({ imageBase64, mime, source: 'sale_recognize_v1' }),
      })
      stage = 'response_received'
      const body = await res.json().catch(() => ({})) as PhotoRecognizeResponse & { error?: string }
      if (body.usage) setPhotoUsage(body.usage)
      setPhotoDebug((prev) => ({
        ...(prev ?? {}),
        apiStatus: res.status,
        errorCode: body.errorCode ?? body.error ?? undefined,
        stage,
      }))
      if (!res.ok) {
        const errorCode = body.error ?? `HTTP_${res.status}`
        if (res.status === 401 || res.status === 403) {
          setPhotoFailure(t('sale.photoLoginExpired'), { apiStatus: res.status, errorCode, stage: 'failed_after_post' })
          return
        }
        if (res.status === 400) {
          setPhotoFailure(t('sale.photoInvalidParams'), { apiStatus: res.status, errorCode, stage: 'failed_after_post' })
          return
        }
        setPhotoFailure(t('sale.aiGenericFailed'), { apiStatus: res.status, errorCode, stage: 'failed_after_post' })
        return
      }
      if (body.errorCode) {
        setPhotoFailure(body.fallbackMessage || aiPhotoErrorMessage(body.errorCode), {
          apiStatus: res.status,
          errorCode: body.errorCode,
          stage: 'failed_after_post',
        })
        return
      }
      const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 5) : []
      if (candidates.length === 0) {
        setPhotoFailure(t('sale.photoNoCandidates'), {
          apiStatus: res.status,
          stage: 'response_received',
        })
        return
      }
      const firstMatch = allProducts.find((p) => p.id === candidates[0]?.productId)
      if (firstMatch) {
        selectProduct(firstMatch)
        setPhotoModalOpen(false)
        setPhotoCandidates([])
        return
      }
      setPhotoCandidates(candidates)
    } catch (e) {
      const code = e instanceof Error ? e.message : 'UNKNOWN_ERROR'
      if (code === 'IMAGE_LOAD_FAILED') {
        setPhotoFailure(t('sale.photoReadFailed'), { errorCode: code, stage: 'failed_before_post' })
      } else if (code === 'COMPRESS_FAILED') {
        setPhotoFailure(t('sale.photoCompressFailed'), { errorCode: code, stage: 'failed_before_post' })
      } else if (code === 'IMAGE_TOO_LARGE_AFTER_COMPRESS') {
        setPhotoFailure(t('sale.photoCompressedTooLarge'), { errorCode: code, stage: 'failed_before_post' })
      } else if (code === 'FILE_READ_FAILED') {
        setPhotoFailure(t('sale.photoReadFailed'), { errorCode: code, stage: 'failed_before_post' })
      } else if (stage === 'posting') {
        setPhotoFailure(t('sale.photoNetworkFailed'), { errorCode: code, stage: 'failed_after_post' })
      } else {
        setPhotoFailure(t('sale.aiGenericFailed'), { errorCode: code, stage: 'failed_before_post' })
      }
    } finally {
      setPhotoStatus('idle')
    }
  }

  async function handlePhotoMultiFile(file: File | null | undefined) {
    if (!file) {
      setPhotoMultiFailure(t('sale.photoNoFile'), { stage: 'failed_before_post' })
      return
    }
    setPhotoMultiError(null)
    setPhotoMultiItems([])
    setPhotoMultiHandled({})
    setPhotoMultiManualHintIndex(null)
    setPhotoMultiDebugOpen(false)
    setPhotoMultiUsage(null)
    setPhotoMultiDebug({
      fileType: file.type || '(empty)',
      fileSize: file.size,
      stage: 'file_selected',
    })

    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp'])
    if (!allowed.has(file.type)) {
      setPhotoMultiFailure(t('sale.photoUnsupported'), {
        errorCode: 'INVALID_MIME',
        stage: 'failed_before_post',
      })
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoMultiFailure(t('sale.photoTooLarge'), {
        errorCode: 'IMAGE_TOO_LARGE',
        stage: 'failed_before_post',
      })
      return
    }

    setPhotoMultiStatus('loading')
    let stage = 'file_selected'
    try {
      stage = 'compressing'
      setPhotoMultiDebug((prev) => ({ ...(prev ?? {}), stage }))
      const { blob, mime } = await compressPhotoForRecognize(file)
      stage = 'compressed'
      setPhotoMultiDebug((prev) => ({
        ...(prev ?? {}),
        compressedMime: mime,
        compressedSize: blob.size,
        stage,
      }))
      const imageBase64 = await blobToBase64(blob)
      stage = 'posting'
      setPhotoMultiDebug((prev) => ({ ...(prev ?? {}), stage }))
      const res = await apiFetch('/api/sales/photo-recognize-multi', {
        method: 'POST',
        body: JSON.stringify({ imageBase64, mime, source: 'sale_recognize_multi_v1' }),
      })
      stage = 'response_received'
      const body = await res.json().catch(() => ({})) as PhotoRecognizeMultiResponse & { error?: string }
      if (body.usage) setPhotoMultiUsage(body.usage)
      setPhotoMultiDebug((prev) => ({
        ...(prev ?? {}),
        apiStatus: res.status,
        errorCode: body.errorCode ?? body.error ?? undefined,
        stage,
      }))
      if (!res.ok) {
        const errorCode = body.error ?? `HTTP_${res.status}`
        if (res.status === 401 || res.status === 403) {
          setPhotoMultiFailure(t('sale.photoLoginExpired'), { apiStatus: res.status, errorCode, stage: 'failed_after_post' })
          return
        }
        if (res.status === 400) {
          setPhotoMultiFailure(t('sale.photoInvalidParams'), { apiStatus: res.status, errorCode, stage: 'failed_after_post' })
          return
        }
        setPhotoMultiFailure(t('sale.photoMultiFailedGeneric'), { apiStatus: res.status, errorCode, stage: 'failed_after_post' })
        return
      }
      if (body.errorCode) {
        setPhotoMultiFailure(body.fallbackMessage || aiPhotoErrorMessage(body.errorCode), {
          apiStatus: res.status,
          errorCode: body.errorCode,
          stage: 'failed_after_post',
        })
        return
      }
      const items = Array.isArray(body.items) ? body.items.slice(0, 3) : []
      if (items.length === 0) {
        setPhotoMultiFailure(t('sale.photoNoCandidates'), {
          apiStatus: res.status,
          stage: 'response_received',
        })
        return
      }
      setPhotoMultiItems(items.map((item, index) => ({
        ...item,
        itemIndex: typeof item.itemIndex === 'number' ? item.itemIndex : index,
        candidates: Array.isArray(item.candidates) ? item.candidates.slice(0, 3) : [],
        needManualConfirm: true,
      })))
    } catch (e) {
      const code = e instanceof Error ? e.message : 'UNKNOWN_ERROR'
      if (code === 'IMAGE_LOAD_FAILED') {
        setPhotoMultiFailure(t('sale.photoReadFailed'), { errorCode: code, stage: 'failed_before_post' })
      } else if (code === 'COMPRESS_FAILED') {
        setPhotoMultiFailure(t('sale.photoCompressFailed'), { errorCode: code, stage: 'failed_before_post' })
      } else if (code === 'IMAGE_TOO_LARGE_AFTER_COMPRESS') {
        setPhotoMultiFailure(t('sale.photoCompressedTooLarge'), { errorCode: code, stage: 'failed_before_post' })
      } else if (code === 'FILE_READ_FAILED') {
        setPhotoMultiFailure(t('sale.photoReadFailed'), { errorCode: code, stage: 'failed_before_post' })
      } else if (stage === 'posting') {
        setPhotoMultiFailure(t('sale.photoNetworkFailed'), { errorCode: code, stage: 'failed_after_post' })
      } else {
        setPhotoMultiFailure(t('sale.photoMultiFailedGeneric'), { errorCode: code, stage: 'failed_before_post' })
      }
    } finally {
      setPhotoMultiStatus('idle')
    }
  }

  function addPhotoCandidateToCart(c: PhotoCandidate) {
    const productMatch = allProducts.find((p) => p.id === c.productId)
    if (!productMatch) {
      setPhotoError(t('sale.photoCandidateMissing'))
      return
    }
    addProductToCart(productMatch, 1)
    setPhotoModalOpen(false)
  }

  function addPhotoMultiCandidateToCart(itemIndex: number, c: PhotoCandidate) {
    const productMatch = allProducts.find((p) => p.id === c.productId)
    if (!productMatch) {
      setPhotoMultiError(t('sale.photoCandidateMissing'))
      return
    }
    addProductToCart(productMatch, 1)
    setPhotoMultiHandled((prev) => ({ ...prev, [itemIndex]: 'added' }))
    setPhotoMultiManualHintIndex(null)
  }

  function ignorePhotoMultiItem(itemIndex: number) {
    setPhotoMultiHandled((prev) => ({ ...prev, [itemIndex]: 'ignored' }))
    setPhotoMultiManualHintIndex(null)
  }

  // ── 收款方式选择 + 提交 ────────────────────────────────────────────────────

  function openPayModal() {
    if (cart.length === 0) return
    setCartDrawerOpen(false)
    setSubmitError(null)
    setModalError(null)
    setPayStep('selecting')
  }

  async function handlePayWithMethod(method: 'CASH' | 'KHQR') {
    if (method === 'KHQR' && khqrUnavailable) {
      setModalError(t('sale.khqrUnavailableHint'))
      return
    }
    setModalError(null)
    setSubmitError(null)
    setStatus('submitting')
    const cartSnapshot = [...cart]

    try {
      const res = await apiFetch('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          saleType: 'SALE',
          paymentMethod: method,
          items: cart.map((ci) => ({
            barcode: ci.product.barcode,
            quantity: ci.qty,
          })),
        }),
      })
      const body = await res.json()
      if (res.ok) {
        setPayStep('none')
        setCart([])
        if (method === 'CASH') {
          setSuccess({ ...body, paymentMethod: 'CASH', cartSnapshot })
        } else {
          setPendingPayment({
            id: body.paymentIntentId,
            orderNo: body.orderNo,
            amount: body.totalAmount,
            khqrPayload: body.khqrPayload ?? null,
            khqrImageUrl: body.khqrImageUrl ?? null,
            createdAt: body.createdAt,
            cartSnapshot,
          })
          setPayStep('khqr_pending')
        }
      } else if (body.error === 'KHQR_NOT_CONFIGURED') {
        // 保持 modal 打开，在弹窗内展示错误，不允许继续
        setKhqrUnavailable(true)
        setModalError(t('sale.khqrUnavailableHint'))
      } else {
        setPayStep('none')
        setSubmitError(body.message ?? body.error ?? t('sale.confirmSale'))
      }
    } catch {
      setPayStep('none')
      setSubmitError(t('common.networkError'))
    } finally {
      setStatus('idle')
    }
  }

  async function handleDeferredSubmit() {
    if (cart.length === 0) return
    setSubmitError(null)
    setStatus('submitting')
    const cartSnapshot = [...cart]
    try {
      const res = await apiFetch('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          saleType: 'SALE',
          paymentMethod: 'DEFER',
          items: cart.map((ci) => ({ barcode: ci.product.barcode, quantity: ci.qty })),
        }),
      })
      const body = await res.json()
      if (res.ok) {
        setCart([])
        setDeferredOrder({ ...body, cartSnapshot })
      } else {
        setSubmitError(body.message ?? body.error ?? t('common.networkError'))
      }
    } catch {
      setSubmitError(t('common.networkError'))
    } finally {
      setStatus('idle')
    }
  }

  async function handleCheckoutDeferred(method: 'CASH' | 'KHQR') {
    if (!deferredOrder) return
    if (method === 'KHQR' && khqrUnavailable) {
      setModalError(t('sale.khqrUnavailableHint'))
      return
    }
    setModalError(null)
    setSubmitError(null)
    setStatus('submitting')
    const cartSnapshot = deferredOrder.cartSnapshot
    try {
      const res = await apiFetch(`/api/orders/${encodeURIComponent(deferredOrder.orderNo)}/checkout`, {
        method: 'POST',
        body: JSON.stringify({ paymentMethod: method }),
      })
      const body = await res.json()
      if (res.ok) {
        setPayStep('none')
        setDeferredOrder(null)
        if (method === 'CASH') {
          setSuccess({
            orderNo: body.orderNo,
            totalAmount: body.totalAmount,
            itemCount: cartSnapshot.length,
            createdAt: new Date().toISOString(),
            paymentMethod: 'CASH',
            cartSnapshot,
          })
        } else {
          setPendingPayment({
            id: body.paymentIntentId,
            orderNo: body.orderNo,
            amount: body.totalAmount,
            khqrPayload: body.khqrPayload ?? null,
            khqrImageUrl: body.khqrImageUrl ?? null,
            createdAt: new Date().toISOString(),
            cartSnapshot,
          })
          setPayStep('khqr_pending')
        }
      } else if (body.error === 'KHQR_NOT_CONFIGURED') {
        setKhqrUnavailable(true)
        setModalError(t('sale.khqrUnavailableHint'))
      } else {
        setPayStep('none')
        setSubmitError(body.message ?? body.error ?? t('common.networkError'))
      }
    } catch {
      setPayStep('none')
      setSubmitError(t('common.networkError'))
    } finally {
      setStatus('idle')
    }
  }

  function handleClear() {
    setBarcodeInput('')
    setQty(1)
    setProduct(null)
    setQueryError(null)
    setSuccess(null)
    setSubmitError(null)
    setStatus('idle')
    setDropSearch('')
    setDropOpen(false)
    setShowSuggestions(false)
    setScannerMsg(null)
    setManualOpen(false)
    setCart([])
    setPayStep('none')
    setPendingPayment(null)
    setDeferredOrder(null)
    setModalError(null)
    focusInput()
  }

  // ── 成功卡商品摘要 ─────────────────────────────────────────────────────────
  function buildCartSummary(items: CartItem[]) {
    const shown = items.slice(0, 2).map((i) => `${i.product.name}×${i.qty}`)
    if (items.length > 2) shown.push(t('sale.moreItems').replace('{n}', String(items.length - 2)))
    return shown.join('、')
  }

  // ─── 渲染 ──────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      {/* 摄像头扫码弹窗（仅一维商品条码） */}
      {scannerOpen && (
        <BarcodeScanner
          onScanned={handleScanned}
          onClose={handleScannerClose}
          onCameraError={handleCameraError}
        />
      )}

      {/* AI 拍照识别弹层：真实 API 只返回候选，店员手动确认加入本单 */}
      {photoModalOpen && (
        <div style={ph.overlay} onClick={() => setPhotoModalOpen(false)}>
          <div style={ph.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={ph.header}>
              <span style={ph.title}>{t('sale.photoTitle')}</span>
              <button type="button" style={ph.closeBtn} onClick={() => setPhotoModalOpen(false)}>✕</button>
            </div>
            <div style={ph.intro}>{t('sale.photoIntro')}</div>
            {photoUsage && (
              <div style={ph.usage}>{t('sale.photoUsage').replace('{used}', String(photoUsage.usedToday)).replace('{limit}', String(photoUsage.dailyLimit))}</div>
            )}

            {/* 拍照 / 上传图片入口 */}
            <label style={ph.uploadBox}>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                style={{ display: 'none' }}
                disabled={photoStatus === 'loading'}
                onChange={(e) => {
                  void handlePhotoFile(e.target.files?.[0])
                  e.currentTarget.value = ''
                }}
              />
              <div style={ph.uploadIcon}>📷</div>
              <div style={ph.uploadText}>{t('sale.photoUploadText')}</div>
              <div style={ph.uploadHint}>{t('sale.photoUploadHint')}</div>
            </label>

            {/* 候选商品 / 空态 */}
            {photoStatus === 'loading' && (
              <div style={ph.empty}>{t('sale.photoLoading')}</div>
            )}
            {photoStatus !== 'loading' && photoError && (
              <div style={ph.empty}>{photoError}</div>
            )}
            {photoStatus !== 'loading' && photoError && photoDebug && (
              <>
                <button
                  type="button"
                  style={ph.debugToggle}
                  onClick={() => setPhotoDebugOpen((v) => !v)}
                >
                  {photoDebugOpen ? t('sale.photoDebugClose') : t('sale.photoDebugOpen')}
                </button>
                {photoDebugOpen && (
                  <div style={ph.debugBox}>
                    <div style={ph.debugTitle}>{t('sale.photoDebugTitle')}</div>
                    {photoDebug.fileType !== undefined && <div>file.type: {photoDebug.fileType}</div>}
                    {photoDebug.fileSize !== undefined && <div>file.size: {photoDebug.fileSize}</div>}
                    {photoDebug.compressedMime !== undefined && <div>compressedMime: {photoDebug.compressedMime}</div>}
                    {photoDebug.compressedSize !== undefined && <div>compressedSize: {photoDebug.compressedSize}</div>}
                    {photoDebug.apiStatus !== undefined && <div>apiStatus: {photoDebug.apiStatus}</div>}
                    {photoDebug.errorCode !== undefined && <div>errorCode: {photoDebug.errorCode}</div>}
                    {photoDebug.stage !== undefined && <div>stage: {photoDebug.stage}</div>}
                  </div>
                )}
              </>
            )}
            {photoStatus !== 'loading' && !photoError && photoCandidates.length === 0 && (
              <div style={ph.empty}>{t('sale.photoNoCandidates')}</div>
            )}
            {photoStatus !== 'loading' && !photoError && photoCandidates.length > 0 && (
              <>
                <div style={ph.candidatesLabel}>{t('sale.photoCandidatesLabel')}</div>
                <div style={ph.candidatesHint}>{t('sale.photoCandidatesHint')}</div>
                {photoCandidates.map((c) => (
                  <div key={c.productId} style={ph.candidate}>
                    <div style={ph.thumb}>
                      {c.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.imageUrl} alt={c.name} style={ph.thumbImg} />
                      ) : (
                        <span style={ph.thumbEmoji}>🛒</span>
                      )}
                    </div>
                    <div style={ph.candMeta}>
                      <div style={ph.candName}>{c.name}</div>
                      {c.spec && <div style={ph.candSpec}>{c.spec}</div>}
                      <div style={ph.candFoot}>
                        <span style={ph.candPrice}>${c.price.toFixed(2)}</span>
                        <span style={ph.candConf}>{Math.round(c.confidence * 100)}%</span>
                      </div>
                      {c.reason.length > 0 && (
                        <div style={ph.candReason}>{c.reason.join(' / ')}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      style={ph.candAddBtn}
                      onClick={() => addPhotoCandidateToCart(c)}
                    >
                      {t('sale.photoAddToCart')}
                    </button>
                  </div>
                ))}
              </>
            )}
            {process.env.NODE_ENV !== 'production' && photoStatus !== 'loading' && photoCandidates.length === 0 && (
              <button
                type="button"
                style={ph.mockBtn}
                onClick={() => {
                  const mockCandidates = photoMockCandidates.map((p) => ({
                    productId: p.id,
                    name: p.name,
                    spec: p.spec,
                    price: p.sellPrice,
                    imageUrl: p.imageUrl ?? null,
                    confidence: p.confidence,
                    reason: ['MOCK_DEV'],
                  }))
                  setPhotoError(null)
                  setPhotoCandidates(mockCandidates)
                }}
              >
                {t('sale.photoMockCandidatesDev')}
              </button>
            )}

            <div style={ph.disclaimer}>
              {t('sale.photoSafetyHint')}
            </div>
          </div>
        </div>
      )}

      {/* AI 多商品识别 Beta：只展示候选，店员逐项确认加入本单 */}
      {photoMultiModalOpen && (
        <div style={ph.overlay} onClick={() => setPhotoMultiModalOpen(false)}>
          <div style={ph.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={ph.header}>
              <span style={ph.title}>{t('sale.photoMultiTitle')}</span>
              <button type="button" style={ph.closeBtn} onClick={() => setPhotoMultiModalOpen(false)}>✕</button>
            </div>
            <div style={ph.intro}>{t('sale.photoMultiIntro')}</div>
            {photoMultiUsage && (
              <div style={ph.usage}>{t('sale.photoUsage').replace('{used}', String(photoMultiUsage.usedToday)).replace('{limit}', String(photoMultiUsage.dailyLimit))}</div>
            )}

            <label style={ph.uploadBox}>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                style={{ display: 'none' }}
                disabled={photoMultiStatus === 'loading'}
                onChange={(e) => {
                  void handlePhotoMultiFile(e.target.files?.[0])
                  e.currentTarget.value = ''
                }}
              />
              <div style={ph.uploadIcon}>📷</div>
              <div style={ph.uploadText}>{t('sale.photoUploadText')}</div>
              <div style={ph.uploadHint}>{t('sale.photoMultiUploadHint')}</div>
            </label>

            {photoMultiStatus === 'loading' && (
              <div style={ph.empty}>{t('sale.photoMultiLoading')}</div>
            )}
            {photoMultiStatus !== 'loading' && photoMultiError && (
              <div style={ph.empty}>{photoMultiError}</div>
            )}
            {photoMultiStatus !== 'loading' && photoMultiError && photoMultiDebug && (
              <>
                <button
                  type="button"
                  style={ph.debugToggle}
                  onClick={() => setPhotoMultiDebugOpen((v) => !v)}
                >
                  {photoMultiDebugOpen ? t('sale.photoDebugClose') : t('sale.photoDebugOpen')}
                </button>
                {photoMultiDebugOpen && (
                  <div style={ph.debugBox}>
                    <div style={ph.debugTitle}>{t('sale.photoDebugTitle')}</div>
                    {photoMultiDebug.fileType !== undefined && <div>file.type: {photoMultiDebug.fileType}</div>}
                    {photoMultiDebug.fileSize !== undefined && <div>file.size: {photoMultiDebug.fileSize}</div>}
                    {photoMultiDebug.compressedMime !== undefined && <div>compressedMime: {photoMultiDebug.compressedMime}</div>}
                    {photoMultiDebug.compressedSize !== undefined && <div>compressedSize: {photoMultiDebug.compressedSize}</div>}
                    {photoMultiDebug.apiStatus !== undefined && <div>apiStatus: {photoMultiDebug.apiStatus}</div>}
                    {photoMultiDebug.errorCode !== undefined && <div>errorCode: {photoMultiDebug.errorCode}</div>}
                    {photoMultiDebug.stage !== undefined && <div>stage: {photoMultiDebug.stage}</div>}
                  </div>
                )}
              </>
            )}
            {photoMultiStatus !== 'loading' && !photoMultiError && photoMultiItems.length === 0 && (
              <div style={ph.empty}>{t('sale.photoNoCandidates')}</div>
            )}
            {photoMultiStatus !== 'loading' && !photoMultiError && photoMultiItems.length > 0 && (
              <>
                <div style={ph.candidatesLabel}>{t('sale.photoMultiCandidatesLabel')}</div>
                <div style={ph.candidatesHint}>{t('sale.photoMultiCandidatesHint')}</div>
                {photoMultiItems.map((item, idx) => {
                  const itemKey = item.itemIndex
                  const handled = photoMultiHandled[itemKey]
                  const hint = item.aiHint
                  const hintParts = [
                    hint?.name,
                    hint?.brand,
                    hint?.spec,
                    hint?.category,
                    hint?.packageText,
                  ].filter(Boolean)
                  const candidates = item.candidates ?? []
                  return (
                    <div key={itemKey} style={ph.multiItem}>
                      <div style={ph.multiHeader}>
                        <div>
                          <div style={ph.multiTitle}>{t('sale.photoMultiItemTitle').replace('{n}', String(idx + 1))}</div>
                          <div style={ph.multiHint}>
                            {hintParts.length > 0 ? hintParts.join(' · ') : t('sale.photoMultiNoHint')}
                          </div>
                        </div>
                        {typeof hint?.confidence === 'number' && (
                          <span style={ph.candConf}>{Math.round(hint.confidence * 100)}%</span>
                        )}
                      </div>

                      {handled === 'added' && <div style={ph.multiDone}>{t('sale.photoMultiAdded')}</div>}
                      {handled === 'ignored' && <div style={ph.multiIgnored}>{t('sale.photoMultiIgnored')}</div>}

                      {candidates.length === 0 && (
                        <div style={ph.multiEmpty}>{t('sale.photoMultiEmpty')}</div>
                      )}
                      {candidates.map((c) => (
                        <div key={`${itemKey}-${c.productId}`} style={ph.candidate}>
                          <div style={ph.thumb}>
                            {c.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={c.imageUrl} alt={c.name} style={ph.thumbImg} />
                            ) : (
                              <span style={ph.thumbEmoji}>🛒</span>
                            )}
                          </div>
                          <div style={ph.candMeta}>
                            <div style={ph.candName}>{c.name}</div>
                            {c.spec && <div style={ph.candSpec}>{c.spec}</div>}
                            <div style={ph.candFoot}>
                              <span style={ph.candPrice}>${c.price.toFixed(2)}</span>
                              <span style={ph.candConf}>{Math.round(c.confidence * 100)}%</span>
                            </div>
                            {c.reason.length > 0 && (
                              <div style={ph.candReason}>{c.reason.join(' / ')}</div>
                            )}
                          </div>
                          <button
                            type="button"
                            style={{ ...ph.candAddBtn, ...(handled ? ph.candAddBtnDisabled : {}) }}
                            onClick={() => addPhotoMultiCandidateToCart(itemKey, c)}
                            disabled={Boolean(handled)}
                          >
                            {t('sale.photoAddToCart')}
                          </button>
                        </div>
                      ))}
                      <div style={ph.multiActions}>
                        <button
                          type="button"
                          style={ph.secondaryBtn}
                          onClick={() => ignorePhotoMultiItem(itemKey)}
                          disabled={Boolean(handled)}
                        >
                          {t('sale.photoMultiIgnore')}
                        </button>
                        <button
                          type="button"
                          style={ph.secondaryBtn}
                          onClick={() => setPhotoMultiManualHintIndex(itemKey)}
                        >
                          {t('sale.photoMultiManualSearch')}
                        </button>
                      </div>
                      {photoMultiManualHintIndex === itemKey && (
                        <div style={ph.multiManualHint}>{t('sale.photoMultiManualHint')}</div>
                      )}
                    </div>
                  )
                })}
              </>
            )}

            <div style={ph.disclaimer}>
              {t('sale.photoMultiSafetyHint')}
            </div>
          </div>
        </div>
      )}

      {/* 收款方式选择 Modal */}
      {payStep === 'selecting' && (
        <div style={pm.overlay} onClick={() => { setPayStep('none'); setModalError(null) }}>
          <div style={pm.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={pm.title}>{t('sale.paymentTitle')}</div>
            <button
              style={pm.option}
              onClick={() => deferredOrder ? handleCheckoutDeferred('CASH') : handlePayWithMethod('CASH')}
              disabled={status === 'submitting'}
            >
              <span style={pm.optionIcon}>💵</span>
              <div style={pm.optionText}>
                <span style={pm.optionLabel}>{t('sale.paymentCash')}</span>
                <span style={pm.optionDesc}>{t('sale.paymentCashDesc')}</span>
              </div>
            </button>
            <button
              style={{ ...pm.option, ...(khqrUnavailable ? pm.optionDisabled : {}) }}
              onClick={() => {
                if (khqrUnavailable) {
                  setModalError(t('sale.khqrUnavailableHint'))
                  return
                }
                deferredOrder ? handleCheckoutDeferred('KHQR') : handlePayWithMethod('KHQR')
              }}
              disabled={status === 'submitting'}
            >
              <span style={pm.optionIcon}>📱</span>
              <div style={pm.optionText}>
                <span style={pm.optionLabel}>
                  {t('sale.paymentKhqr')}
                  {khqrUnavailable && <span style={pm.unavailableBadge}>{t('sale.khqrUnavailableBadge')}</span>}
                </span>
                <span style={pm.optionDesc}>
                  {khqrUnavailable ? t('sale.khqrUnavailableDesc') : t('sale.paymentKhqrDesc')}
                </span>
              </div>
            </button>
            {modalError && (
              <div style={pm.modalErrorMsg}>{modalError}</div>
            )}
          </div>
        </div>
      )}

      {cartDrawerOpen && cart.length > 0 && (
        <div style={s.cartDrawerOverlay} onClick={() => setCartDrawerOpen(false)}>
          <div style={s.cartDrawer} onClick={(event) => event.stopPropagation()}>
            <div style={s.cartDrawerHeader}>
              <div>
                <div style={s.cartDrawerTitle}>{t('sale.cartDrawerTitle')}</div>
                <div style={s.cartDrawerMeta}>{cartItemCount} {t('sale.itemUnit')} · ${cartTotal.toFixed(2)}</div>
              </div>
              <button type="button" style={s.cartDrawerClose} onClick={() => setCartDrawerOpen(false)}>✕</button>
            </div>
            <div style={s.cartDrawerList}>
              {cart.map((ci) => (
                <CartItemRow key={`drawer-${ci.key}`} item={ci} itemUnit={t('sale.itemUnit')} onDelete={() => removeFromCart(ci.key)} />
              ))}
            </div>
            <div style={s.cartDrawerFooter}>
              <div style={s.cartDrawerTotalRow}>
                <span>{t('sale.total')}</span>
                <strong>${cartTotal.toFixed(2)}</strong>
              </div>
              <button type="button" style={s.cartDrawerCheckoutBtn} onClick={openPayModal}>
                {t('sale.confirmSale')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={s.saleHeader}>
        <div style={s.saleBrandLeft}>
          <span style={s.saleAvatar}>
            {storeAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={storeAvatarUrl} alt={displayStoreName} style={s.saleAvatarImg} onError={() => setAvatarFailed(true)} />
            ) : (
              storeInitial
            )}
          </span>
          <div style={s.saleBrandText}>
            <div style={s.saleStoreName}>{displayStoreName}</div>
            <div style={s.saleStoreSub}>{t('sale.workbenchSub')}</div>
          </div>
        </div>
        <div style={s.saleHeaderTools}>
          <LangToggleBtn />
          {realRole === 'OWNER' && (
            <span style={s.modeTag}>
              {isOwnerInStaffMode ? t('home.modeLabelStaff') : t('home.modeLabelOwner')}
            </span>
          )}
        </div>
      </div>

      <div style={s.body}>
        <div style={s.saleOverview}>
          <div>
            <div style={s.overviewLabel}>{t('sale.todaySalesMini')}</div>
            <div style={s.overviewAmount}>${(summary?.netAmount ?? 0).toFixed(2)}</div>
          </div>
          <div style={s.overviewStats}>
            <div style={s.overviewStat}>
              <span style={s.overviewStatValue}>${cartTotal.toFixed(2)}</span>
              <span style={s.overviewStatLabel}>{t('sale.currentCart')}</span>
            </div>
            <div style={s.overviewStat}>
              <span style={s.overviewStatValue}>{cartItemCount}</span>
              <span style={s.overviewStatLabel}>{t('sale.selectedItems')}</span>
            </div>
          </div>
        </div>

        {restorePrompt && !success && payStep !== 'khqr_pending' && (
          <div style={s.restoreCard}>
            <div style={s.restoreTitle}>{t('sale.restoreTitle')}</div>
            <div style={s.restoreMeta}>
              {t('sale.restoreSummary')
                .replace('{count}', String(restorePrompt.itemCount))
                .replace('{amount}', `$${restorePrompt.totalAmount.toFixed(2)}`)}
              {cart.length > 0 ? ` · ${t('sale.restoreCartHasItems')}` : ''}
            </div>
            <div style={s.restoreActions}>
              <button type="button" style={s.restorePrimaryBtn} onClick={continueRestoredOrder} disabled={restoreBusy}>
                {t('sale.restoreContinue')}
              </button>
              <button type="button" style={s.restoreSecondaryBtn} onClick={cancelRestoredOrder} disabled={restoreBusy}>
                {t('sale.restoreCancel')}
              </button>
            </div>
          </div>
        )}

        {/* ══ KHQR 待收款 ══ */}
        {payStep === 'khqr_pending' && pendingPayment && (
          <KhqrSheet
            orderNo={pendingPayment.orderNo}
            totalAmount={pendingPayment.amount}
            paymentIntentId={pendingPayment.id}
            khqrPayload={pendingPayment.khqrPayload}
            khqrImageUrl={pendingPayment.khqrImageUrl}
            onSuccess={() => {
              setSuccess({
                orderNo: pendingPayment.orderNo,
                totalAmount: pendingPayment.amount,
                itemCount: pendingPayment.cartSnapshot.length,
                createdAt: pendingPayment.createdAt,
                paymentMethod: 'KHQR',
                cartSnapshot: pendingPayment.cartSnapshot,
              })
              setPendingPayment(null)
              setPayStep('none')
            }}
            onCancel={() => {
              setPendingPayment(null)
              setPayStep('none')
            }}
          />
        )}

        {/* ══ 已挂单 ══ */}
        {deferredOrder && !success && payStep !== 'khqr_pending' && (
          <div style={s.successCard}>
            <div style={s.successIconWrap}>⏳</div>
            <div style={s.successTitle}>{t('sale.deferredSuccess')}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12, textAlign: 'center' }}>{t('sale.deferredHint')}</div>
            <div style={s.successGrid}>
              <InfoRow label={t('sale.orderNo')} value={deferredOrder.orderNo} mono />
              <InfoRow label={t('sale.totalAmount')} value={`$${deferredOrder.totalAmount.toFixed(2)}`} bold />
              <InfoRow label={t('sale.product')} value={buildCartSummary(deferredOrder.cartSnapshot)} />
              <InfoRow label={t('sale.time')} value={new Date(deferredOrder.createdAt).toLocaleTimeString('zh-CN')} />
            </div>
            {submitError && <div style={{ ...s.errorMsg, marginBottom: 8 }}>{submitError}</div>}
            <button style={s.submitBtn} onClick={openPayModal}>{t('sale.checkoutNow')}</button>
            <button style={{ ...s.nextBtn, marginTop: 8 }} onClick={handleClear}>{t('sale.nextOrder')}</button>
          </div>
        )}

        {/* ══ 成功状态 ══ */}
        {success && payStep !== 'khqr_pending' && (
          <div style={s.successCard}>
            <div style={s.successIconWrap}>✓</div>
            <div style={s.successTitle}>{t('sale.saleSuccess')}</div>
            <div style={s.successGrid}>
              <InfoRow label={t('sale.orderNo')} value={success.orderNo} mono />
              <InfoRow label={t('sale.totalAmount')} value={`$${success.totalAmount.toFixed(2)}`} bold />
              <InfoRow label={t('sale.product')} value={buildCartSummary(success.cartSnapshot)} />
              <InfoRow label={t('sale.time')} value={new Date(success.createdAt).toLocaleTimeString('zh-CN')} />
            </div>
            <button style={s.nextBtn} onClick={handleClear}>{t('sale.nextOrder')}</button>
          </div>
        )}

        {/* ══ 主流程 ══ */}
        {!success && !deferredOrder && payStep !== 'khqr_pending' && (
          <>
            {/* 查询卡：搜索 / 摄像头扫码 / 下拉选择 */}
            <div style={s.searchCard}>
              <div style={s.cardLabel}>{t('sale.selectProduct')}</div>
              {scannerMsg && (
                <div style={scannerMsg.type === 'ok' ? s.scannerOkMsg : s.scannerFailMsg}>
                  {scannerMsg.text}
                </div>
              )}
              <div ref={suggestWrapRef} style={s.suggestWrap}>
                <div style={s.searchInputRow}>
                  <input
                    ref={inputRef}
                    style={s.searchInput}
                    type="text"
                    placeholder={t('products.searchSkuPlaceholder')}
                    value={barcodeInput}
                    onChange={(e) => { setBarcodeInput(e.target.value); if (product) setProduct(null) }}
                    onKeyDown={handleBarcodeKeyDown}
                    onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
                  />
                  <button type="button" style={s.searchScanBtn} onClick={scanBarcode} disabled={status === 'querying' || status === 'submitting'} aria-label={t('products.scanIconLabel')}>
                    ⊡
                  </button>
                </div>
                {showSuggestions && (
                  <div style={s.suggestPanel}>
                    {suggestions.map((p) => (
                      <div key={p.id} style={s.suggestItem} onMouseDown={(e) => { e.preventDefault(); selectProduct(p) }}>
                        <span style={s.suggestCode}>{p.barcode}</span>
                        <span style={s.suggestName}>{p.name}</span>
                        {p.spec && <span style={s.suggestSpec}> · {p.spec}</span>}
                        <span style={s.suggestPrice}>${p.sellPrice.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {cameraFailCount >= 5 && <div style={s.scanHintMsg}>{t('sale.scanFailHint')}</div>}
              {queryError && <div style={s.errorMsg}>{queryError}</div>}
              {isHidTier && hidFailCount >= 5 && <div style={s.scanHintMsg}>{t('sale.hidFailHint')}</div>}

              <div style={s.aiSaleEntry} onClick={openPhotoModal}>
                <div style={s.aiSaleEntryText}>
                  <div style={s.aiSaleTitle}>{t('sale.photoTitle')}</div>
                  <div style={s.aiSaleSub}>{t('sale.aiSaleEntrySub')}</div>
                </div>
                <button
                  type="button"
                  style={s.aiSaleBtn}
                  onClick={(e) => { e.stopPropagation(); openPhotoModal() }}
                  disabled={status === 'querying' || status === 'submitting'}
                >
                  {t('sale.aiStart')}
                </button>
              </div>
              {isPhotoMultiEnabled && (
                <button
                  type="button"
                  style={ph.multiEntryBtn}
                  onClick={openPhotoMultiModal}
                  disabled={status === 'querying' || status === 'submitting'}
                >
                  📷 {t('sale.photoMultiTitle')}
                </button>
              )}

              {recentQuickProducts.length > 0 && (
                <div style={s.recentProductsBlock}>
                  <div style={s.recentProductsHeader}>{t('sale.recentProducts')}</div>
                  <div style={s.recentProductsGrid}>
                    {recentQuickProducts.map((p) => {
                      const img = productImageUrl(p)
                      return (
                        <button
                          key={p.id}
                          type="button"
                          style={s.recentProductCard}
                          onClick={() => selectProduct(p)}
                        >
                          <span style={s.recentProductThumb}>
                            {img ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={img}
                                alt={p.name}
                                style={s.recentProductImg}
                                onError={(event) => {
                                  event.currentTarget.style.display = 'none'
                                }}
                              />
                            ) : (
                              <span style={s.recentProductPlaceholder}>□</span>
                            )}
                          </span>
                          <span style={s.recentProductInfo}>
                            <span style={s.recentProductName}>{p.name}</span>
                            <span style={s.recentProductMeta}>
                              {p.spec ? `${p.spec} · ` : ''}$${p.sellPrice.toFixed(2)}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {allProducts.length > 0 ? (
                <div ref={dropRef} style={s.dropWrap}>
                  <div style={s.dropTrigger} onClick={() => setDropOpen((v) => !v)}>
                    <span style={s.dropTriggerText}>
                      {product ? `${product.name}${product.spec ? ' · ' + product.spec : ''}` : t('sale.allProducts')}
                    </span>
                    <span style={s.dropArrow}>{dropOpen ? '▲' : '▼'}</span>
                  </div>
                  {dropOpen && (
                    <div style={s.dropPanel}>
                      <input
                        style={s.dropSearch}
                        type="text"
                        placeholder={t('sale.dropSearch')}
                        value={dropSearch}
                        onChange={(e) => setDropSearch(e.target.value)}
                      />
                      <div style={s.dropList}>
                        {filteredDrop.length === 0 && <div style={s.dropEmpty}>{t('sale.noMatch')}</div>}
                        {filteredDrop.map((p) => (
                          <div key={p.id} style={s.dropItem} onMouseDown={(e) => { e.preventDefault(); selectProduct(p) }}>
                            <span style={s.dropCode}>{p.barcode}</span>
                            <span style={s.dropName}>{p.name}</span>
                            {p.spec && <span style={s.dropSpec}>{p.spec}</span>}
                            <span style={s.dropPrice}>${p.sellPrice.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={s.dropEmpty}>{t('sale.loadingProducts')}</div>
              )}

              <div style={s.orDivider}>
                <div style={s.orLine} />
                <button type="button" style={s.manualToggle} onClick={() => { setManualOpen((v) => !v); setScannerMsg(null) }}>
                  {manualOpen ? t('sale.manualClose') : t('sale.manualOpen')}
                </button>
                <div style={s.orLine} />
              </div>

              {manualOpen && (
                <>
                  <div style={s.scanHintMsg}>{t('sale.manualHint')}</div>
                  <div style={s.suggestWrap}>
                    <div style={s.inputRow}>
                      <input
                        style={s.textInput}
                        type="text"
                        placeholder={t('sale.inputPlaceholder')}
                        value={barcodeInput}
                        onChange={(e) => { setBarcodeInput(e.target.value); if (product) setProduct(null) }}
                        onKeyDown={handleBarcodeKeyDown}
                        onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
                      />
                      <button style={s.queryBtn} type="button" onClick={queryProduct} disabled={status === 'querying' || !barcodeInput.trim()}>
                        {status === 'querying' ? t('sale.querying') : t('sale.queryBtn')}
                      </button>
                    </div>
                    {showSuggestions && (
                      <div style={s.suggestPanel}>
                        {suggestions.map((p) => (
                          <div key={p.id} style={s.suggestItem} onMouseDown={(e) => { e.preventDefault(); selectProduct(p) }}>
                            <span style={s.suggestCode}>{p.barcode}</span>
                            <span style={s.suggestName}>{p.name}</span>
                            {p.spec && <span style={s.suggestSpec}> · {p.spec}</span>}
                            <span style={s.suggestPrice}>${p.sellPrice.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* 空提示 */}
            {!product && cart.length === 0 && (
              <div style={s.emptyState}>
                <div style={s.emptyIcon}>⊡</div>
                <div style={s.emptyTitle}>{t('sale.emptyTitle')}</div>
                <div style={s.emptyDesc}>{t('sale.emptyDesc')}</div>
              </div>
            )}

            {/* 商品已选：步进器 + 加入本单 */}
            {product && (
              <div style={s.card}>
                <div style={s.selectedProductTop}>
                  <div style={s.selectedProductThumb}>
                    {selectedProductImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedProductImageUrl}
                        alt={product.name}
                        style={s.selectedProductImg}
                        onError={(event) => {
                          event.currentTarget.style.display = 'none'
                        }}
                      />
                    ) : (
                      <span style={s.selectedProductPlaceholder}>□</span>
                    )}
                  </div>
                  <div style={s.selectedProductInfo}>
                    <div style={s.productName}>{product.name}</div>
                    {product.spec && <div style={s.productSpec}>{product.spec}</div>}
                  </div>
                  <div style={s.selectedProductPrice}>
                    <span style={s.priceLabel}>{t('sale.unitPrice')}</span>
                    <span style={s.priceValue}>${product.sellPrice.toFixed(2)}</span>
                  </div>
                </div>

                <div style={{ ...s.cardLabel, marginTop: 12 }}>{t('sale.qty')}</div>
                <div style={s.stepperRow}>
                  <button type="button" style={s.stepperBtn} onClick={() => setQty(Math.max(1, safeQty - 1))}>−</button>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    style={s.stepperInput}
                    value={qty || ''}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, '')
                      setQty(raw === '' ? 0 : Math.min(999, parseInt(raw, 10)))
                    }}
                    onBlur={() => { if (!qty || qty < 1) setQty(1) }}
                  />
                  <button type="button" style={s.stepperBtn} onClick={() => setQty(safeQty + 1)}>+</button>
                </div>
                <div style={s.quickQtyRow} aria-label={t('sale.quickQty')}>
                  {[1, 2, 5, 10].map((nextQty) => (
                    <button
                      key={nextQty}
                      type="button"
                      style={{ ...s.quickQtyBtn, ...(safeQty === nextQty ? s.quickQtyBtnActive : {}) }}
                      onClick={() => setQty(nextQty)}
                    >
                      {nextQty}
                    </button>
                  ))}
                </div>

                <div style={s.subtotalRow}>
                  <span style={s.subtotalLabel}>{t('sale.subtotal')}</span>
                  <span style={s.subtotalValue}>${(product.sellPrice * safeQty).toFixed(2)}</span>
                </div>

                <button style={s.addBtn} onClick={addToCart}>{t('sale.addToCart')}</button>
              </div>
            )}

            {/* 购物车 */}
            {cart.length > 0 && (
              <>
                <div style={s.cartHeader}>
                  <span style={s.cartHeaderText}>{t('sale.cartHeader')}（{cart.length} {t('sale.kindUnit')}）</span>
                  <button style={s.clearCartBtn} onClick={() => setCart([])}>{t('sale.clearCart')}</button>
                </div>

                {cart.map((ci) => (
                  <CartItemRow key={ci.key} item={ci} itemUnit={t('sale.itemUnit')} onDelete={() => removeFromCart(ci.key)} />
                ))}

                {!product && (
                  <div style={s.checkoutBar}>
                    <div
                      style={{ ...s.totalCard, ...s.totalCardClickable }}
                      role="button"
                      tabIndex={0}
                      onClick={() => setCartDrawerOpen(true)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setCartDrawerOpen(true)
                        }
                      }}
                    >
                      <span style={s.totalLabel}>{t('sale.total')}</span>
                      <span style={s.totalAmount}>${cartTotal.toFixed(2)}</span>
                    </div>

                    {submitError && <div style={s.errorMsg}>{submitError}</div>}

                    <button
                      style={{ ...s.submitBtn, ...(status === 'submitting' ? s.submitBtnLoading : {}) }}
                      disabled={status === 'submitting'}
                      onClick={openPayModal}
                    >
                      {status === 'submitting' ? t('common.submitting') : t('sale.confirmSale')}
                    </button>
                    <button
                      style={{ ...s.deferBtn, ...(status === 'submitting' ? s.submitBtnLoading : {}) }}
                      disabled={status === 'submitting'}
                      onClick={handleDeferredSubmit}
                    >
                      {t('sale.deferBtn')}
                    </button>
                  </div>
                )}
              </>
            )}

            {product && <div style={s.floatingAddSpacer} />}
          </>
        )}
      </div>
      {product && (
        <div style={s.floatingAddBar} aria-live="polite">
          <div style={s.floatingAddProduct}>
            <div style={s.floatingAddThumb}>
              {selectedProductImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedProductImageUrl}
                  alt={product.name}
                  style={s.floatingAddImg}
                  onError={(event) => {
                    event.currentTarget.style.display = 'none'
                  }}
                />
              ) : (
                <span style={s.floatingAddPlaceholder}>□</span>
              )}
            </div>
            <div style={s.floatingAddInfo}>
              <div style={s.floatingAddName}>{product.name}</div>
              <div style={s.floatingAddMeta}>
                {product.spec ? `${product.spec} · ` : ''}
                {t('sale.qty')} {safeQty}
              </div>
            </div>
          </div>
          <div style={s.floatingAddActions}>
            <div style={s.floatingAddSubtotal}>${(product.sellPrice * safeQty).toFixed(2)}</div>
            <button type="button" style={s.floatingAddBtn} onClick={addToCart}>
              {t('sale.addToCartFloating')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── CartItemRow ──────────────────────────────────────────────────────────────

function CartItemRow({ item, itemUnit, onDelete }: { item: CartItem; itemUnit: string; onDelete: () => void }) {
  return (
    <div style={ci.card}>
      <div style={ci.top}>
        <div style={ci.nameWrap}>
          <span style={ci.name}>{item.product.name}</span>
          {item.product.spec && <span style={ci.spec}> · {item.product.spec}</span>}
        </div>
        <button style={ci.del} onClick={onDelete}>✕</button>
      </div>
      <div style={ci.bottom}>
        <span style={ci.meta}>{item.qty} {itemUnit} × ${item.product.sellPrice.toFixed(2)}</span>
        <span style={ci.subtotal}>${(item.qty * item.product.sellPrice).toFixed(2)}</span>
      </div>
    </div>
  )
}

const ci: Record<string, React.CSSProperties> = {
  card: { background: 'var(--card)', borderRadius: 'var(--radius)', padding: '11px 14px', marginBottom: 8 },
  top: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  nameWrap: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  name: { fontSize: 15, fontWeight: 600, color: 'var(--text)' },
  spec: { fontSize: 13, color: 'var(--muted)' },
  del: { flexShrink: 0, background: 'none', border: 'none', color: '#bbb', fontSize: 16, padding: '0 0 0 8px', lineHeight: 1 },
  bottom: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  meta: { fontSize: 13, color: 'var(--muted)' },
  subtotal: { fontSize: 16, fontWeight: 700, color: 'var(--text)' },
}

// ─── InfoRow ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value, mono, bold }: {
  label: string; value: string; mono?: boolean; bold?: boolean
}) {
  return (
    <div style={ir.row}>
      <span style={ir.label}>{label}</span>
      <span style={{ ...ir.value, ...(mono ? ir.mono : {}), ...(bold ? ir.bold : {}) }}>{value}</span>
    </div>
  )
}

const ir: Record<string, React.CSSProperties> = {
  row: { display: 'flex', justifyContent: 'space-between', padding: '5px 0' },
  label: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  value: { fontSize: 13, color: '#fff' },
  mono: { fontFamily: 'monospace', fontSize: 11 },
  bold: { fontWeight: 700, fontSize: 17 },
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f7f8fa', display: 'flex', flexDirection: 'column', overflowX: 'hidden' },
  saleHeader: {
    width: '100%',
    maxWidth: 480,
    margin: '0 auto',
    padding: '10px 12px 6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexShrink: 0,
  },
  saleBrandLeft: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 },
  saleAvatar: {
    width: 42,
    height: 42,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #e0f2fe, #dcfce7)',
    color: '#0f766e',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    fontWeight: 900,
    overflow: 'hidden',
    flexShrink: 0,
    boxShadow: '0 6px 14px rgba(15,23,42,0.08)',
  },
  saleAvatarImg: { width: '100%', height: '100%', objectFit: 'cover' },
  saleBrandText: { display: 'flex', flexDirection: 'column', minWidth: 0, gap: 1 },
  saleStoreName: { fontSize: 16, fontWeight: 900, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  saleStoreSub: { fontSize: 11, fontWeight: 700, color: '#64748b' },
  saleHeaderTools: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  modeTag: {
    height: 32,
    border: '1px solid #e5e7eb',
    borderRadius: 999,
    background: '#fff',
    color: '#334155',
    padding: '0 10px',
    fontSize: 11,
    fontWeight: 800,
    whiteSpace: 'nowrap',
    boxShadow: '0 4px 10px rgba(15,23,42,0.04)',
    display: 'inline-flex',
    alignItems: 'center',
  },
  headerBar: { background: 'var(--blue)', padding: '16px 16px 18px', display: 'flex', alignItems: 'center', flexShrink: 0 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 700, letterSpacing: '0.02em' },
  body: { flex: 1, width: '100%', maxWidth: 480, margin: '0 auto', padding: '8px 12px 20px' },
  saleOverview: {
    minHeight: 82,
    borderRadius: 22,
    padding: '13px 14px',
    marginBottom: 10,
    background: 'linear-gradient(135deg, #ecfeff 0%, #eff6ff 55%, #ffffff 100%)',
    border: '1px solid rgba(186,230,253,0.72)',
    boxShadow: '0 12px 26px rgba(14,165,233,0.10)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  overviewLabel: { fontSize: 12, color: '#0369a1', fontWeight: 800, marginBottom: 3 },
  overviewAmount: { fontSize: 28, color: '#0f172a', fontWeight: 950, letterSpacing: '-0.04em' },
  overviewStats: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, minWidth: 150 },
  overviewStat: {
    borderRadius: 15,
    background: 'rgba(255,255,255,0.75)',
    border: '1px solid rgba(226,232,240,0.85)',
    padding: '8px 8px',
    textAlign: 'center',
  },
  overviewStatValue: { display: 'block', fontSize: 15, fontWeight: 900, color: '#111827', lineHeight: 1.1 },
  overviewStatLabel: { display: 'block', fontSize: 10, fontWeight: 700, color: '#64748b', marginTop: 3 },

  card: { background: 'var(--card)', borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 10 },
  searchCard: { background: '#fff', borderRadius: 22, padding: '13px 14px', marginBottom: 10, boxShadow: '0 10px 24px rgba(15,23,42,0.05)', border: '1px solid rgba(226,232,240,0.85)' },
  cardLabel: { fontSize: 12, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 },

  scanRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', height: 48, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 16, fontWeight: 600, marginBottom: 12 },
  scanIcon: { fontSize: 22 },
  scanLabel: { fontSize: 15, fontWeight: 600 },

  orDivider: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  orLine: { flex: 1, height: 1, background: 'var(--border)' },
  orText: { fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' },

  suggestWrap: { position: 'relative' },
  searchInputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    borderRadius: 18,
    background: '#f8fafc',
    border: '1.5px solid #e5e7eb',
    padding: '0 8px 0 13px',
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 50,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 16,
    color: '#111827',
  },
  searchScanBtn: {
    width: 42,
    height: 42,
    borderRadius: 15,
    border: 'none',
    background: '#1677ff',
    color: '#fff',
    fontSize: 24,
    fontWeight: 800,
    lineHeight: 1,
    cursor: 'pointer',
    flexShrink: 0,
    boxShadow: '0 8px 16px rgba(22,119,255,0.18)',
  },
  inputRow: { display: 'flex', gap: 8 },
  textInput: { flex: 1, height: 44, minWidth: 0, border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0 12px', fontSize: 16, outline: 'none', background: '#f7f8fa' },
  queryBtn: { flexShrink: 0, height: 44, padding: '0 18px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 15, fontWeight: 600 },

  suggestPanel: { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: '0 6px 20px rgba(0,0,0,0.12)', zIndex: 300, overflow: 'hidden', marginTop: 2 },
  suggestItem: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' },
  suggestCode: { fontSize: 11, fontFamily: 'monospace', color: 'var(--muted)', flexShrink: 0, minWidth: 52 },
  suggestName: { flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  suggestSpec: { fontSize: 12, color: 'var(--muted)', flexShrink: 0 },
  suggestPrice: { fontSize: 13, fontWeight: 700, color: 'var(--blue)', flexShrink: 0, marginLeft: 'auto' },

  dropWrap: { position: 'relative' },
  dropTrigger: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 42, border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0 12px', background: '#f7f8fa', cursor: 'pointer', gap: 8, marginTop: 10 },
  dropTriggerText: { flex: 1, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dropArrow: { fontSize: 10, color: 'var(--muted)', flexShrink: 0 },
  dropPanel: { position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#fff', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: '0 6px 20px rgba(0,0,0,0.12)', zIndex: 200, overflow: 'hidden' },
  dropSearch: { display: 'block', width: '100%', height: 40, border: 'none', borderBottom: '1px solid var(--border)', padding: '0 12px', fontSize: 14, outline: 'none', background: '#fafafa' },
  dropList: { maxHeight: 200, overflowY: 'auto' },
  dropItem: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' },
  dropCode: { fontSize: 11, fontFamily: 'monospace', color: 'var(--muted)', flexShrink: 0, minWidth: 52 },
  dropName: { flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dropSpec: { fontSize: 12, color: 'var(--muted)', flexShrink: 0 },
  dropPrice: { fontSize: 13, fontWeight: 700, color: 'var(--blue)', flexShrink: 0, marginLeft: 'auto' },
  dropEmpty: { padding: '14px 12px', fontSize: 13, color: 'var(--muted)', textAlign: 'center' },

  errorMsg: { fontSize: 13, color: 'var(--red)', padding: '6px 2px 0' },
  scanHintMsg: { fontSize: 12, color: '#fa8c16', background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6, padding: '6px 10px', marginBottom: 8 },
  scannerOkMsg: { fontSize: 13, color: '#389e0d', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, padding: '6px 10px', marginBottom: 8 },
  scannerFailMsg: { fontSize: 13, color: '#cf1322', background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 6, padding: '6px 10px', marginBottom: 8 },
  manualToggle: { background: 'none', border: 'none', fontSize: 12, color: 'var(--blue)', padding: '0 8px', whiteSpace: 'nowrap', cursor: 'pointer' },
  aiSaleEntry: {
    marginTop: 10,
    borderRadius: 20,
    background: 'linear-gradient(135deg, #f5f3ff 0%, #eef2ff 100%)',
    border: '1px solid rgba(196,181,253,0.6)',
    padding: '12px 12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    cursor: 'pointer',
  },
  aiSaleEntryText: { minWidth: 0, flex: 1 },
  aiSaleTitle: { fontSize: 15, fontWeight: 900, color: '#312e81', marginBottom: 3 },
  aiSaleSub: { fontSize: 11, fontWeight: 700, color: '#64748b', lineHeight: 1.35 },
  aiSaleBtn: {
    flexShrink: 0,
    border: 'none',
    borderRadius: 999,
    background: '#4f46e5',
    color: '#fff',
    height: 36,
    padding: '0 13px',
    fontSize: 12,
    fontWeight: 850,
    boxShadow: '0 8px 16px rgba(79,70,229,0.18)',
  },
  recentProductsBlock: { marginTop: 10, marginBottom: 10 },
  recentProductsHeader: { fontSize: 13, fontWeight: 900, color: '#334155', marginBottom: 8 },
  recentProductsGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 },
  recentProductCard: {
    minWidth: 0,
    minHeight: 58,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    border: '1px solid #e2e8f0',
    borderRadius: 18,
    background: '#fff',
    textAlign: 'left',
    boxShadow: '0 8px 18px rgba(15,23,42,0.04)',
    cursor: 'pointer',
  },
  recentProductThumb: {
    width: 38,
    height: 38,
    borderRadius: 13,
    background: '#f1f5f9',
    overflow: 'hidden',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#94a3b8',
    fontWeight: 900,
  },
  recentProductImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  recentProductPlaceholder: { fontSize: 18, lineHeight: 1 },
  recentProductInfo: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  recentProductName: { fontSize: 12, fontWeight: 850, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  recentProductMeta: { fontSize: 11, fontWeight: 700, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '36px 20px', gap: 8 },
  emptyIcon: { fontSize: 44, color: '#d0d0d0', lineHeight: 1, marginBottom: 4 },
  emptyTitle: { fontSize: 15, fontWeight: 600, color: '#bbb' },
  emptyDesc: { fontSize: 13, color: '#ccc' },

  selectedProductTop: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 },
  selectedProductThumb: {
    width: 58,
    height: 58,
    borderRadius: 18,
    background: '#f1f5f9',
    overflow: 'hidden',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#94a3b8',
    fontWeight: 900,
  },
  selectedProductImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  selectedProductPlaceholder: { fontSize: 24, lineHeight: 1 },
  selectedProductInfo: { flex: 1, minWidth: 0 },
  selectedProductPrice: { flexShrink: 0, minWidth: 78, textAlign: 'right' },
  productName: { fontSize: 17, fontWeight: 850, color: 'var(--text)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  productSpec: { fontSize: 13, fontWeight: 650, color: 'var(--muted)' },
  priceRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid var(--border)' },
  priceLabel: { display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 2 },
  priceValue: { fontSize: 20, fontWeight: 700, color: 'var(--text)' },

  stepperRow: { display: 'flex', alignItems: 'center', background: '#f7f8fa', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', overflow: 'hidden', width: '100%', marginBottom: 12 },
  stepperBtn: { width: 52, height: 46, flexShrink: 0, background: 'none', border: 'none', fontSize: 24, color: 'var(--blue)', fontWeight: 300, lineHeight: 1 },
  stepperInput: { flex: 1, textAlign: 'center', fontSize: 22, fontWeight: 700, color: 'var(--text)', background: 'transparent', border: 'none', outline: 'none', width: '100%' },
  quickQtyRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, margin: '-2px 0 14px' },
  quickQtyBtn: {
    height: 38,
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    background: '#fff',
    color: '#334155',
    fontSize: 14,
    fontWeight: 850,
    cursor: 'pointer',
  },
  quickQtyBtnActive: { background: '#eff6ff', borderColor: '#93c5fd', color: '#2563eb', boxShadow: '0 6px 14px rgba(37,99,235,0.1)' },

  subtotalRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 14, marginBottom: 12, borderBottom: '1px solid var(--border)' },
  subtotalLabel: { fontSize: 13, color: 'var(--muted)' },
  subtotalValue: { fontSize: 18, fontWeight: 700, color: 'var(--text)' },

  addBtn: { display: 'block', width: '100%', height: 48, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 16, fontWeight: 700 },

  floatingAddSpacer: { height: 96 },
  floatingAddBar: {
    position: 'fixed',
    left: 12,
    right: 12,
    bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
    zIndex: 90,
    maxWidth: 560,
    margin: '0 auto',
    minHeight: 76,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: '10px 10px 10px 12px',
    borderRadius: 22,
    background: 'linear-gradient(135deg, #1677ff 0%, #2563eb 45%, #4f46e5 100%)',
    border: '1px solid rgba(255,255,255,0.24)',
    boxShadow: '0 18px 46px rgba(37,99,235,0.34)',
    backdropFilter: 'blur(16px)',
  },
  floatingAddProduct: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 },
  floatingAddThumb: {
    width: 48,
    height: 48,
    borderRadius: 16,
    background: 'rgba(255,255,255,0.94)',
    overflow: 'hidden',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#2563eb',
    fontWeight: 800,
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)',
  },
  floatingAddImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  floatingAddPlaceholder: { fontSize: 22, lineHeight: 1 },
  floatingAddInfo: { minWidth: 0, flex: 1 },
  floatingAddName: {
    fontSize: 14,
    fontWeight: 900,
    color: '#fff',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginBottom: 3,
  },
  floatingAddMeta: {
    fontSize: 12,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.82)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  floatingAddActions: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  floatingAddSubtotal: { fontSize: 16, fontWeight: 950, color: '#fff', whiteSpace: 'nowrap' },
  floatingAddBtn: {
    minWidth: 108,
    height: 46,
    border: 'none',
    borderRadius: 16,
    background: 'rgba(255,255,255,0.95)',
    color: '#1d4ed8',
    fontSize: 14,
    fontWeight: 900,
    boxShadow: '0 10px 22px rgba(15,23,42,0.18)',
    cursor: 'pointer',
  },

  cartHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 2px' },
  cartHeaderText: { fontSize: 13, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  clearCartBtn: { background: 'none', border: 'none', color: '#bbb', fontSize: 12, padding: 0 },

  checkoutBar: {
    position: 'sticky',
    bottom: 8,
    zIndex: 40,
    background: 'rgba(247,248,250,0.92)',
    backdropFilter: 'blur(10px)',
    borderRadius: 22,
    padding: '8px',
    marginTop: 6,
    boxShadow: '0 -10px 28px rgba(15,23,42,0.08)',
    border: '1px solid rgba(226,232,240,0.82)',
  },
  totalCard: { background: '#111827', borderRadius: 18, padding: '12px 15px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  totalCardClickable: { cursor: 'pointer' },
  totalLabel: { fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: 500 },
  totalAmount: { fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' },

  submitBtn: { display: 'block', width: '100%', height: 50, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 16, fontWeight: 700, marginBottom: 8 },
  deferBtn: { display: 'block', width: '100%', height: 44, background: 'transparent', color: 'var(--blue)', border: '1.5px solid var(--blue)', borderRadius: 'var(--radius-sm)', fontSize: 15, fontWeight: 600, marginBottom: 8, cursor: 'pointer' },
  submitBtnLoading: { opacity: 0.7 },

  successCard: { background: 'var(--blue)', borderRadius: 'var(--radius)', padding: '28px 20px 22px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginBottom: 12 },
  successIconWrap: { width: 52, height: 52, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, color: '#fff', marginBottom: 6 },
  successTitle: { fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 14 },
  successGrid: { width: '100%', borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 12, marginBottom: 18 },
  nextBtn: { height: 44, padding: '0 32px', background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 'var(--radius-sm)', fontSize: 15, fontWeight: 600 },
  restoreCard: { background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 10 },
  restoreTitle: { fontSize: 15, fontWeight: 800, color: '#9a3412', marginBottom: 4 },
  restoreMeta: { fontSize: 13, color: '#c2410c', lineHeight: 1.5, marginBottom: 10 },
  restoreActions: { display: 'flex', gap: 8 },
  restorePrimaryBtn: { flex: 1, height: 38, border: 'none', borderRadius: 8, background: '#ea580c', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer' },
  restoreSecondaryBtn: { flex: 1, height: 38, border: '1px solid #fdba74', borderRadius: 8, background: '#fff', color: '#9a3412', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  cartDrawerOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 480,
    background: 'rgba(15,23,42,0.28)',
    display: 'flex',
    justifyContent: 'flex-end',
  },
  cartDrawer: {
    width: 'min(390px, 92vw)',
    height: '100%',
    background: '#f8fafc',
    boxShadow: '-18px 0 44px rgba(15,23,42,0.2)',
    display: 'flex',
    flexDirection: 'column',
    padding: '18px 14px calc(18px + env(safe-area-inset-bottom, 0px))',
    borderTopLeftRadius: 24,
    borderBottomLeftRadius: 24,
  },
  cartDrawerHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  cartDrawerTitle: { fontSize: 20, fontWeight: 950, color: '#0f172a', marginBottom: 4 },
  cartDrawerMeta: { fontSize: 13, fontWeight: 750, color: '#64748b' },
  cartDrawerClose: { width: 38, height: 38, border: 'none', borderRadius: 14, background: '#e2e8f0', color: '#334155', fontSize: 16, fontWeight: 900, cursor: 'pointer' },
  cartDrawerList: { flex: 1, overflowY: 'auto', paddingRight: 2 },
  cartDrawerFooter: { borderTop: '1px solid #e2e8f0', paddingTop: 12, marginTop: 8 },
  cartDrawerTotalRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 15, color: '#334155', marginBottom: 10 },
  cartDrawerCheckoutBtn: {
    width: '100%',
    height: 52,
    border: 'none',
    borderRadius: 18,
    background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
    color: '#fff',
    fontSize: 16,
    fontWeight: 900,
    boxShadow: '0 12px 24px rgba(37,99,235,0.22)',
    cursor: 'pointer',
  },

}

// ─── Payment Modal Styles ──────────────────────────────────────────────────────

const pm: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  sheet: { width: '100%', maxWidth: 480, background: '#fff', borderRadius: '16px 16px 0 0', padding: '20px 16px 32px', boxShadow: '0 -4px 24px rgba(0,0,0,0.15)' },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 16, textAlign: 'center' },
  option: { display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '14px 16px', background: '#f7f8fa', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 10, textAlign: 'left' },
  optionIcon: { fontSize: 28, flexShrink: 0 },
  optionText: { display: 'flex', flexDirection: 'column', gap: 2 },
  optionLabel: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 15, fontWeight: 600, color: 'var(--text)' },
  optionDesc: { fontSize: 12, color: 'var(--muted)' },
  optionDisabled: { opacity: 0.45, cursor: 'not-allowed' },
  unavailableBadge: { fontSize: 11, fontWeight: 700, color: '#92400e', background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 999, padding: '2px 7px' },
  modalErrorMsg: { fontSize: 13, color: '#d97706', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '8px 12px', textAlign: 'center', marginTop: 4 },
}

// ─── AI 拍照识别 mock-only 弹层样式（Phase 1） ────────────────────────────────

const ph: Record<string, React.CSSProperties> = {
  entryBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    width: '100%', height: 38, marginBottom: 12,
    background: 'transparent', color: 'var(--blue)',
    border: '1px dashed var(--blue)', borderRadius: 'var(--radius-sm)',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  multiEntryBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    width: '100%', height: 36, marginTop: -4, marginBottom: 12,
    background: '#f8fafc', color: '#475569',
    border: '1px dashed #cbd5e1', borderRadius: 'var(--radius-sm)',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    zIndex: 600, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  },
  sheet: {
    width: '100%', maxWidth: 480, background: '#fff',
    borderRadius: '16px 16px 0 0', padding: '16px 16px 28px',
    maxHeight: '90vh', overflowY: 'auto',
    boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, color: '#8c8c8c', cursor: 'pointer', padding: '0 4px' },
  intro: { fontSize: 12, color: 'var(--muted)', marginBottom: 12 },
  usage: { fontSize: 12, color: 'var(--blue)', margin: '-4px 0 12px', fontWeight: 600 },
  uploadBox: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '20px 12px', background: '#f7f8fa',
    border: '1.5px dashed var(--border)', borderRadius: 'var(--radius-sm)',
    cursor: 'pointer', marginBottom: 14, gap: 4,
  },
  uploadIcon: { fontSize: 30, lineHeight: 1, marginBottom: 4 },
  uploadText: { fontSize: 14, fontWeight: 600, color: 'var(--text)' },
  uploadHint: { fontSize: 11, color: 'var(--muted)' },
  empty: {
    padding: '20px 12px', fontSize: 13, color: 'var(--muted)',
    background: '#fffbeb', border: '1px solid #fcd34d',
    borderRadius: 'var(--radius-sm)', textAlign: 'center', marginBottom: 10,
  },
  debugToggle: {
    display: 'block', margin: '-2px auto 10px',
    background: 'transparent', border: 'none',
    color: 'var(--muted)', fontSize: 11,
    textDecoration: 'underline', cursor: 'pointer',
  },
  debugBox: {
    fontSize: 10, lineHeight: 1.5, color: '#64748b',
    background: '#f8fafc', border: '1px solid #e2e8f0',
    borderRadius: 8, padding: '8px 10px', marginBottom: 10,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    wordBreak: 'break-word',
  },
  debugTitle: { fontWeight: 700, color: '#475569', marginBottom: 3 },
  candidatesLabel: { fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 },
  candidatesHint: { fontSize: 11, color: '#8c8c8c', marginTop: -3, marginBottom: 8 },
  candidate: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: 10, marginBottom: 8,
    background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  },
  thumb: {
    width: 56, height: 56, borderRadius: 8, flexShrink: 0,
    background: '#f0f4f8', display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  thumbEmoji: { fontSize: 26 },
  candMeta: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  candName: { fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  candSpec: { fontSize: 11, color: 'var(--muted)' },
  candFoot: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 },
  candPrice: { fontSize: 14, fontWeight: 700, color: 'var(--blue)' },
  candReason: { fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 },
  candConf: {
    fontSize: 10, fontWeight: 600, color: '#52c41a',
    background: '#f6ffed', border: '1px solid #b7eb8f',
    borderRadius: 4, padding: '1px 6px',
  },
  candAddBtn: {
    flexShrink: 0, padding: '8px 12px',
    background: 'var(--blue)', color: '#fff', border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  candAddBtnDisabled: {
    background: '#cbd5e1', cursor: 'not-allowed',
  },
  multiItem: {
    padding: 10, marginBottom: 10,
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 'var(--radius-sm)',
  },
  multiHeader: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 10, marginBottom: 8,
  },
  multiTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  multiHint: { fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginTop: 2 },
  multiDone: {
    fontSize: 12, color: '#15803d', background: '#f0fdf4',
    border: '1px solid #bbf7d0', borderRadius: 6,
    padding: '6px 8px', marginBottom: 8,
  },
  multiIgnored: {
    fontSize: 12, color: '#64748b', background: '#f1f5f9',
    border: '1px solid #e2e8f0', borderRadius: 6,
    padding: '6px 8px', marginBottom: 8,
  },
  multiEmpty: {
    fontSize: 12, color: 'var(--muted)',
    background: '#fff', border: '1px dashed var(--border)',
    borderRadius: 6, padding: '8px 10px', marginBottom: 8,
  },
  multiActions: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 },
  secondaryBtn: {
    padding: '7px 10px',
    background: '#fff', color: '#475569',
    border: '1px solid #cbd5e1',
    borderRadius: 'var(--radius-sm)',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  multiManualHint: {
    marginTop: 8, fontSize: 11, color: 'var(--muted)',
    background: '#fff7ed', border: '1px solid #fed7aa',
    borderRadius: 6, padding: '7px 9px',
  },
  recognizeFailHint: {
    fontSize: 11, color: 'var(--muted)', textAlign: 'center',
    marginTop: 8, marginBottom: 4,
  },
  mockBtn: {
    width: '100%', padding: '9px 12px',
    background: '#f8fafc', color: 'var(--muted)',
    border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)',
    fontSize: 12, fontWeight: 600, cursor: 'pointer', marginTop: 8,
  },
  disclaimer: {
    fontSize: 11, color: '#8c8c8c', textAlign: 'center',
    background: '#fafafa', borderRadius: 6,
    padding: '8px 10px', marginTop: 8, lineHeight: 1.5,
  },
}
