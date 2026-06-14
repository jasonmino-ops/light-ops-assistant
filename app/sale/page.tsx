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

type Status = 'idle' | 'querying' | 'submitting'
type PayStep = 'none' | 'selecting' | 'khqr_pending'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SalePage() {
  const { t } = useLocale()
  const { tier } = useWorkMode()
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

  const inputRef = useRef<HTMLInputElement>(null)
  const scanSucceededRef = useRef(false)
  const [cameraFailCount, setCameraFailCount] = useState(0)
  const [hidFailCount, setHidFailCount] = useState(0)
  const isHidTier = tier === 'STANDARD' || tier === 'MULTI_STORE'
  const [manualOpen, setManualOpen] = useState(false)
  const [scannerMsg, setScannerMsg] = useState<{ type: 'ok' | 'fail'; text: string } | null>(null)

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

  useEffect(() => {
    apiFetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.checkoutMode) setCheckoutMode(data.checkoutMode) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    apiFetch('/api/products')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Product[]) => setAllProducts(list))
      .catch(() => {})
  }, [])

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
      setScannerMsg({ type: 'ok', text: `✓ 已选中：${hit.name}` })
      setTimeout(() => setScannerMsg(null), 2500)
    } else {
      queryProductByBarcode(clean)
      setScannerMsg({ type: 'fail', text: `未找到条码 ${clean}，请用下拉选择或手动输入` })
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
    setPhotoStatus('idle')
  }

  function setPhotoFailure(message: string, debug: PhotoDebugInfo) {
    setPhotoError(message)
    setPhotoDebug((prev) => ({ ...(prev ?? {}), ...debug }))
  }

  function aiPhotoErrorMessage(errorCode: string): string {
    if (errorCode === 'AI_DISABLED_FOR_STORE') return '当前门店暂未开通 AI 拍照识别，请使用扫码或手动选择商品'
    if (errorCode === 'AI_DAILY_LIMIT_REACHED') return '今日 AI 拍照识别次数已用完，请使用扫码或手动选择商品'
    if (errorCode === 'AI_NOT_CONFIGURED') return 'AI 识别暂未配置，请使用扫码或手动选择商品'
    if (errorCode === 'AI_TIMEOUT') return '识别超时，请换一张更清晰的图片重试'
    if (errorCode === 'AI_EMPTY') return '未识别到清晰商品，请拍商品正面'
    if (errorCode === 'AI_FAILED') return 'AI 识别失败，请使用扫码或手动选择商品'
    if (errorCode === 'INVALID_IMAGE') return '图片无效或过大，请换一张 JPG 图片'
    if (errorCode === 'INVALID_MIME') return '图片格式不支持，请换 JPG 图片'
    return '识别失败，请使用扫码或手动选择商品'
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
      setPhotoFailure('未选择图片', { stage: 'failed_before_post' })
      return
    }
    setPhotoError(null)
    setPhotoCandidates([])
    setPhotoDebugOpen(false)
    setPhotoDebug({
      fileType: file.type || '(empty)',
      fileSize: file.size,
      stage: 'file_selected',
    })

    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp'])
    if (!allowed.has(file.type)) {
      setPhotoFailure('仅支持 JPG、PNG、WebP 图片', {
        errorCode: 'INVALID_MIME',
        stage: 'failed_before_post',
      })
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoFailure('图片太大，请换一张小于 5MB 的图片', {
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
      setPhotoDebug((prev) => ({
        ...(prev ?? {}),
        apiStatus: res.status,
        errorCode: body.errorCode ?? body.error ?? undefined,
        stage,
      }))
      if (!res.ok) {
        const errorCode = body.error ?? `HTTP_${res.status}`
        if (res.status === 401 || res.status === 403) {
          setPhotoFailure('登录状态失效，请重新打开店小二后再试', { apiStatus: res.status, errorCode, stage: 'failed_after_post' })
          return
        }
        if (res.status === 400) {
          setPhotoFailure('图片参数无效，请换一张 JPG 图片重试', { apiStatus: res.status, errorCode, stage: 'failed_after_post' })
          return
        }
        setPhotoFailure('识别失败，请使用扫码或手动选择商品', { apiStatus: res.status, errorCode, stage: 'failed_after_post' })
        return
      }
      if (body.errorCode) {
        setPhotoFailure(aiPhotoErrorMessage(body.errorCode), {
          apiStatus: res.status,
          errorCode: body.errorCode,
          stage: 'failed_after_post',
        })
        return
      }
      const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 5) : []
      if (candidates.length === 0) {
        setPhotoFailure('未找到匹配商品，请使用扫码或手动选择商品', {
          apiStatus: res.status,
          stage: 'response_received',
        })
        return
      }
      setPhotoCandidates(candidates)
    } catch (e) {
      const code = e instanceof Error ? e.message : 'UNKNOWN_ERROR'
      if (code === 'IMAGE_LOAD_FAILED') {
        setPhotoFailure('图片无法读取，请换一张 JPG 图片重试', { errorCode: code, stage: 'failed_before_post' })
      } else if (code === 'COMPRESS_FAILED') {
        setPhotoFailure('图片压缩失败，请换一张 JPG 图片重试', { errorCode: code, stage: 'failed_before_post' })
      } else if (code === 'IMAGE_TOO_LARGE_AFTER_COMPRESS') {
        setPhotoFailure('图片压缩后仍过大，请换一张更小的图片', { errorCode: code, stage: 'failed_before_post' })
      } else if (code === 'FILE_READ_FAILED') {
        setPhotoFailure('图片无法读取，请换一张 JPG 图片重试', { errorCode: code, stage: 'failed_before_post' })
      } else if (stage === 'posting') {
        setPhotoFailure('网络请求失败，请检查网络后重试', { errorCode: code, stage: 'failed_after_post' })
      } else {
        setPhotoFailure('识别失败，请使用扫码或手动选择商品', { errorCode: code, stage: 'failed_before_post' })
      }
    } finally {
      setPhotoStatus('idle')
    }
  }

  function addPhotoCandidateToCart(c: PhotoCandidate) {
    const productMatch = allProducts.find((p) => p.id === c.productId)
    if (!productMatch) {
      setPhotoError('候选商品未在当前商品列表中，请刷新后重试。')
      return
    }
    addProductToCart(productMatch, 1)
    setPhotoModalOpen(false)
  }

  // ── 收款方式选择 + 提交 ────────────────────────────────────────────────────

  function openPayModal() {
    if (cart.length === 0) return
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
              <span style={ph.title}>AI 拍照识别商品</span>
              <button type="button" style={ph.closeBtn} onClick={() => setPhotoModalOpen(false)}>✕</button>
            </div>
            <div style={ph.intro}>识别结果仅供参考，请确认后加入本单。</div>

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
              <div style={ph.uploadText}>点击拍照 / 选择图片</div>
              <div style={ph.uploadHint}>JPG / PNG / WebP，单张商品，最大 5MB</div>
            </label>

            {/* 候选商品 / 空态 */}
            {photoStatus === 'loading' && (
              <div style={ph.empty}>正在识别商品...</div>
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
                  {photoDebugOpen ? '收起调试信息' : '查看调试信息'}
                </button>
                {photoDebugOpen && (
                  <div style={ph.debugBox}>
                    <div style={ph.debugTitle}>识别调试信息</div>
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
              <div style={ph.empty}>未找到匹配商品，请使用扫码或手动选择商品。</div>
            )}
            {photoStatus !== 'loading' && !photoError && photoCandidates.length > 0 && (
              <>
                <div style={ph.candidatesLabel}>AI 找到以下可能商品</div>
                <div style={ph.candidatesHint}>请店员确认后加入本单</div>
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
                      加入本单
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
                使用模拟候选（开发）
              </button>
            )}

            <div style={ph.disclaimer}>
              AI 识别结果可能不准确，请以店员确认结果为准。
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

      <div style={{ ...s.headerBar, justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={s.headerTitle}>{t('sale.title')}</span>
        <LangToggleBtn />
      </div>

      <div style={s.body}>

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
            {/* 查询卡：下拉选择（主路径）/ 摄像头扫码 / 手动输入（备用） */}
            <div style={s.card}>
              <div style={s.cardLabel}>{t('sale.selectProduct')}</div>
              {scannerMsg && (
                <div style={scannerMsg.type === 'ok' ? s.scannerOkMsg : s.scannerFailMsg}>
                  {scannerMsg.text}
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

              <div style={{ ...s.orDivider, marginTop: 14 }}>
                <div style={s.orLine} /><span style={s.orText}>{t('sale.orCamera')}</span><div style={s.orLine} />
              </div>
              <button type="button" style={s.scanRow} onClick={scanBarcode} disabled={status === 'querying' || status === 'submitting'}>
                <span style={s.scanIcon}>⊡</span>
                <span style={s.scanLabel}>{t('sale.scanBtn')}</span>
              </button>
              {cameraFailCount >= 5 && <div style={s.scanHintMsg}>{t('sale.scanFailHint')}</div>}

              {/* AI 拍照识别（Phase 1 mock-only）：辅助入口，不抢主流程 */}
              <button
                type="button"
                style={ph.entryBtn}
                onClick={openPhotoModal}
                disabled={status === 'querying' || status === 'submitting'}
              >
                📷 拍照识别（试用）
              </button>

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
                  <div ref={suggestWrapRef} style={s.suggestWrap}>
                    <div style={s.inputRow}>
                      <input
                        ref={inputRef}
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
              {queryError && <div style={s.errorMsg}>{queryError}</div>}
              {isHidTier && hidFailCount >= 5 && <div style={s.scanHintMsg}>{t('sale.hidFailHint')}</div>}
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
                <div style={s.productName}>{product.name}</div>
                {product.spec && <div style={s.productSpec}>{product.spec}</div>}
                <div style={s.priceRow}>
                  <span style={s.priceLabel}>{t('sale.unitPrice')}</span>
                  <span style={s.priceValue}>${product.sellPrice.toFixed(2)}</span>
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
                  <span style={s.cartHeaderText}>{t('sale.cartHeader')}（{cart.length} 种）</span>
                  <button style={s.clearCartBtn} onClick={() => setCart([])}>{t('sale.clearCart')}</button>
                </div>

                {cart.map((ci) => (
                  <CartItemRow key={ci.key} item={ci} onDelete={() => removeFromCart(ci.key)} />
                ))}

                <div style={s.totalCard}>
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
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── CartItemRow ──────────────────────────────────────────────────────────────

function CartItemRow({ item, onDelete }: { item: CartItem; onDelete: () => void }) {
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
        <span style={ci.meta}>{item.qty} 件 × ${item.product.sellPrice.toFixed(2)}</span>
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
  page: { minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflowX: 'hidden' },
  headerBar: { background: 'var(--blue)', padding: '16px 16px 18px', display: 'flex', alignItems: 'center', flexShrink: 0 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 700, letterSpacing: '0.02em' },
  body: { flex: 1, width: '100%', maxWidth: 480, margin: '0 auto', padding: '12px 12px 20px' },

  card: { background: 'var(--card)', borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 10 },
  cardLabel: { fontSize: 12, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 },

  scanRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', height: 48, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 16, fontWeight: 600, marginBottom: 12 },
  scanIcon: { fontSize: 22 },
  scanLabel: { fontSize: 15, fontWeight: 600 },

  orDivider: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  orLine: { flex: 1, height: 1, background: 'var(--border)' },
  orText: { fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' },

  suggestWrap: { position: 'relative' },
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
  dropTrigger: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 44, border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0 12px', background: '#f7f8fa', cursor: 'pointer', gap: 8 },
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

  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '36px 20px', gap: 8 },
  emptyIcon: { fontSize: 44, color: '#d0d0d0', lineHeight: 1, marginBottom: 4 },
  emptyTitle: { fontSize: 15, fontWeight: 600, color: '#bbb' },
  emptyDesc: { fontSize: 13, color: '#ccc' },

  productName: { fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 4 },
  productSpec: { fontSize: 13, color: 'var(--muted)', marginBottom: 10 },
  priceRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid var(--border)' },
  priceLabel: { fontSize: 13, color: 'var(--muted)' },
  priceValue: { fontSize: 20, fontWeight: 700, color: 'var(--text)' },

  stepperRow: { display: 'flex', alignItems: 'center', background: '#f7f8fa', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', overflow: 'hidden', width: '100%', marginBottom: 12 },
  stepperBtn: { width: 52, height: 46, flexShrink: 0, background: 'none', border: 'none', fontSize: 24, color: 'var(--blue)', fontWeight: 300, lineHeight: 1 },
  stepperInput: { flex: 1, textAlign: 'center', fontSize: 22, fontWeight: 700, color: 'var(--text)', background: 'transparent', border: 'none', outline: 'none', width: '100%' },

  subtotalRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 14, marginBottom: 12, borderBottom: '1px solid var(--border)' },
  subtotalLabel: { fontSize: 13, color: 'var(--muted)' },
  subtotalValue: { fontSize: 18, fontWeight: 700, color: 'var(--text)' },

  addBtn: { display: 'block', width: '100%', height: 48, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 16, fontWeight: 700 },

  cartHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 2px' },
  cartHeaderText: { fontSize: 13, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  clearCartBtn: { background: 'none', border: 'none', color: '#bbb', fontSize: 12, padding: 0 },

  totalCard: { background: 'var(--blue)', borderRadius: 'var(--radius)', padding: '14px 18px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
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
