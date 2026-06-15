'use client'

import { useState, KeyboardEvent, useRef, useCallback, useEffect } from 'react'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import BarcodeScanner from '@/app/components/BarcodeScanner'
import { useLocale } from '@/app/components/LangProvider'
import LangToggleBtn from '@/app/components/LangToggleBtn'
import { publicUrl } from '@/lib/public-url'

type MarketingLang = 'zh' | 'en' | 'km'
type MarketingTemplateType = 'TIKTOK_HOT' | 'HOME_GOODS' | 'FOOD_SET' | 'BEAUTY'
type MarketingImageField =
  | 'heroImageUrl'
  | 'detailImage1'
  | 'detailImage2'
  | 'detailImage3'
  | 'reviewImage1'
  | 'reviewImage2'
  | 'reviewImage3'

type MarketingLangContent = {
  title: string
  features: string[]
  buttonText: string
}

function emptyMarketingLangContent(): Record<MarketingLang, MarketingLangContent> {
  return {
    zh: { title: '', features: ['', '', '', '', ''], buttonText: '' },
    en: { title: '', features: ['', '', '', '', ''], buttonText: '' },
    km: { title: '', features: ['', '', '', '', ''], buttonText: '' },
  }
}

const MARKETING_LANG_LABELS: Array<{ lang: MarketingLang; label: string }> = [
  { lang: 'zh', label: '中文' },
  { lang: 'en', label: 'English' },
  { lang: 'km', label: 'ខ្មែរ' },
]

const MARKETING_TEMPLATE_OPTIONS: Array<{ value: MarketingTemplateType; label: string }> = [
  { value: 'TIKTOK_HOT', label: 'TikTok爆款' },
  { value: 'HOME_GOODS', label: '家居用品' },
  { value: 'FOOD_SET', label: '餐饮套餐' },
  { value: 'BEAUTY', label: '美妆产品' },
]

// ─── HID Scanner Hook ─────────────────────────────────────────────────────────

function useHidScanner(onScan: (code: string) => void) {
  const bufRef = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      const active = document.activeElement
      const isTypingField =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
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

type Category = {
  id: string
  name: string
  parentId: string | null
  sortOrder: number
}

type Product = {
  id: string
  barcode: string
  name: string
  spec: string | null
  sellPrice: number
  status: 'ACTIVE' | 'DISABLED'
  categoryId: string | null
  imageUrl: string | null
  imageUrls?: string[]
  createdAt?: string
}

type MarketingProductPage = {
  id: string
  productId: string
  slug: string
  status: 'DRAFT' | 'PUBLISHED' | 'DISABLED'
  templateType: MarketingTemplateType | null
  title: string | null
  titleZh: string | null
  titleEn: string | null
  titleKm: string | null
  subtitle: string | null
  heroImageUrl: string | null
  heroVideoUrl: string | null
  salePrice: number | null
  originalPrice: number | null
  soldCount: number | null
  feature1: string | null
  feature2: string | null
  feature3: string | null
  feature4: string | null
  feature5: string | null
  feature1Zh: string | null
  feature2Zh: string | null
  feature3Zh: string | null
  feature4Zh: string | null
  feature5Zh: string | null
  feature1En: string | null
  feature2En: string | null
  feature3En: string | null
  feature4En: string | null
  feature5En: string | null
  feature1Km: string | null
  feature2Km: string | null
  feature3Km: string | null
  feature4Km: string | null
  feature5Km: string | null
  enableCountdown: boolean
  detailImage1: string | null
  detailImage2: string | null
  detailImage3: string | null
  reviewImage1: string | null
  reviewImage2: string | null
  reviewImage3: string | null
  buttonText: string | null
  buttonTextZh: string | null
  buttonTextEn: string | null
  buttonTextKm: string | null
}

type Mode = 'idle' | 'loading' | 'found' | 'not-found' | 'saved'

type DeleteConfirm =
  | { type: 'single'; id: string; name: string }
  | { type: 'batch'; ids: string[] }

type ImportResult = {
  imported:   number
  catCreated: number
  imageCount: number
  failed:     number
  errors: Array<{ row: number; barcode: string; reason: string }>
}

type CatSource = 'MANUAL' | 'AUTO' | 'NONE'

type PreviewRow = {
  rowNum: number
  barcode: string
  sku: string | null
  name:   string
  nameZh: string | null
  nameEn: string | null
  nameKm: string | null
  descZh: string | null
  descEn: string | null
  descKm: string | null
  spec:     string | null
  sellPrice: number
  status: 'ACTIVE' | 'DISABLED'
  statusProvided?: boolean
  imageUrl: string | null
  category1Raw: string
  category2Raw: string
  resolvedL1: string | null
  resolvedL2: string | null
  catSource: CatSource
  isDuplicate: boolean
  error: string | null
  confidence?: number
  warnings?: string[]
}

type AiRow = PreviewRow & { include: boolean }

type AiDraftProduct = {
  name: string
  brand: string | null
  spec: string | null
  categoryName: string | null
  categoryId: string | null
  categorySuggestion: string | null
  sku: string | null
  barcode: string | null
  imageUrl: string | null
  confidence: number
  warning: string
}

type AiMatchedProduct = {
  productId: string
  name: string
  spec: string | null
  price: number
  imageUrl: string | null
  categoryId: string | null
  status: 'ACTIVE' | 'DISABLED'
  confidence: number
  reason: string[]
}

function productImages(p: Product | null): string[] {
  if (!p) return []
  if (Array.isArray(p.imageUrls) && p.imageUrls.length > 0) return p.imageUrls.filter(Boolean).slice(0, 3)
  return p.imageUrl ? [p.imageUrl] : []
}

function withImages(p: Product, imageUrls: string[]): Product {
  const imgs = imageUrls.filter(Boolean).slice(0, 3)
  return { ...p, imageUrl: imgs[0] ?? null, imageUrls: imgs }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const { t } = useLocale()
  const fmt = useCallback((key: string, vars: Record<string, string | number>) => {
    let text = t(key)
    Object.entries(vars).forEach(([name, value]) => {
      text = text.replaceAll(`{${name}}`, String(value))
    })
    return text
  }, [t])
  const [scannerOpen, setScannerOpen] = useState(false)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [cameraFailCount, setCameraFailCount] = useState(0)
  const scanSucceededRef = useRef(false)
  const hidBlockedRef = useRef(false)
  const hidBlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function blockHidBriefly() {
    hidBlockedRef.current = true
    if (hidBlockTimerRef.current) clearTimeout(hidBlockTimerRef.current)
    hidBlockTimerRef.current = setTimeout(() => {
      hidBlockedRef.current = false
    }, 400)
  }

  const [mode, setMode] = useState<Mode>('idle')
  const [product, setProduct] = useState<Product | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Import state
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importStep, setImportStep] = useState<'upload' | 'preview' | 'done'>('upload')
  const [importPreview, setImportPreview] = useState<PreviewRow[] | null>(null)
  const [importConfirming, setImportConfirming] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const importPanelRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editNameRef = useRef<HTMLInputElement>(null)

  // 商品主图（lookup → 编辑表单内）
  const [imageUploading, setImageUploading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const imageFileRef = useRef<HTMLInputElement>(null)
  const createImageFileRef = useRef<HTMLInputElement>(null)

  // 商品列表展开 + 行内图片管理
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [listImgUploading, setListImgUploading] = useState<Record<string, boolean>>({})
  const [listImgError, setListImgError] = useState<Record<string, string>>({})
  const listImageRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // AI 识别菜单导入
  const [aiOpen, setAiOpen] = useState(false)
  const [aiStep, setAiStep] = useState<'upload' | 'recognizing' | 'preview' | 'done'>('upload')
  const [aiImageFile, setAiImageFile] = useState<File | null>(null)
  const [aiPreview, setAiPreview] = useState<AiRow[] | null>(null)
  const [aiResult, setAiResult] = useState<ImportResult | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const aiPanelRef = useRef<HTMLDivElement>(null)
  const aiFileRef = useRef<HTMLInputElement>(null)

  // AI 单商品拍照建档
  const [photoCreateOpen, setPhotoCreateOpen] = useState(false)
  const [photoCreateStep, setPhotoCreateStep] = useState<'upload' | 'recognizing' | 'matched' | 'draft'>('upload')
  const [photoCreateFile, setPhotoCreateFile] = useState<File | null>(null)
  const [photoCreatePreview, setPhotoCreatePreview] = useState<string | null>(null)
  const [photoCreateMatches, setPhotoCreateMatches] = useState<AiMatchedProduct[]>([])
  const [photoCreateDraft, setPhotoCreateDraft] = useState<AiDraftProduct | null>(null)
  const [photoCreateError, setPhotoCreateError] = useState<string | null>(null)
  const photoCreatePanelRef = useRef<HTMLDivElement>(null)
  const photoCreateFileRef = useRef<HTMLInputElement>(null)

  // Edit form
  const [editName, setEditName] = useState('')
  const [editSpec, setEditSpec] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editStatus, setEditStatus] = useState<'ACTIVE' | 'DISABLED'>('ACTIVE')
  const [editCategoryId, setEditCategoryId] = useState<string>('')

  // Create form
  const [newBarcode, setNewBarcode] = useState('')
  const [newName, setNewName] = useState('')
  const [newSpec, setNewSpec] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newCategoryId, setNewCategoryId] = useState<string>('')
  const [newImageFile, setNewImageFile] = useState<File | null>(null)
  const [newImagePreview, setNewImagePreview] = useState<string | null>(null)
  const [newImageFiles, setNewImageFiles] = useState<File[]>([])
  const [newImagePreviews, setNewImagePreviews] = useState<string[]>([])
  const [newImageError, setNewImageError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Category management
  const [categories, setCategories] = useState<Category[]>([])
  const [catOpen, setCatOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatParentId, setNewCatParentId] = useState('')
  const [catSaving, setCatSaving] = useState(false)
  const [catError, setCatError] = useState<string | null>(null)

  // Product list + delete
  const [listOpen, setListOpen] = useState(false)
  const [productList, setProductList] = useState<Product[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [listSearch, setListSearch] = useState('')
  const [listCategoryId, setListCategoryId] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null)
  const [marketingPages, setMarketingPages] = useState<Record<string, MarketingProductPage>>({})
  const [marketingEditing, setMarketingEditing] = useState<{ product: Product; page: MarketingProductPage } | null>(null)
  const [marketingTitle, setMarketingTitle] = useState('')
  const [marketingSubtitle, setMarketingSubtitle] = useState('')
  const [marketingSlug, setMarketingSlug] = useState('')
  const [marketingStatus, setMarketingStatus] = useState<'DRAFT' | 'PUBLISHED' | 'DISABLED'>('DRAFT')
  const [marketingTemplateType, setMarketingTemplateType] = useState<MarketingTemplateType>('TIKTOK_HOT')
  const [marketingHeroImageUrl, setMarketingHeroImageUrl] = useState('')
  const [marketingHeroVideoUrl, setMarketingHeroVideoUrl] = useState('')
  const [marketingSalePrice, setMarketingSalePrice] = useState('')
  const [marketingOriginalPrice, setMarketingOriginalPrice] = useState('')
  const [marketingSoldCount, setMarketingSoldCount] = useState('')
  const [marketingFeatures, setMarketingFeatures] = useState(['', '', '', '', ''])
  const [marketingLangContent, setMarketingLangContent] = useState(emptyMarketingLangContent)
  const [marketingEnableCountdown, setMarketingEnableCountdown] = useState(false)
  const [marketingDetailImages, setMarketingDetailImages] = useState(['', '', ''])
  const [marketingReviewImages, setMarketingReviewImages] = useState(['', '', ''])
  const [marketingButtonText, setMarketingButtonText] = useState('')
  const [marketingSaving, setMarketingSaving] = useState(false)
  const [marketingGenerating, setMarketingGenerating] = useState<Record<string, boolean>>({})
  const [marketingImageUploading, setMarketingImageUploading] = useState<Partial<Record<MarketingImageField, boolean>>>({})
  const [marketingVideoUploading, setMarketingVideoUploading] = useState(false)
  const [marketingMsg, setMarketingMsg] = useState<string | null>(null)
  const marketingImageRefs = useRef<Partial<Record<MarketingImageField, HTMLInputElement | null>>>({})
  const marketingVideoRef = useRef<HTMLInputElement | null>(null)

  // 扫码枪反馈
  const [hidMsg, setHidMsg] = useState<{ type: 'ok' | 'fail'; text: string } | null>(null)

  const handleHidScan = useCallback((code: string) => {
    setHidMsg(null)
    const clean = code.trim()
    if (!clean) return
    setBarcodeInput(clean)
    lookup(clean)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useHidScanner(handleHidScan)

  // ── 扫码枪输入防污染：mode 切换后 400ms 内屏蔽非输入框的全局字符 ────────────

  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (!hidBlockedRef.current) return
      const active = document.activeElement
      const isTypingField =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
      if (isTypingField) return
      if (e.key.length === 1) e.preventDefault()
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  // ── Load categories on mount ──────────────────────────────────────────────

  useEffect(() => {
    apiFetch('/api/categories', undefined, OWNER_CTX)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Category[]) => setCategories(list))
      .catch(() => {})
  }, [])

  // ── Add category ──────────────────────────────────────────────────────────

  async function handleAddCategory() {
    const name = newCatName.trim()
    if (!name) return
    setCatSaving(true)
    setCatError(null)
    try {
      const res = await apiFetch(
        '/api/categories',
        { method: 'POST', body: JSON.stringify({ name, parentId: newCatParentId || null }) },
        OWNER_CTX,
      )
      const body = await res.json()
      if (res.ok) {
        setCategories((prev) => [...prev, body].sort((a, b) => a.name.localeCompare(b.name)))
        setNewCatName('')
        setNewCatParentId('')
      } else {
        setCatError(body.message ?? t('products.catSaveError'))
      }
    } catch {
      setCatError(t('products.catSaveError'))
    } finally {
      setCatSaving(false)
    }
  }

  // ── Product list ──────────────────────────────────────────────────────────

  async function loadProductList() {
    setListLoading(true)
    setDeleteMsg(null)
    setListError(null)
    try {
      const [res, mpRes] = await Promise.all([
        apiFetch('/api/products?all=true', undefined, OWNER_CTX),
        apiFetch('/api/marketing-product-pages', undefined, OWNER_CTX),
      ])
      if (res.ok) {
        const list: Product[] = await res.json()
        setProductList(list)
        setSelectedIds(new Set())
      } else {
        const body = await res.json().catch(() => ({}))
        setListError(body.message ?? body.error ?? t('products.loadFailed'))
      }
      if (mpRes.ok) {
        const body = await mpRes.json()
        const pages = Array.isArray(body.pages) ? body.pages as MarketingProductPage[] : []
        setMarketingPages(Object.fromEntries(pages.map((p) => [p.productId, p])))
      }
    } catch {
      setListError(t('common.networkError'))
    } finally {
      setListLoading(false)
    }
  }

  useEffect(() => {
    loadProductList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleList() {
    const next = !listOpen
    setListOpen(next)
    if (next && productList.length === 0) loadProductList()
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    const visibleIds = filteredProductList.map((p) => p.id)
    if (visibleIds.length === 0) return
    const allVisibleSelected = visibleIds.every((id) => selectedIds.has(id))
    if (allVisibleSelected) {
      const next = new Set(selectedIds)
      visibleIds.forEach((id) => next.delete(id))
      setSelectedIds(next)
    } else {
      setSelectedIds(new Set([...selectedIds, ...visibleIds]))
    }
  }

  function matchesListCategory(p: Product): boolean {
    if (!listCategoryId) return true
    if (p.categoryId === listCategoryId) return true
    const childIds = categories.filter((c) => c.parentId === listCategoryId).map((c) => c.id)
    return !!p.categoryId && childIds.includes(p.categoryId)
  }

  const filteredProductList = productList.filter((p) => {
    const q = listSearch.trim().toLowerCase()
    const keywordOk = !q ||
      p.name.toLowerCase().includes(q) ||
      p.barcode.toLowerCase().includes(q) ||
      (p.spec ?? '').toLowerCase().includes(q)
    return keywordOk && matchesListCategory(p)
  })
  const displayedProductList = listOpen ? filteredProductList : filteredProductList.slice(0, 5)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayNewCount = productList.filter((p) => p.createdAt && new Date(p.createdAt) >= todayStart).length
  const stats = [
    { label: t('products.statsTotalProducts'), value: productList.length },
    { label: t('products.statsCategories'), value: categories.length },
    { label: t('products.statsTodayNew'), value: todayNewCount },
    { label: t('products.statsStockWarning'), value: 0 },
  ]

  function openAiImport() {
    aiReset()
    setPhotoCreateOpen(false)
    setImportOpen(false)
    setAiOpen(true)
    window.setTimeout(() => {
      aiPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      aiFileRef.current?.focus()
    }, 0)
  }

  function openPhotoCreate() {
    photoCreateReset()
    setImportOpen(false)
    setAiOpen(false)
    setPhotoCreateOpen(true)
    window.setTimeout(() => {
      photoCreatePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      photoCreateFileRef.current?.focus()
    }, 0)
  }

  function openBulkImport() {
    setAiOpen(false)
    setPhotoCreateOpen(false)
    setImportOpen(true)
    setImportStep('upload')
    setImportPreview(null)
    setImportResult(null)
    setImportError(null)
    window.setTimeout(() => {
      importPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      fileInputRef.current?.focus()
    }, 0)
  }

  function resetListFilters() {
    setListSearch('')
    setListCategoryId('')
    setSelectedIds(new Set())
  }

  function selectAllVisibleChecked() {
    return filteredProductList.length > 0 && filteredProductList.every((p) => selectedIds.has(p.id))
  }

  function selectedVisibleCount() {
    const visible = new Set(filteredProductList.map((p) => p.id))
    return [...selectedIds].filter((id) => visible.has(id)).length
  }

  function selectedVisibleIds() {
    const visible = new Set(filteredProductList.map((p) => p.id))
    return [...selectedIds].filter((id) => visible.has(id))
  }

  function onListSearchChange(value: string) {
    setListSearch(value)
  }

  function onListCategoryChange(value: string) {
    setListCategoryId(value)
  }

  function productPageUrl(slug: string): string {
    return publicUrl(`/p/${slug}`)
  }

  function openMarketingEditor(product: Product, page: MarketingProductPage) {
    setMarketingEditing({ product, page })
    setMarketingTitle(page.title ?? product.name)
    setMarketingSubtitle(page.subtitle ?? '')
    setMarketingSlug(page.slug)
    setMarketingStatus(page.status)
    setMarketingTemplateType(page.templateType ?? 'TIKTOK_HOT')
    setMarketingHeroImageUrl(page.heroImageUrl ?? product.imageUrl ?? '')
    setMarketingHeroVideoUrl(page.heroVideoUrl ?? '')
    setMarketingSalePrice(page.salePrice != null ? String(page.salePrice) : '')
    setMarketingOriginalPrice(page.originalPrice != null ? String(page.originalPrice) : '')
    setMarketingSoldCount(page.soldCount != null ? String(page.soldCount) : '')
    setMarketingFeatures([page.feature1 ?? '', page.feature2 ?? '', page.feature3 ?? '', page.feature4 ?? '', page.feature5 ?? ''])
    setMarketingLangContent({
      zh: {
        title: page.titleZh ?? '',
        features: [page.feature1Zh ?? '', page.feature2Zh ?? '', page.feature3Zh ?? '', page.feature4Zh ?? '', page.feature5Zh ?? ''],
        buttonText: page.buttonTextZh ?? '',
      },
      en: {
        title: page.titleEn ?? '',
        features: [page.feature1En ?? '', page.feature2En ?? '', page.feature3En ?? '', page.feature4En ?? '', page.feature5En ?? ''],
        buttonText: page.buttonTextEn ?? '',
      },
      km: {
        title: page.titleKm ?? '',
        features: [page.feature1Km ?? '', page.feature2Km ?? '', page.feature3Km ?? '', page.feature4Km ?? '', page.feature5Km ?? ''],
        buttonText: page.buttonTextKm ?? '',
      },
    })
    setMarketingEnableCountdown(!!page.enableCountdown)
    setMarketingDetailImages([page.detailImage1 ?? '', page.detailImage2 ?? '', page.detailImage3 ?? ''])
    setMarketingReviewImages([page.reviewImage1 ?? '', page.reviewImage2 ?? '', page.reviewImage3 ?? ''])
    setMarketingButtonText(page.buttonText ?? '立即下单')
    setMarketingMsg(null)
  }

  async function handleMarketingPage(product: Product) {
    const existing = marketingPages[product.id]
    if (existing) {
      openMarketingEditor(product, existing)
      return
    }
    setMarketingMsg(null)
    try {
      const res = await apiFetch(
        '/api/marketing-product-pages',
        { method: 'POST', body: JSON.stringify({ productId: product.id }) },
        OWNER_CTX,
      )
      const body = await res.json()
      if (!res.ok) {
        setMarketingMsg(body.message ?? body.error ?? '营销页创建失败')
        return
      }
      const page = body as MarketingProductPage
      setMarketingPages((prev) => ({ ...prev, [page.productId]: page }))
      openMarketingEditor(product, page)
    } catch {
      setMarketingMsg(t('common.networkError'))
    }
  }

  async function handleAiGenerateMarketingPage(product: Product) {
    const existing = marketingPages[product.id]
    if (existing) {
      const ok = window.confirm('将重新生成标题、价格、卖点等营销文案，保留图片和链接，是否继续？')
      if (!ok) return
    }
    setMarketingMsg(null)
    setMarketingGenerating((prev) => ({ ...prev, [product.id]: true }))
    try {
      const res = await apiFetch(
        '/api/marketing-product-pages',
        { method: 'POST', body: JSON.stringify({ productId: product.id, mode: 'RULE_GENERATE' }) },
        OWNER_CTX,
      )
      const body = await res.json()
      if (!res.ok) {
        setMarketingMsg(body.message ?? body.error ?? 'AI生成营销页失败')
        return
      }
      const page = body as MarketingProductPage
      setMarketingPages((prev) => ({ ...prev, [page.productId]: page }))
      openMarketingEditor(product, page)
      setMarketingMsg(existing ? 'AI已重新生成营销文案，可继续微调' : 'AI已生成营销页草稿，可继续微调')
    } catch {
      setMarketingMsg(t('common.networkError'))
    } finally {
      setMarketingGenerating((prev) => ({ ...prev, [product.id]: false }))
    }
  }

  async function saveMarketingPage() {
    if (!marketingEditing) return
    setMarketingSaving(true)
    setMarketingMsg(null)
    try {
      const res = await apiFetch(
        `/api/marketing-product-pages/${marketingEditing.page.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            title: marketingTitle,
            subtitle: marketingSubtitle,
            slug: marketingSlug,
            status: marketingStatus,
            templateType: marketingTemplateType,
            heroImageUrl: marketingHeroImageUrl,
            heroVideoUrl: marketingHeroVideoUrl,
            salePrice: marketingSalePrice,
            originalPrice: marketingOriginalPrice,
            soldCount: marketingSoldCount,
            feature1: marketingFeatures[0],
            feature2: marketingFeatures[1],
            feature3: marketingFeatures[2],
            feature4: marketingFeatures[3],
            feature5: marketingFeatures[4],
            titleZh: marketingLangContent.zh.title,
            titleEn: marketingLangContent.en.title,
            titleKm: marketingLangContent.km.title,
            feature1Zh: marketingLangContent.zh.features[0],
            feature2Zh: marketingLangContent.zh.features[1],
            feature3Zh: marketingLangContent.zh.features[2],
            feature4Zh: marketingLangContent.zh.features[3],
            feature5Zh: marketingLangContent.zh.features[4],
            feature1En: marketingLangContent.en.features[0],
            feature2En: marketingLangContent.en.features[1],
            feature3En: marketingLangContent.en.features[2],
            feature4En: marketingLangContent.en.features[3],
            feature5En: marketingLangContent.en.features[4],
            feature1Km: marketingLangContent.km.features[0],
            feature2Km: marketingLangContent.km.features[1],
            feature3Km: marketingLangContent.km.features[2],
            feature4Km: marketingLangContent.km.features[3],
            feature5Km: marketingLangContent.km.features[4],
            enableCountdown: marketingEnableCountdown,
            detailImage1: marketingDetailImages[0],
            detailImage2: marketingDetailImages[1],
            detailImage3: marketingDetailImages[2],
            reviewImage1: marketingReviewImages[0],
            reviewImage2: marketingReviewImages[1],
            reviewImage3: marketingReviewImages[2],
            buttonText: marketingButtonText,
            buttonTextZh: marketingLangContent.zh.buttonText,
            buttonTextEn: marketingLangContent.en.buttonText,
            buttonTextKm: marketingLangContent.km.buttonText,
          }),
        },
        OWNER_CTX,
      )
      const body = await res.json()
      if (!res.ok) {
        setMarketingMsg(body.message ?? body.error ?? '营销页保存失败')
        return
      }
      const page = body as MarketingProductPage
      setMarketingPages((prev) => ({ ...prev, [page.productId]: page }))
      setMarketingEditing({ product: marketingEditing.product, page })
      setMarketingMsg('营销页已保存')
    } catch {
      setMarketingMsg(t('common.networkError'))
    } finally {
      setMarketingSaving(false)
    }
  }

  function copyMarketingLink(productId: string) {
    const page = marketingPages[productId]
    if (!page) return
    navigator.clipboard.writeText(productPageUrl(page.slug))
      .then(() => setMarketingMsg('营销页链接已复制'))
      .catch(() => setMarketingMsg('复制失败，请手动复制链接'))
  }

  function setMarketingImageField(field: MarketingImageField, url: string) {
    if (field === 'heroImageUrl') {
      setMarketingHeroImageUrl(url)
      return
    }
    if (field.startsWith('detailImage')) {
      const idx = Number(field.replace('detailImage', '')) - 1
      setMarketingDetailImages((prev) => {
        const next = [...prev]
        next[idx] = url
        return next
      })
      return
    }
    const idx = Number(field.replace('reviewImage', '')) - 1
    setMarketingReviewImages((prev) => {
      const next = [...prev]
      next[idx] = url
      return next
    })
  }

  async function uploadMarketingImage(field: MarketingImageField, file: File) {
    if (!marketingEditing) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setMarketingMsg('仅支持 JPG / PNG / WebP')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setMarketingMsg('原图不能超过 5MB')
      return
    }
    setMarketingImageUploading((prev) => ({ ...prev, [field]: true }))
    setMarketingMsg('正在压缩图片…')
    try {
      const blob = await compressForUpload(file)
      const uploadName = blob.type === 'image/webp' ? 'marketing.webp'
        : blob.type === 'image/jpeg' ? 'marketing.jpg' : file.name
      const form = new FormData()
      form.append('file', new File([blob], uploadName, { type: blob.type || file.type }))
      setMarketingMsg('正在上传图片…')
      const res = await fetch(`/api/marketing-product-pages/${marketingEditing.page.id}/image?field=${encodeURIComponent(field)}`, {
        method: 'POST',
        headers: { ...OWNER_CTX },
        body: form,
      })
      const body = await res.json().catch(() => null)
      if (res.ok && body?.imageUrl) {
        setMarketingImageField(field, body.imageUrl)
        setMarketingMsg('图片已上传，记得保存营销页')
      } else {
        setMarketingMsg(body?.message ?? body?.error ?? '图片上传失败')
      }
    } catch {
      setMarketingMsg(t('common.networkError'))
    } finally {
      setMarketingImageUploading((prev) => ({ ...prev, [field]: false }))
      const input = marketingImageRefs.current[field]
      if (input) input.value = ''
    }
  }

  function renderMarketingImageInput(
    field: MarketingImageField,
    value: string,
    onChange: (value: string) => void,
    placeholder: string,
  ) {
    const uploading = !!marketingImageUploading[field]
    return (
      <div style={s.marketingImageRow}>
        <input
          style={{ ...s.field, ...s.marketingImageInput }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <input
          ref={(el) => { marketingImageRefs.current[field] = el }}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) uploadMarketingImage(field, file)
          }}
        />
        <button
          type="button"
          style={{ ...ls.actionBtn, ...s.marketingUploadBtn, opacity: uploading ? 0.55 : 1 }}
          disabled={uploading}
          onClick={() => marketingImageRefs.current[field]?.click()}
        >
          {uploading ? '上传中...' : '上传'}
        </button>
      </div>
    )
  }

  async function uploadMarketingVideo(file: File) {
    if (!marketingEditing) return
    if (file.type !== 'video/mp4') {
      setMarketingMsg('仅支持 MP4 视频')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setMarketingMsg('视频不能超过 20MB')
      return
    }
    setMarketingVideoUploading(true)
    setMarketingMsg('正在上传视频…')
    try {
      const form = new FormData()
      form.append('file', new File([file], 'hero-video.mp4', { type: file.type }))
      const res = await fetch(`/api/marketing-product-pages/${marketingEditing.page.id}/video`, {
        method: 'POST',
        headers: { ...OWNER_CTX },
        body: form,
      })
      const body = await res.json().catch(() => null)
      if (res.ok && body?.videoUrl) {
        setMarketingHeroVideoUrl(body.videoUrl)
        setMarketingMsg('视频已上传，记得保存营销页')
      } else {
        setMarketingMsg(body?.message ?? body?.error ?? '视频上传失败')
      }
    } catch {
      setMarketingMsg(t('common.networkError'))
    } finally {
      setMarketingVideoUploading(false)
      if (marketingVideoRef.current) marketingVideoRef.current.value = ''
    }
  }

  async function executeDelete() {
    if (!deleteConfirm) return
    setDeleting(true)
    setDeleteMsg(null)
    try {
      if (deleteConfirm.type === 'single') {
        const res = await apiFetch(
          `/api/products/${deleteConfirm.id}`,
          { method: 'DELETE' },
          OWNER_CTX,
        )
        const body = await res.json()
        if (res.ok) {
          setProductList((prev) => prev.filter((p) => p.id !== deleteConfirm.id))
          setSelectedIds((prev) => { const next = new Set(prev); next.delete(deleteConfirm.id); return next })
          setDeleteConfirm(null)
        } else if (body.error === 'PRODUCT_HAS_SALES') {
          setDeleteMsg(t('products.hasSalesHint'))
          setDeleteConfirm(null)
        } else {
          setDeleteMsg(body.message ?? '删除失败')
          setDeleteConfirm(null)
        }
      } else {
        const res = await apiFetch(
          '/api/products/batch-delete',
          { method: 'POST', body: JSON.stringify({ ids: deleteConfirm.ids }) },
          OWNER_CTX,
        )
        const body = await res.json()
        if (res.ok) {
          const deletedSet = new Set<string>(body.deleted)
          setProductList((prev) => prev.filter((p) => !deletedSet.has(p.id)))
          setSelectedIds(new Set())
          setDeleteConfirm(null)
          const skippedCount: number = body.skipped?.length ?? 0
          if (skippedCount > 0) {
            setDeleteMsg(
              t('products.batchDeleteResult')
                .replace('{deleted}', String(body.deleted.length))
                .replace('{skipped}', String(skippedCount))
            )
          }
        } else {
          setDeleteMsg(body.message ?? '批量删除失败')
          setDeleteConfirm(null)
        }
      }
    } catch {
      setDeleteMsg(t('common.networkError'))
      setDeleteConfirm(null)
    } finally {
      setDeleting(false)
    }
  }

  // ── Import ────────────────────────────────────────────────────────────────

  async function downloadTemplate() {
    try {
      const res = await fetch('/api/products/import', {
        headers: { ...OWNER_CTX },
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'products_template.xlsx'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // delay revoke so browser finishes reading the blob before it's released
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch {
      // silent fail — user can retry
    }
  }

  async function handleImport() {
    if (!importFile) return
    setImporting(true)
    setImportResult(null)
    setImportPreview(null)
    setImportError(null)
    try {
      const form = new FormData()
      form.append('file', importFile)
      const res = await fetch('/api/products/import', {
        method: 'POST',
        headers: { ...OWNER_CTX },
        body: form,
      })
      const body = await res.json()
      if (res.ok) {
        setImportPreview(body.preview)
        setImportStep('preview')
        setImportFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      } else {
        setImportError(body.message ?? body.error ?? '解析失败')
      }
    } catch {
      setImportError('网络错误，请重试')
    } finally {
      setImporting(false)
    }
  }

  async function handleConfirmImport() {
    if (!importPreview) return
    setImportConfirming(true)
    setImportError(null)
    try {
      const rows = importPreview.filter((r) => !r.error)
      const res = await apiFetch(
        '/api/products/import/confirm',
        { method: 'POST', body: JSON.stringify({ rows }) },
        OWNER_CTX,
      )
      const body = await res.json()
      if (res.ok) {
        setImportResult(body)
        setImportStep('done')
      } else {
        setImportError(body.message ?? body.error ?? '导入失败')
      }
    } catch {
      setImportError('网络错误，请重试')
    } finally {
      setImportConfirming(false)
    }
  }

  // ── AI 识别菜单导入 ───────────────────────────────────────────────────────

  async function handleAiRecognize() {
    if (!aiImageFile) return
    setAiStep('recognizing')
    setAiError(null)
    try {
      const form = new FormData()
      form.append('file', aiImageFile)
      const res = await fetch('/api/products/import-ai/recognize', {
        method: 'POST',
        headers: { ...OWNER_CTX },
        body: form,
      })
      const body = await res.json()
      if (res.ok && Array.isArray(body.preview) && body.preview.length > 0) {
        setAiPreview(
          (body.preview as PreviewRow[]).map((r) => ({
            ...r,
            include: !!r.name.trim() && r.sellPrice > 0,
          })),
        )
        setAiStep('preview')
      } else {
        setAiError(body.message ?? body.error ?? t('products.aiEmptyResult'))
        setAiStep('upload')
      }
    } catch {
      setAiError(t('common.networkError'))
      setAiStep('upload')
    }
  }

  async function handleAiConfirm() {
    if (!aiPreview) return
    const rows = aiPreview
      .filter((r) => r.include)
      .filter((r) => r.name.trim() && r.sellPrice > 0)
      .map((r) => {
        const { include: _unused, ...rest } = r
        void _unused
        return rest
      })
    if (rows.length === 0) {
      setAiError(t('products.aiNoneSelected'))
      return
    }
    setAiError(null)
    setAiStep('recognizing')
    try {
      const res = await apiFetch(
        '/api/products/import/confirm',
        { method: 'POST', body: JSON.stringify({ rows }) },
        OWNER_CTX,
      )
      const body = await res.json()
      if (res.ok) {
        setAiResult(body)
        setAiStep('done')
      } else {
        setAiError(body.message ?? body.error ?? '导入失败')
        setAiStep('preview')
      }
    } catch {
      setAiError(t('common.networkError'))
      setAiStep('preview')
    }
  }

  function aiEditRow(i: number, field: 'name' | 'category' | 'price', val: string) {
    setAiPreview((prev) => {
      if (!prev) return prev
      const next = [...prev]
      const r = { ...next[i] }
      if (field === 'name') {
        r.name = val
      } else if (field === 'category') {
        const v = val.trim()
        r.resolvedL1 = v || null
        r.category1Raw = v
        r.catSource = v ? 'AUTO' : 'NONE'
      } else if (field === 'price') {
        const num = parseFloat(val.replace(/[^0-9.]/g, ''))
        r.sellPrice = isNaN(num) || num < 0 ? 0 : num
      }
      next[i] = r
      return next
    })
    setAiError(null)
  }

  function aiToggleInclude(i: number) {
    setAiPreview((prev) => {
      if (!prev) return prev
      const next = [...prev]
      next[i] = { ...next[i], include: !next[i].include }
      return next
    })
  }

  function aiDeleteRow(i: number) {
    setAiPreview((prev) => (prev ? prev.filter((_, idx) => idx !== i) : prev))
  }

  function aiReset() {
    setAiStep('upload')
    setAiPreview(null)
    setAiResult(null)
    setAiError(null)
    setAiImageFile(null)
    if (aiFileRef.current) aiFileRef.current.value = ''
  }

  function photoCreateReset() {
    setPhotoCreateStep('upload')
    setPhotoCreateFile(null)
    setPhotoCreatePreview(null)
    setPhotoCreateMatches([])
    setPhotoCreateDraft(null)
    setPhotoCreateError(null)
    if (photoCreateFileRef.current) photoCreateFileRef.current.value = ''
  }

  function cancelPhotoCreateDraft() {
    photoCreateReset()
    setNewBarcode('')
    setNewName('')
    setNewSpec('')
    setNewPrice('')
    setNewCategoryId('')
    clearNewImage()
    setMode('idle')
  }

  function handlePhotoCreateFileSelect(file: File) {
    if (['image/heic', 'image/heif'].includes(file.type)) {
      setPhotoCreateError(t('products.aiCreateHeicUnsupported'))
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPhotoCreateError(t('products.aiCreateUnsupportedFormat'))
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setPhotoCreateError(t('products.aiCreateImageTooLarge'))
      return
    }
    setPhotoCreateFile(file)
    setPhotoCreatePreview(URL.createObjectURL(file))
    setPhotoCreateMatches([])
    setPhotoCreateDraft(null)
    setPhotoCreateError(null)
    setPhotoCreateStep('upload')
  }

  async function handlePhotoCreateRecognize() {
    if (!photoCreateFile) return
    setPhotoCreateStep('recognizing')
    setPhotoCreateError(null)
    try {
      const blob = await compressForUpload(photoCreateFile)
      const uploadName = blob.type === 'image/webp' ? 'product.webp'
        : blob.type === 'image/jpeg' ? 'product.jpg' : photoCreateFile.name
      const form = new FormData()
      form.append('file', new File([blob], uploadName, { type: blob.type || photoCreateFile.type }))
      const res = await fetch('/api/products/photo-recognize-draft', {
        method: 'POST',
        headers: { ...OWNER_CTX },
        body: form,
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || body?.error) {
        setPhotoCreateError(messageForPhotoCreateError(body?.error, body?.message))
        setPhotoCreateStep('upload')
        return
      }
      const matches = Array.isArray(body?.matchedProducts) ? body.matchedProducts as AiMatchedProduct[] : []
      if (matches.length > 0) {
        setPhotoCreateMatches(matches)
        setPhotoCreateDraft(null)
        setPhotoCreateStep('matched')
        return
      }
      if (body?.draft) {
        const draft = body.draft as AiDraftProduct
        setPhotoCreateDraft(draft)
        setPhotoCreateMatches([])
        setNewBarcode(draft.barcode ?? '')
        setNewName(draft.name ?? '')
        setNewSpec(draft.spec ?? '')
        setNewPrice('')
        setNewCategoryId(draft.categoryId ?? '')
        if (photoCreatePreview) {
          setNewImageFiles([photoCreateFile])
          setNewImagePreviews([photoCreatePreview])
          setNewImageFile(photoCreateFile)
          setNewImagePreview(photoCreatePreview)
        }
        setMode('not-found')
        setPhotoCreateStep('draft')
        return
      }
      setPhotoCreateError(t('products.aiCreateNoDraft'))
      setPhotoCreateStep('upload')
    } catch {
      setPhotoCreateError(t('common.networkError'))
      setPhotoCreateStep('upload')
    }
  }

  function messageForPhotoCreateError(errorCode?: unknown, fallback?: unknown): string {
    const code = typeof errorCode === 'string' ? errorCode : ''
    if (code === 'MISSING_IMAGE' || code === 'EMPTY_IMAGE') return t('products.aiCreateMissingImage')
    if (code === 'IMAGE_TOO_LARGE') return t('products.aiCreateImageTooLarge')
    if (code === 'INVALID_MIME') return t('products.aiCreateUnsupportedFormat')
    if (code === 'AI_EMPTY') return t('products.aiCreateAiEmpty')
    if (code === 'AI_TIMEOUT') return t('products.aiCreateTimeout')
    if (code === 'AI_NOT_CONFIGURED') return t('products.aiCreateNotConfigured')
    if (code === 'AI_FAILED') return t('products.aiCreateFailed')
    return typeof fallback === 'string' && fallback.trim() ? fallback : t('products.aiCreateSystemError')
  }

  function openMatchedProduct(match: AiMatchedProduct) {
    const existing = productList.find((p) => p.id === match.productId)
    const next: Product = existing ?? {
      id: match.productId,
      barcode: '',
      name: match.name,
      spec: match.spec,
      sellPrice: match.price,
      status: match.status,
      categoryId: match.categoryId,
      imageUrl: match.imageUrl,
      imageUrls: match.imageUrl ? [match.imageUrl] : [],
    }
    setProduct(next)
    setEditName(next.name)
    setEditSpec(next.spec ?? '')
    setEditPrice(String(next.sellPrice))
    setEditStatus(next.status)
    setEditCategoryId(next.categoryId ?? '')
    setMode('found')
    window.setTimeout(() => editNameRef.current?.focus(), 100)
  }

  // ── 商品主图 ──────────────────────────────────────────────────────────────

  async function compressForUpload(file: File): Promise<Blob> {
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('image load failed'))
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
      if (!ctx) return file

      ctx.drawImage(img, 0, 0, w, h)

      const TARGET = 1.2 * 1024 * 1024
      const MIN_QUALITY = 0.65
      let quality = 0.82
      let blob: Blob | null = null
      while (quality >= MIN_QUALITY) {
        blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b), 'image/webp', quality)
        })
        if (!blob || blob.size <= TARGET) break
        quality = Math.round((quality - 0.05) * 100) / 100
      }
      // fallback to jpeg if webp toBlob unsupported
      if (!blob) {
        blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82)
        })
      }
      return blob ?? file
    } catch {
      return file
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  async function handleImageUpload(file: File, slot = 0) {
    if (!product) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setImageError(t('products.imageTypeError'))
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      // 上传前给个宽松上限，压缩后服务端再卡 2MB
      setImageError(t('products.imageSizeError'))
      return
    }
    setImageUploading(true)
    setImageError(t('products.imageCompressing'))
    try {
      setImageError(t('products.imageUploadingNow'))
      const imageUrls = await uploadProductImage(product.id, file, slot)
      setProduct(withImages(product, imageUrls))
      setImageError(null)
    } catch (e) {
      setImageError(e instanceof Error ? e.message : t('common.networkError'))
    } finally {
      setImageUploading(false)
      if (imageFileRef.current) imageFileRef.current.value = ''
    }
  }

  async function handleImageDelete(slot?: number) {
    if (!product) return
    setImageUploading(true)
    setImageError(null)
    try {
      const res = await apiFetch(
        `/api/products/${product.id}/image${slot === undefined ? '' : `?slot=${slot}`}`,
        { method: 'DELETE' },
        OWNER_CTX,
      )
      if (res.ok) {
        const nextImages = slot === undefined ? [] : productImages(product).filter((_, i) => i !== slot)
        setProduct(withImages(product, nextImages))
      } else {
        const body = await res.json().catch(() => null)
        setImageError(body?.message ?? body?.error ?? t('products.imageDeleteFailed'))
      }
    } catch {
      setImageError(t('common.networkError'))
    } finally {
      setImageUploading(false)
    }
  }

  // ── 手动新增 / 从列表编辑 ─────────────────────────────────────────────────

  function startManualNew() {
    setError(null)
    setBarcodeInput('')
    setNewBarcode('')
    setNewName('')
    setNewSpec('')
    setNewPrice('')
    setNewCategoryId('')
    clearNewImage()
    setProduct(null)
    setMode('not-found')
  }

  function handleEditFromList(p: Product) {
    setExpandedId(null)
    setListOpen(false)
    lookup(p.barcode)
  }

  // ── 列表行内图片操作（独立于 lookup → 编辑表单的 handler）───────────────

  async function listImgUpload(p: Product, file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setListImgError((v) => ({ ...v, [p.id]: t('products.imageTypeError') }))
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setListImgError((v) => ({ ...v, [p.id]: t('products.imageSizeError') }))
      return
    }
    setListImgUploading((v) => ({ ...v, [p.id]: true }))
    setListImgError((v) => ({ ...v, [p.id]: '' }))
    try {
      const imageUrls = await uploadProductImage(p.id, file, productImages(p).length > 0 ? 0 : 0)
      setProductList((prev) => prev.map((it) => (it.id === p.id ? withImages(it, imageUrls) : it)))
    } catch (e) {
      setListImgError((v) => ({ ...v, [p.id]: e instanceof Error ? e.message : t('common.networkError') }))
    } finally {
      setListImgUploading((v) => ({ ...v, [p.id]: false }))
      const inp = listImageRefs.current[p.id]
      if (inp) inp.value = ''
    }
  }

  async function listImgDelete(p: Product) {
    setListImgUploading((v) => ({ ...v, [p.id]: true }))
    setListImgError((v) => ({ ...v, [p.id]: '' }))
    try {
      const res = await apiFetch(
        `/api/products/${p.id}/image`,
        { method: 'DELETE' },
        OWNER_CTX,
      )
      if (res.ok) {
        setProductList((prev) => prev.map((it) => (it.id === p.id ? withImages(it, []) : it)))
      } else {
        const body = await res.json().catch(() => null)
        setListImgError((v) => ({ ...v, [p.id]: body?.message ?? body?.error ?? t('products.imageDeleteFailed') }))
      }
    } catch {
      setListImgError((v) => ({ ...v, [p.id]: t('common.networkError') }))
    } finally {
      setListImgUploading((v) => ({ ...v, [p.id]: false }))
    }
  }

  function clearNewImage() {
    if (newImagePreview) URL.revokeObjectURL(newImagePreview)
    newImagePreviews.forEach((url) => URL.revokeObjectURL(url))
    setNewImageFile(null)
    setNewImagePreview(null)
    setNewImageFiles([])
    setNewImagePreviews([])
    setNewImageError(null)
    if (createImageFileRef.current) createImageFileRef.current.value = ''
  }

  function handleNewImageSelect(file: File) {
    setNewImageError(null)
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setNewImageError(t('products.imageTypeError'))
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setNewImageError(t('products.imageSizeError'))
      return
    }
    if (newImageFiles.length >= 3) {
      setNewImageError(t('products.imageMaxCount'))
      return
    }
    const previewUrl = URL.createObjectURL(file)
    setNewImageFiles((prev) => [...prev, file].slice(0, 3))
    setNewImagePreviews((prev) => [...prev, previewUrl].slice(0, 3))
    if (!newImageFile) {
      setNewImageFile(file)
      setNewImagePreview(previewUrl)
    }
  }

  function removeNewImage(index: number) {
    const removed = newImagePreviews[index]
    if (removed) URL.revokeObjectURL(removed)
    const nextFiles = newImageFiles.filter((_, i) => i !== index)
    const nextPreviews = newImagePreviews.filter((_, i) => i !== index)
    setNewImageFiles(nextFiles)
    setNewImagePreviews(nextPreviews)
    setNewImageFile(nextFiles[0] ?? null)
    setNewImagePreview(nextPreviews[0] ?? null)
    if (createImageFileRef.current) createImageFileRef.current.value = ''
  }

  async function uploadProductImage(productId: string, file: File, slot = 0): Promise<string[]> {
    const blob = await compressForUpload(file)
    const uploadName = blob.type === 'image/webp' ? 'main.webp'
      : blob.type === 'image/jpeg' ? 'main.jpg' : file.name
    const form = new FormData()
    form.append('file', new File([blob], uploadName, { type: blob.type || file.type }))
    const res = await fetch(`/api/products/${productId}/image?slot=${slot}`, {
      method: 'POST',
      headers: { ...OWNER_CTX },
      body: form,
    })
    const body = await res.json().catch(() => null)
    if (res.ok && Array.isArray(body?.imageUrls)) return body.imageUrls as string[]
    if (res.ok && body?.imageUrl) return [body.imageUrl as string]
    throw new Error(body?.message ?? body?.error ?? t('products.imageUploadFailed'))
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  async function lookup(barcode: string) {
    const b = barcode.trim()
    if (!b) return
    setError(null)
    setProduct(null)
    setMode('loading')
    try {
      const res = await apiFetch(
        `/api/products?barcode=${encodeURIComponent(b)}`,
        undefined,
        OWNER_CTX,
      )
      if (res.ok) {
        const p: Product = await res.json()
        setProduct(p)
        setEditName(p.name)
        setEditSpec(p.spec ?? '')
        setEditPrice(String(p.sellPrice))
        setEditStatus(p.status)
        setEditCategoryId(p.categoryId ?? '')
        setMode('found')
        setTimeout(() => editNameRef.current?.focus(), 100)
        blockHidBriefly()
        setHidMsg({ type: 'ok', text: fmt('products.hidFound', { name: p.name }) })
        setTimeout(() => setHidMsg(null), 2500)
      } else {
        const body = await res.json().catch(() => ({}))
        if (body.error === 'PRODUCT_NOT_FOUND') {
          setNewBarcode(b)
          setNewName('')
          setNewSpec('')
          setNewPrice('')
          setMode('not-found')
          blockHidBriefly()
          setHidMsg({ type: 'fail', text: fmt('products.hidNotFound', { barcode: b }) })
          setTimeout(() => setHidMsg(null), 3000)
        } else {
          setError(t('products.queryFailedShort'))
          setMode('idle')
        }
      }
    } catch {
      setError(t('common.networkError'))
      setMode('idle')
    }
  }

  const handleScanned = useCallback((barcode: string) => {
    scanSucceededRef.current = true
    setCameraFailCount(0)
    setScannerOpen(false)
    setBarcodeInput(barcode)
    lookup(barcode)
    blockHidBriefly()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleScannerClose() {
    if (!scanSucceededRef.current) setCameraFailCount((c) => Math.min(c + 1, 5))
    scanSucceededRef.current = false
    setScannerOpen(false)
  }

  function handleCameraError(msg: string) {
    setScannerOpen(false)
    setCameraFailCount((c) => Math.min(c + 1, 5))
    setError(msg)
  }

  function openScanner() {
    scanSucceededRef.current = false
    setError(null)
    setScannerOpen(true)
  }

  function handleBarcodeKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') lookup(barcodeInput)
  }

  function reset() {
    setBarcodeInput('')
    setProduct(null)
    setMode('idle')
    setError(null)
    setEditCategoryId('')
    setNewCategoryId('')
    clearNewImage()
  }

  // ── Save (edit) ───────────────────────────────────────────────────────────

  async function handleSave() {
    if (!product) return
    const price = parseFloat(editPrice)
    if (!editName.trim()) { setError(t('products.nameRequired')); return }
    if (isNaN(price) || price <= 0) { setError(t('products.priceInvalid')); return }
    setError(null)

    try {
      const res = await apiFetch(
        `/api/products/${product.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: editName.trim(),
            spec: editSpec.trim() || null,
            sellPrice: price,
            status: editStatus,
            categoryId: editCategoryId || null,
          }),
        },
        OWNER_CTX,
      )
      const body = await res.json()
      if (res.ok) {
        setProduct(body)
        setMode('saved')
      } else {
        setError(body.message ?? t('products.saveFailed'))
      }
    } catch {
      setError(t('common.networkError'))
    }
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (creating) return
    const price = parseFloat(newPrice)
    if (!newName.trim()) { setError(t('products.nameRequired')); return }
    if (isNaN(price) || price <= 0) { setError(t('products.priceInvalid')); return }
    setError(null)
    setNewImageError(null)
    setCreating(true)

    try {
      const res = await apiFetch(
        '/api/products',
        {
          method: 'POST',
          body: JSON.stringify({
            barcode: newBarcode.trim() || undefined,
            name: newName.trim(),
            spec: newSpec.trim() || null,
            sellPrice: price,
            categoryId: newCategoryId || null,
          }),
        },
        OWNER_CTX,
      )
      const body = await res.json()
      if (res.ok) {
        let created: Product = body
        if (newImageFiles.length > 0) {
          let imageUrls: string[] = []
          for (let i = 0; i < newImageFiles.length; i++) {
            imageUrls = await uploadProductImage(created.id, newImageFiles[i], i)
          }
          created = withImages(created, imageUrls)
        }
        setProduct(created)
        setProductList((prev) => {
          const exists = prev.some((p) => p.id === created.id)
          return exists
            ? prev.map((p) => (p.id === created.id ? created : p))
            : [created, ...prev]
        })
        setEditName(created.name)
        setEditSpec(created.spec ?? '')
        setEditPrice(String(created.sellPrice))
        setEditStatus(created.status)
        setEditCategoryId(created.categoryId ?? '')
        clearNewImage()
        if (photoCreateOpen) {
          photoCreateReset()
          setPhotoCreateOpen(false)
        }
        setMode('saved')
      } else {
        setError(body.message ?? t('products.createFailed'))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('common.networkError')
      if (newImageFiles.length > 0) setNewImageError(msg)
      setError(newImageFiles.length > 0 ? fmt('products.createWithImageFailed', { message: msg }) : msg)
    } finally {
      setCreating(false)
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      {scannerOpen && (
        <BarcodeScanner
          onScanned={handleScanned}
          onClose={handleScannerClose}
          onCameraError={handleCameraError}
        />
      )}

      {/* Header */}
      <div style={{ ...s.headerBar, justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={s.headerTitle}>{t('products.title')}</span>
        <LangToggleBtn />
      </div>

      <div style={s.body}>
        <div style={s.centerIntro}>
          <div>
            <div style={s.centerSubtitle}>{t('products.centerSubtitle')}</div>
          </div>
        </div>

        <div style={s.statsGrid}>
          {stats.map((item) => (
            <div key={item.label} style={s.statCard}>
              <div style={s.statValue}>{listLoading && productList.length === 0 ? '…' : item.value}</div>
              <div style={s.statLabel}>{item.label}</div>
            </div>
          ))}
        </div>

        <div style={s.aiHeroCard}>
          <div style={s.aiHeroGlow} />
          <div style={s.aiHeroContent}>
            <div style={s.aiHeroEyebrow}>AI Beta</div>
            <div style={s.aiHeroTitle}>{t('products.aiHeroTitle')}</div>
            <div style={s.aiHeroSubtitle}>{t('products.aiHeroSubtitle')}</div>
            <div style={s.aiHeroTags}>
              <span style={s.aiHeroTag}>{t('products.aiHeroTagAccuracy')}</span>
              <span style={s.aiHeroTag}>{t('products.aiHeroTagAutoFile')}</span>
              <span style={s.aiHeroTag}>{t('products.aiHeroTagEfficient')}</span>
            </div>
            <button type="button" style={s.aiHeroBtn} onClick={openPhotoCreate}>
              {t('products.aiHeroAction')}
            </button>
          </div>
        </div>

        <div style={s.quickEntryGrid}>
          <button type="button" style={s.secondaryEntryBtn} onClick={startManualNew}>
            {t('products.manualEntryAction')}
          </button>
          <button type="button" style={s.secondaryEntryBtn} onClick={openBulkImport}>
            {t('products.bulkImportAction')}
          </button>
          <button type="button" style={s.secondaryEntryBtn} onClick={openAiImport}>
            {t('products.aiMenuImportAction')}
          </button>
        </div>

        <div style={s.searchCard}>
          {hidMsg && (
            <div style={hidMsg.type === 'ok' ? s.hidOkMsg : s.hidFailMsg}>
              {hidMsg.text}
            </div>
          )}
          {cameraFailCount >= 5 && (
            <div style={s.scanHintMsg}>{t('sale.scanFailHint')}</div>
          )}
          <div style={s.searchInputWrap}>
            <input
              style={s.searchInput}
              type="text"
              placeholder={t('products.searchSkuPlaceholder')}
              value={barcodeInput}
              onChange={(e) => {
                setBarcodeInput(e.target.value)
                onListSearchChange(e.target.value)
              }}
              onKeyDown={handleBarcodeKey}
            />
            <button
              type="button"
              style={s.searchIconBtn}
              onClick={() => lookup(barcodeInput)}
              disabled={mode === 'loading' || !barcodeInput.trim()}
              aria-label={t('products.queryBtn')}
            >
              {mode === 'loading' ? '…' : '⌕'}
            </button>
            <button
              type="button"
              style={s.scanIconBtn}
              onClick={openScanner}
              disabled={mode === 'loading'}
              aria-label={t('products.scanIconLabel')}
            >
              ⊡
            </button>
          </div>
        </div>

        {error && <div style={s.errorMsg}>{error}</div>}

        {/* ── AI 单商品拍照建档 ── */}
        {photoCreateOpen && (
        <div ref={photoCreatePanelRef} style={{ ...s.importSection, order: 3 }}>
          <button
            style={s.importToggle}
            onClick={() => setPhotoCreateOpen((v) => !v)}
          >
            <span style={s.importToggleText}>{t('products.aiCreatePanelTitle')}</span>
            <span style={s.importToggleArrow}>{photoCreateOpen ? '▲' : '▼'}</span>
          </button>

          {photoCreateOpen && (
            <div style={s.importBody}>
              {photoCreateStep === 'upload' && (
                <>
                  <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0 4px' }}>
                    {t('products.aiCreateHint')}
                  </div>
                  <div style={s.aiUploadStack}>
                    <input
                      ref={photoCreateFileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={s.hiddenFileInput}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handlePhotoCreateFileSelect(file)
                      }}
                    />
                    <button
                      type="button"
                      style={s.aiUploadCard}
                      onClick={() => photoCreateFileRef.current?.click()}
                    >
                      <span style={s.aiUploadIcon}>📷</span>
                      <span style={s.aiUploadTitle}>{t('products.aiUploadTitle')}</span>
                      <span style={s.aiUploadSubtitle}>{t('products.aiUploadSubtitle')}</span>
                    </button>
                    {photoCreatePreview && (
                      <div style={s.aiDraftImageWrap}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photoCreatePreview} alt={t('products.imageTitle')} style={s.aiDraftImage} />
                      </div>
                    )}
                    {photoCreateFile && (
                      <div style={s.aiSelectedFile}>
                        {t('products.aiSelectedFile')} {photoCreateFile.name}
                      </div>
                    )}
                    <button
                      style={{
                        ...s.aiRecognizeBtn,
                        opacity: !photoCreateFile ? 0.5 : 1,
                        cursor: !photoCreateFile ? 'not-allowed' : 'pointer',
                      }}
                      type="button"
                      disabled={!photoCreateFile}
                      onClick={handlePhotoCreateRecognize}
                    >
                      {photoCreateFile ? t('products.aiBtn') : t('products.aiSelectFirst')}
                    </button>
                  </div>
                  {photoCreateError && <div style={s.importErrorMsg}>{photoCreateError}</div>}
                </>
              )}

              {photoCreateStep === 'recognizing' && (
                <div style={s.aiRecognizingBox}>
                  <div style={s.aiRecognizingSpinner}>●</div>
                  <button type="button" style={{ ...s.aiRecognizeBtn, opacity: 0.72 }} disabled>
                    {t('products.aiRecognizing')}
                  </button>
                </div>
              )}

              {photoCreateStep === 'matched' && (
                <div style={s.aiDraftStack}>
                  <div style={s.aiDraftNotice}>
                    <div style={s.aiDraftNoticeTitle}>{t('products.aiCreateMatchedTitle')}</div>
                    <div style={s.aiDraftNoticeSub}>{t('products.aiCreateMatchedSub')}</div>
                  </div>
                  {photoCreateMatches.map((match) => (
                    <div key={match.productId} style={s.aiMatchedCard}>
                      <div style={s.aiMatchedMain}>
                        {match.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={match.imageUrl} alt={match.name} style={s.aiMatchedImg} />
                        ) : (
                          <div style={s.aiMatchedPlaceholder}>IMG</div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={s.aiMatchedName}>{match.name}</div>
                          <div style={s.aiMatchedMeta}>{match.spec || '-'} · ${match.price.toFixed(2)} · {match.status}</div>
                          <div style={s.aiMatchedReason}>
                            {t('products.aiCreateConfidence')} {Math.round(match.confidence * 100)}%
                          </div>
                        </div>
                      </div>
                      <button type="button" style={s.aiSmallPrimaryBtn} onClick={() => openMatchedProduct(match)}>
                        {t('products.aiCreateViewEdit')}
                      </button>
                    </div>
                  ))}
                  <button type="button" style={s.aiSecondaryBtn} onClick={photoCreateReset}>
                    {t('products.aiRedo')}
                  </button>
                </div>
              )}

              {photoCreateStep === 'draft' && photoCreateDraft && (
                <div style={s.aiDraftStack}>
                  <div style={s.aiDraftNotice}>
                    <div style={s.aiDraftNoticeTitle}>{t('products.aiCreateDraftTitle')}</div>
                    <div style={s.aiDraftNoticeSub}>{t('products.aiCreateDraftSub')}</div>
                  </div>
                  <div style={s.aiDraftCard}>
                    {photoCreatePreview && (
                      <div style={s.aiDraftImageWrap}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photoCreatePreview} alt={newName || t('products.imageTitle')} style={s.aiDraftImage} />
                      </div>
                    )}
                    <div style={s.aiDraftWarning}>
                      {photoCreateDraft.warning || t('products.aiCreateWarning')}
                      {photoCreateDraft.confidence ? ` · ${t('products.aiCreateConfidence')} ${Math.round(photoCreateDraft.confidence * 100)}%` : ''}
                    </div>

                    <Field label={t('products.fieldName')}>
                      <input style={s.field} value={newName} onChange={(e) => setNewName(e.target.value)} />
                    </Field>
                    <Field label={t('products.fieldCategory')}>
                      <CategorySelect
                        categories={categories}
                        value={newCategoryId}
                        onChange={setNewCategoryId}
                        noneLabel={photoCreateDraft.categorySuggestion || t('products.noCategory')}
                      />
                    </Field>
                    <Field label={t('products.fieldSpec')}>
                      <input style={s.field} value={newSpec} onChange={(e) => setNewSpec(e.target.value)} />
                    </Field>
                    <Field label={t('products.barcodeLabel')}>
                      <input style={s.field} value={newBarcode} onChange={(e) => setNewBarcode(e.target.value)} placeholder={t('products.barcodePlaceholder')} />
                    </Field>
                    <Field label={t('products.fieldPrice')}>
                      <input
                        style={s.field}
                        type="text"
                        inputMode="decimal"
                        value={newPrice}
                        onChange={(e) => setNewPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                        placeholder="0.00"
                      />
                    </Field>
                    <div style={s.aiDraftStatusLine}>{t('products.aiCreateStatusHint')}</div>
                    <button
                      type="button"
                      style={{ ...s.saveBtn, opacity: (!newName.trim() || !newPrice.trim() || creating) ? 0.55 : 1 }}
                      disabled={!newName.trim() || !newPrice.trim() || creating}
                      onClick={handleCreate}
                    >
                      {creating ? t('products.saving') : t('products.aiCreateSave')}
                    </button>
                    <button type="button" style={s.aiSecondaryBtn} onClick={cancelPhotoCreateDraft}>
                      {t('products.deleteBack')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {/* ── 批量导入 ── */}
        {importOpen && (
        <div ref={importPanelRef} style={{ ...s.importSection, order: 3 }}>
          <button
            style={s.importToggle}
            onClick={() => setImportOpen((v) => !v)}
          >
            <span style={s.importToggleText}>{t('products.bulkImportAction')}</span>
            <span style={s.importToggleArrow}>{importOpen ? '▲' : '▼'}</span>
          </button>

          {importOpen && (
            <div style={s.importBody}>

              {/* ── 步骤一：上传文件 ── */}
              {importStep === 'upload' && (
                <>
                  <button style={s.templateBtn} onClick={downloadTemplate} type="button">
                    {t('products.downloadTemplate')}
                  </button>

                  <div style={s.uploadRow}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      style={s.fileInput}
                      onChange={(e) => {
                        setImportFile(e.target.files?.[0] ?? null)
                        setImportResult(null)
                        setImportError(null)
                      }}
                    />
                    <button
                      style={{ ...s.importBtn, opacity: (!importFile || importing) ? 0.5 : 1 }}
                      type="button"
                      disabled={!importFile || importing}
                      onClick={handleImport}
                    >
                      {importing ? t('products.importing') : t('products.importBtn')}
                    </button>
                  </div>

                  {importError && <div style={s.importErrorMsg}>{importError}</div>}
                </>
              )}

              {/* ── 步骤二：预览确认 ── */}
              {importStep === 'preview' && importPreview && (
                <>
                  {/* 预览摘要 */}
                  <div style={pr.summary}>
                    {(() => {
                      const ok  = importPreview.filter((r) => !r.error)
                      const bad = importPreview.filter((r) => r.error)
                      const newRows = ok.filter((r) => !r.isDuplicate)
                      const updRows = ok.filter((r) => r.isDuplicate)
                      const cats = new Set(ok.filter((r) => r.resolvedL1).map((r) => `${r.resolvedL1}__${r.resolvedL2 ?? ''}`))
                      const imgs = ok.filter((r) => r.imageUrl).length
                      return (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 13 }}>
                          <span>分类 <strong style={{ color: '#1677ff' }}>{cats.size}</strong></span>
                          <span>新增 <strong style={{ color: '#52c41a' }}>{newRows.length}</strong></span>
                          {updRows.length > 0 && <span>更新 <strong style={{ color: '#1677ff' }}>{updRows.length}</strong></span>}
                          <span>图片 <strong style={{ color: '#faad14' }}>{imgs}</strong></span>
                          {bad.length > 0 && <span style={{ color: '#ff4d4f' }}>问题行 {bad.length}（将跳过）</span>}
                        </div>
                      )
                    })()}
                  </div>

                  <div style={pr.scroll}>
                    <table style={pr.table}>
                      <thead>
                        <tr>
                          <th style={pr.th}>商品名（中/英）</th>
                          <th style={pr.th}>售价</th>
                          <th style={pr.th}>分类</th>
                          <th style={pr.th}>图片</th>
                          <th style={pr.th}>状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.map((row) => (
                          <tr key={row.rowNum} style={row.error ? pr.errRow : {}}>
                            <td style={pr.td}>
                              <div style={{ fontWeight: 600 }}>{row.nameZh || row.name}</div>
                              {row.nameEn && <div style={{ color: '#6b7280', fontSize: 11 }}>{row.nameEn}</div>}
                              {row.spec && <div style={{ color: '#aaa', fontSize: 11 }}>{row.spec}</div>}
                            </td>
                            <td style={pr.td}>${row.sellPrice.toFixed(2)}</td>
                            <td style={pr.td}>
                              {row.resolvedL1
                                ? <span>{row.resolvedL1}{row.resolvedL2 ? ` › ${row.resolvedL2}` : ''} <CatSourceBadge source={row.catSource} /></span>
                                : <span style={{ color: '#ccc' }}>—</span>
                              }
                            </td>
                            <td style={pr.td}>
                              {row.imageUrl
                                ? <span style={{ color: '#faad14', fontSize: 12 }}>📷</span>
                                : <span style={{ color: '#e5e7eb', fontSize: 12 }}>—</span>
                              }
                            </td>
                            <td style={pr.td}>
                              {row.error
                                ? <span style={{ color: '#ff4d4f', fontSize: 11 }}>{row.error}</span>
                                : row.isDuplicate
                                  ? <span style={{ color: '#1677ff', fontSize: 12 }}>🔄 更新</span>
                                  : <span style={{ color: '#52c41a', fontSize: 13 }}>✓ 新增</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {importError && <div style={s.importErrorMsg}>{importError}</div>}

                  <div style={pr.actions}>
                    <button
                      style={{ ...s.importBtn, background: '#f5f5f5', color: '#555', border: '1px solid #d9d9d9' }}
                      onClick={() => { setImportStep('upload'); setImportPreview(null); setImportError(null) }}
                    >
                      重新上传
                    </button>
                    <button
                      style={{
                        ...s.importBtn,
                        opacity: (importConfirming || importPreview.filter((r) => !r.error).length === 0) ? 0.5 : 1,
                      }}
                      disabled={importConfirming || importPreview.filter((r) => !r.error).length === 0}
                      onClick={handleConfirmImport}
                    >
                      {importConfirming ? '导入中…' : `确认导入 ${importPreview.filter((r) => !r.error).length} 件`}
                    </button>
                  </div>
                </>
              )}

              {/* ── 步骤三：导入结果 ── */}
              {importStep === 'done' && importResult && (
                <>
                  <div style={s.importResult}>
                    <div style={s.importResultSummary}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 13, marginBottom: 8 }}>
                        <span>分类新建 <strong style={{ color: '#1677ff' }}>{importResult.catCreated}</strong></span>
                        <span>商品导入 <strong style={{ color: '#52c41a' }}>{importResult.imported}</strong></span>
                        <span>含图片 <strong style={{ color: '#faad14' }}>{importResult.imageCount}</strong></span>
                        <span>失败 <strong style={{ color: importResult.failed > 0 ? '#ff4d4f' : '#9ca3af' }}>{importResult.failed}</strong></span>
                      </div>
                    </div>
                    {importResult.errors.length > 0 && (
                      <div style={s.importErrorList}>
                        {importResult.errors.map((e, i) => (
                          <div key={i} style={s.importErrorRow}>
                            <span style={s.importErrorRowNum}>{t('products.importRowPrefix')} {e.row} {t('products.importRowSuffix')}</span>
                            <span style={s.importErrorBarcode}>{e.barcode}</span>
                            <span style={s.importErrorReason}>{e.reason}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    style={{ ...s.importBtn, marginTop: 4 }}
                    onClick={() => { setImportStep('upload'); setImportPreview(null); setImportResult(null); setImportError(null) }}
                  >
                    继续导入
                  </button>
                </>
              )}

            </div>
          )}
        </div>
        )}

        {/* ── AI 识别菜单导入 ── */}
        {aiOpen && (
        <div ref={aiPanelRef} style={{ ...s.importSection, order: 3 }}>
          <button
            style={s.importToggle}
            onClick={() => {
              setAiOpen((v) => !v)
              aiReset()
            }}
          >
            <span style={s.importToggleText}>{t('products.aiHeroTitle')}</span>
            <span style={s.importToggleArrow}>{aiOpen ? '▲' : '▼'}</span>
          </button>

          {aiOpen && (
            <div style={s.importBody}>
              {aiStep === 'upload' && (
                <>
                  <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0 4px' }}>
                    {t('products.aiHint')}
                  </div>
                  <div style={s.aiUploadStack}>
                    <input
                      ref={aiFileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={s.hiddenFileInput}
                      onChange={(e) => {
                        setAiImageFile(e.target.files?.[0] ?? null)
                        setAiError(null)
                      }}
                    />
                    <button
                      type="button"
                      style={s.aiUploadCard}
                      onClick={() => aiFileRef.current?.click()}
                    >
                      <span style={s.aiUploadIcon}>📷</span>
                      <span style={s.aiUploadTitle}>{t('products.aiUploadTitle')}</span>
                      <span style={s.aiUploadSubtitle}>{t('products.aiUploadSubtitle')}</span>
                    </button>
                    {aiImageFile && (
                      <div style={s.aiSelectedFile}>
                        {t('products.aiSelectedFile')} {aiImageFile.name}
                      </div>
                    )}
                    <button
                      style={{
                        ...s.aiRecognizeBtn,
                        opacity: !aiImageFile ? 0.5 : 1,
                        cursor: !aiImageFile ? 'not-allowed' : 'pointer',
                      }}
                      type="button"
                      disabled={!aiImageFile}
                      onClick={handleAiRecognize}
                    >
                      {aiImageFile ? t('products.aiBtn') : t('products.aiSelectFirst')}
                    </button>
                  </div>
                  {aiError && <div style={s.importErrorMsg}>{aiError}</div>}
                </>
              )}

              {aiStep === 'recognizing' && (
                <div style={s.aiRecognizingBox}>
                  <div style={s.aiRecognizingSpinner}>●</div>
                  <button type="button" style={{ ...s.aiRecognizeBtn, opacity: 0.72 }} disabled>
                    {t('products.aiRecognizing')}
                  </button>
                </div>
              )}

              {aiStep === 'preview' && aiPreview && (
                <>
                  <div style={pr.summary}>
                    {t('products.aiPreviewTitle')} · {aiPreview.filter((r) => r.include).length} / {aiPreview.length}
                  </div>
                  <div style={pr.scroll}>
                    <table style={pr.table}>
                      <thead>
                        <tr>
                          <th style={{ ...pr.th, width: 40 }}>{t('products.aiInclude')}</th>
                          <th style={pr.th}>{t('products.aiName')}</th>
                          <th style={pr.th}>{t('products.aiCategory')}</th>
                          <th style={{ ...pr.th, width: 80 }}>{t('products.aiPrice')}</th>
                          <th style={{ ...pr.th, width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {aiPreview.map((row, i) => {
                          const nameEmpty = !row.name.trim()
                          const priceEmpty = !row.sellPrice || row.sellPrice <= 0
                          const incomplete = nameEmpty || priceEmpty
                          return (
                            <tr key={i} style={incomplete && row.include ? pr.errRow : {}}>
                              <td style={pr.td}>
                                <input
                                  type="checkbox"
                                  checked={row.include && !incomplete}
                                  disabled={incomplete}
                                  onChange={() => aiToggleInclude(i)}
                                />
                              </td>
                              <td style={pr.td}>
                                <input
                                  style={ai.cellInput}
                                  value={row.name}
                                  onChange={(e) => aiEditRow(i, 'name', e.target.value)}
                                />
                                {nameEmpty && <div style={ai.warnText}>{t('products.aiNeedName')}</div>}
                                {row.warnings && row.warnings.length > 0 && (
                                  <div style={ai.warnText}>⚠ {row.warnings.join('; ')}</div>
                                )}
                              </td>
                              <td style={pr.td}>
                                <input
                                  style={ai.cellInput}
                                  value={row.resolvedL1 ?? ''}
                                  placeholder="—"
                                  onChange={(e) => aiEditRow(i, 'category', e.target.value)}
                                />
                              </td>
                              <td style={pr.td}>
                                <input
                                  style={ai.cellInput}
                                  inputMode="decimal"
                                  value={row.sellPrice > 0 ? String(row.sellPrice) : ''}
                                  placeholder="0.00"
                                  onChange={(e) => aiEditRow(i, 'price', e.target.value)}
                                />
                                {priceEmpty && <div style={ai.warnText}>{t('products.aiNeedPrice')}</div>}
                              </td>
                              <td style={pr.td}>
                                <button
                                  type="button"
                                  style={ai.delBtn}
                                  onClick={() => aiDeleteRow(i)}
                                  aria-label={t('products.aiDelete')}
                                >
                                  ×
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {aiError && <div style={s.importErrorMsg}>{aiError}</div>}

                  <div style={pr.actions}>
                    <button
                      style={{ ...s.importBtn, background: '#f5f5f5', color: '#555', border: '1px solid #d9d9d9' }}
                      onClick={() => { setAiStep('upload'); setAiPreview(null); setAiError(null) }}
                    >
                      {t('products.aiRedo')}
                    </button>
                    <button
                      style={{
                        ...s.importBtn,
                        opacity: aiPreview.filter((r) => r.include && r.name.trim() && r.sellPrice > 0).length === 0 ? 0.5 : 1,
                      }}
                      disabled={aiPreview.filter((r) => r.include && r.name.trim() && r.sellPrice > 0).length === 0}
                      onClick={handleAiConfirm}
                    >
                      {t('products.aiConfirm')} {aiPreview.filter((r) => r.include && r.name.trim() && r.sellPrice > 0).length}
                    </button>
                  </div>
                </>
              )}

              {aiStep === 'done' && aiResult && (
                <>
                  <div style={s.importResult}>
                    <div style={s.importResultSummary}>
                      <span style={s.importOk}>{t('products.importOkPrefix')} {aiResult.imported} {t('products.importCountSuffix')}</span>
                      {aiResult.failed > 0 && (
                        <span style={s.importFail}>{t('products.importFailPrefix')} {aiResult.failed} {t('products.importCountSuffix')}</span>
                      )}
                    </div>
                    {aiResult.errors.length > 0 && (
                      <div style={s.importErrorList}>
                        {aiResult.errors.map((e, idx) => (
                          <div key={idx} style={s.importErrorRow}>
                            <span style={s.importErrorBarcode}>{e.barcode}</span>
                            <span style={s.importErrorReason}>{e.reason}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button style={{ ...s.importBtn, marginTop: 4 }} onClick={aiReset}>
                    {t('products.aiRedo')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        )}

        {/* ── 分类管理 ── */}
        <div style={{ ...s.importSection, order: 8 }}>
          <button style={s.importToggle} onClick={() => { setCatOpen((v) => !v); setCatError(null) }}>
            <span style={s.importToggleText}>{t('products.categories')}</span>
            <span style={s.importToggleArrow}>{catOpen ? '▲' : '▼'}</span>
          </button>

          {catOpen && (
            <div style={s.importBody}>
              {/* 分类列表 */}
              {categories.length > 0 && (
                <div style={s.catList}>
                  {(() => {
                    const l1 = categories.filter((c) => !c.parentId)
                    const l2Map = new Map<string, Category[]>()
                    categories.filter((c) => c.parentId).forEach((c) => {
                      const arr = l2Map.get(c.parentId!) ?? []
                      arr.push(c)
                      l2Map.set(c.parentId!, arr)
                    })
                    // Also collect l2 with no matching l1 parent (orphans)
                    const orphanL2 = categories.filter((c) => c.parentId && !l1.find((p) => p.id === c.parentId))

                    return (
                      <>
                        {l1.map((cat) => (
                          <div key={cat.id}>
                            <div style={s.catL1Row}>{cat.name}</div>
                            {(l2Map.get(cat.id) ?? []).map((sub) => (
                              <div key={sub.id} style={s.catL2Row}>└ {sub.name}</div>
                            ))}
                          </div>
                        ))}
                        {orphanL2.map((c) => (
                          <div key={c.id} style={s.catL2Row}>└ {c.name}</div>
                        ))}
                      </>
                    )
                  })()}
                </div>
              )}
              {categories.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--muted)', padding: '4px 0 8px' }}>{t('products.noCategories')}</div>
              )}

              {/* 添加分类 */}
              <div style={s.catAddRow}>
                <input
                  style={{ ...s.field, flex: 1, height: 40, marginBottom: 0 }}
                  placeholder={t('products.catAddPlaceholder')}
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory() }}
                />
                <select
                  style={s.catParentSelect}
                  value={newCatParentId}
                  onChange={(e) => setNewCatParentId(e.target.value)}
                >
                  <option value="">{t('products.catParentNone')}</option>
                  {categories.filter((c) => !c.parentId).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <button
                style={{ ...s.importBtn, opacity: (!newCatName.trim() || catSaving) ? 0.5 : 1, height: 40, marginTop: 6 }}
                disabled={!newCatName.trim() || catSaving}
                onClick={handleAddCategory}
              >
                {catSaving ? '…' : t('products.catAddBtn')}
              </button>
              {catError && <div style={s.importErrorMsg}>{catError}</div>}
            </div>
          )}
        </div>

        {/* ── 商品列表（删除管理） ── */}
        <div style={{ ...s.importSection, order: 4 }}>
          <button style={s.importToggle} onClick={toggleList}>
            <span style={s.importToggleText}>{listOpen ? t('products.allProductsEntry') : t('products.recentProducts')}</span>
            <span style={s.importToggleArrow}>{listOpen ? t('products.collapseProducts') : t('products.showAllProducts')}</span>
          </button>

          {(
            <div style={s.importBody}>
              {listLoading && (
                <div style={{ fontSize: 13, color: 'var(--muted)', padding: '4px 0' }}>{t('common.loading')}</div>
              )}

              {listError && <div style={s.importErrorMsg}>{listError}</div>}

              {!listLoading && productList.length > 0 && (
                <>
                  <div style={{ ...ls.filterRow, display: listOpen ? 'flex' : 'none' }}>
                    <input
                      style={ls.searchInput}
                      value={listSearch}
                      onChange={(e) => onListSearchChange(e.target.value)}
                      placeholder={t('products.searchPlaceholder')}
                    />
                    <select
                      style={ls.categoryFilter}
                      value={listCategoryId}
                      onChange={(e) => onListCategoryChange(e.target.value)}
                    >
                      <option value="">{t('products.allCategories')}</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.parentId ? '└ ' : ''}{c.name}
                        </option>
                      ))}
                    </select>
                    {(listSearch || listCategoryId) && (
                      <button type="button" style={ls.resetFilterBtn} onClick={resetListFilters}>
                        {t('products.clearFilter')}
                      </button>
                    )}
                  </div>

                  {/* Header row: select-all + batch delete */}
                  <div style={{ ...ls.headerRow, display: listOpen ? 'flex' : 'none' }}>
                    <label style={ls.checkLabel}>
                      <input
                        type="checkbox"
                        checked={selectAllVisibleChecked()}
                        onChange={toggleSelectAll}
                        style={ls.checkbox}
                      />
                      <span style={ls.selectAllText}>
                        {t('products.selectAll')}（{filteredProductList.length}）
                      </span>
                    </label>
                    {selectedVisibleCount() > 0 && (
                      <button
                        style={ls.batchDeleteBtn}
                        onClick={() => setDeleteConfirm({ type: 'batch', ids: selectedVisibleIds() })}
                      >
                        {t('products.batchDelete')}（{selectedVisibleCount()}）
                      </button>
                    )}
                  </div>

	                  {/* Product rows */}
                  {filteredProductList.length === 0 && (
                    <div style={{ fontSize: 13, color: 'var(--muted)', padding: '10px 0' }}>{t('products.noProductMatch')}</div>
                  )}

	                  {displayedProductList.map((p) => {
	                    const isExpanded = expandedId === p.id
	                    const uploading = !!listImgUploading[p.id]
	                    const marketingPage = marketingPages[p.id]
	                    const generatingMarketing = !!marketingGenerating[p.id]
	                    return (
	                      <div key={p.id} style={ls.rowWrap}>
                        <div style={ls.row}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(p.id)}
                            onChange={() => toggleSelect(p.id)}
                            style={ls.checkbox}
                          />
                          <div
                            style={{ ...ls.rowInfo, cursor: 'pointer' }}
                            onClick={() => setExpandedId(isExpanded ? null : p.id)}
                          >
                            <span style={{ ...ls.rowName, color: p.status === 'DISABLED' ? 'var(--muted)' : 'var(--text)' }}>
                              {p.name}{p.spec ? ` · ${p.spec}` : ''}
                            </span>
                            <span style={ls.rowMeta}>
	                              {p.barcode}
	                              {p.status === 'DISABLED' && <span style={ls.disabledTag}>{t('products.disabledInlineTag')}</span>}
	                              {p.imageUrl && <span style={ls.imgTag}>{t('products.imageInlineTag')}</span>}
	                              {marketingPage && <span style={ls.imgTag}> · 营销页 {marketingPage.status}</span>}
	                            </span>
	                          </div>
                          <button
                            type="button"
                            style={ls.chevronBtn}
                            onClick={() => setExpandedId(isExpanded ? null : p.id)}
                            aria-label="展开"
                          >
                            {isExpanded ? '▴' : '▾'}
                          </button>
                        </div>

                        {isExpanded && (
                          <div style={ls.expandedPanel}>
                            <input
                              ref={(el) => { listImageRefs.current[p.id] = el }}
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              style={{ display: 'none' }}
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) listImgUpload(p, file)
                              }}
                            />

                            <div style={ls.imgRow}>
                              {p.imageUrl ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={p.imageUrl} alt={p.name} loading="lazy" decoding="async" style={ls.imgPreview} />
                              ) : (
                                <div style={ls.imgEmpty}>—</div>
                              )}
                              <div style={ls.imgBtns}>
                                <button
                                  type="button"
                                  style={ls.imgBtn}
                                  disabled={uploading}
                                  onClick={() => listImageRefs.current[p.id]?.click()}
                                >
                                  {uploading
                                    ? t('products.imageUploading')
                                    : p.imageUrl
                                    ? t('products.imageReplace')
                                    : t('products.imageUpload')}
                                </button>
                                {p.imageUrl && (
                                  <button
                                    type="button"
                                    style={{ ...ls.imgBtn, ...ls.imgBtnDanger }}
                                    disabled={uploading}
                                    onClick={() => listImgDelete(p)}
                                  >
                                    {uploading ? t('products.imageDeleting') : t('products.imageDelete')}
                                  </button>
                                )}
                              </div>
                            </div>
	                            {listImgError[p.id] && <div style={ls.imgErr}>{listImgError[p.id]}</div>}

	                            <div style={ls.actionRow}>
	                              <button
	                                type="button"
	                                style={{ ...ls.actionBtn, opacity: generatingMarketing ? 0.5 : 1 }}
	                                disabled={generatingMarketing}
	                                onClick={() => handleAiGenerateMarketingPage(p)}
	                              >
	                                {generatingMarketing ? '生成中...' : marketingPage ? '✨ AI重新生成' : '✨ AI生成营销页'}
	                              </button>
	                              <button type="button" style={ls.actionBtn} onClick={() => handleMarketingPage(p)}>
	                                {marketingPage ? '高级编辑' : '手动营销页'}
	                              </button>
	                              <button
	                                type="button"
	                                style={{ ...ls.actionBtn, opacity: marketingPage ? 1 : 0.5 }}
	                                disabled={!marketingPage}
	                                onClick={() => copyMarketingLink(p.id)}
	                              >
	                                复制链接
	                              </button>
	                              <button type="button" style={ls.actionBtn} onClick={() => handleEditFromList(p)}>
	                                {t('products.editBtn')}
	                              </button>
                              <button
                                type="button"
                                style={{ ...ls.actionBtn, ...ls.actionBtnDanger }}
                                onClick={() => setDeleteConfirm({ type: 'single', id: p.id, name: p.name })}
                              >
                                {t('products.deleteBtn')}
                              </button>
	                            </div>

	                            {marketingEditing?.product.id === p.id && (
	                              <div style={{ marginTop: 10, padding: 10, background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8 }}>
	                                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>营销商品页</div>
	                                <input
	                                  style={{ ...s.field, height: 38, marginBottom: 8 }}
	                                  value={marketingTitle}
	                                  onChange={(e) => setMarketingTitle(e.target.value)}
	                                  placeholder="标题"
	                                />
	                                <input
	                                  style={{ ...s.field, height: 38, marginBottom: 8 }}
	                                  value={marketingSubtitle}
	                                  onChange={(e) => setMarketingSubtitle(e.target.value)}
	                                  placeholder="副标题"
	                                />
	                                <select
	                                  style={{ ...s.field, height: 38, marginBottom: 8 }}
	                                  value={marketingTemplateType}
	                                  onChange={(e) => setMarketingTemplateType(e.target.value as MarketingTemplateType)}
	                                >
	                                  {MARKETING_TEMPLATE_OPTIONS.map((option) => (
	                                    <option key={option.value} value={option.value}>{option.label}</option>
	                                  ))}
	                                </select>
	                                <input
	                                  style={{ ...s.field, height: 38, marginBottom: 8 }}
	                                  value={marketingSlug}
	                                  onChange={(e) => setMarketingSlug(e.target.value)}
	                                  placeholder="slug"
	                                />
                                  {renderMarketingImageInput('heroImageUrl', marketingHeroImageUrl, setMarketingHeroImageUrl, 'Hero 图片 URL')}
                                  <div style={s.marketingImageRow}>
                                    <input
                                      style={{ ...s.field, ...s.marketingImageInput }}
                                      value={marketingHeroVideoUrl}
                                      onChange={(e) => setMarketingHeroVideoUrl(e.target.value)}
                                      placeholder="产品视频 URL（MP4）"
                                    />
                                    <input
                                      ref={marketingVideoRef}
                                      type="file"
                                      accept="video/mp4"
                                      style={{ display: 'none' }}
                                      onChange={(e) => {
                                        const file = e.target.files?.[0]
                                        if (file) uploadMarketingVideo(file)
                                      }}
                                    />
                                    <button
                                      type="button"
                                      style={{ ...ls.actionBtn, ...s.marketingUploadBtn, opacity: marketingVideoUploading ? 0.55 : 1 }}
                                      disabled={marketingVideoUploading}
                                      onClick={() => marketingVideoRef.current?.click()}
                                    >
                                      {marketingVideoUploading ? '上传中...' : '上传视频'}
                                    </button>
                                  </div>
	                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
	                                  <input
	                                    style={{ ...s.field, height: 38, marginBottom: 8 }}
	                                    value={marketingSalePrice}
	                                    onChange={(e) => setMarketingSalePrice(e.target.value)}
	                                    placeholder="营销价"
	                                    inputMode="decimal"
	                                  />
	                                  <input
	                                    style={{ ...s.field, height: 38, marginBottom: 8 }}
	                                    value={marketingOriginalPrice}
	                                    onChange={(e) => setMarketingOriginalPrice(e.target.value)}
	                                    placeholder="原价"
	                                    inputMode="decimal"
	                                  />
	                                </div>
	                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
	                                  <input
	                                    style={{ ...s.field, height: 38, marginBottom: 8 }}
	                                    value={marketingSoldCount}
	                                    onChange={(e) => setMarketingSoldCount(e.target.value)}
	                                    placeholder="已售数量"
	                                    inputMode="numeric"
	                                  />
	                                  <input
	                                    style={{ ...s.field, height: 38, marginBottom: 8 }}
	                                    value={marketingButtonText}
	                                    onChange={(e) => setMarketingButtonText(e.target.value)}
	                                    placeholder="按钮文案"
	                                  />
	                                </div>
	                                {marketingFeatures.map((value, idx) => (
	                                  <input
	                                    key={`feature-${idx}`}
	                                    style={{ ...s.field, height: 38, marginBottom: 8 }}
	                                    value={value}
	                                    onChange={(e) => {
	                                      const next = [...marketingFeatures]
	                                      next[idx] = e.target.value
	                                      setMarketingFeatures(next)
	                                    }}
	                                    placeholder={`卖点 ${idx + 1}`}
	                                  />
	                                ))}
	                                <div style={{ display: 'grid', gap: 8, margin: '8px 0 10px' }}>
	                                  {MARKETING_LANG_LABELS.map(({ lang, label }) => (
	                                    <div key={lang} style={{ padding: 10, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
	                                      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginBottom: 8 }}>
	                                        {label} 内容
	                                      </div>
	                                      <input
	                                        style={{ ...s.field, height: 38, marginBottom: 8 }}
	                                        value={marketingLangContent[lang].title}
	                                        onChange={(e) => setMarketingLangContent((prev) => ({
	                                          ...prev,
	                                          [lang]: { ...prev[lang], title: e.target.value },
	                                        }))}
	                                        placeholder={`${label} 标题`}
	                                      />
	                                      {marketingLangContent[lang].features.map((value, idx) => (
	                                        <input
	                                          key={`${lang}-feature-${idx}`}
	                                          style={{ ...s.field, height: 38, marginBottom: 8 }}
	                                          value={value}
	                                          onChange={(e) => setMarketingLangContent((prev) => {
	                                            const features = [...prev[lang].features]
	                                            features[idx] = e.target.value
	                                            return { ...prev, [lang]: { ...prev[lang], features } }
	                                          })}
	                                          placeholder={`${label} 卖点 ${idx + 1}`}
	                                        />
	                                      ))}
	                                      <input
	                                        style={{ ...s.field, height: 38 }}
	                                        value={marketingLangContent[lang].buttonText}
	                                        onChange={(e) => setMarketingLangContent((prev) => ({
	                                          ...prev,
	                                          [lang]: { ...prev[lang], buttonText: e.target.value },
	                                        }))}
	                                        placeholder={`${label} 按钮文案`}
	                                      />
	                                    </div>
	                                  ))}
	                                </div>
	                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '2px 0 10px' }}>
	                                  <input
	                                    type="checkbox"
	                                    checked={marketingEnableCountdown}
	                                    onChange={(e) => setMarketingEnableCountdown(e.target.checked)}
	                                  />
	                                  开启限时倒计时展示
	                                </label>
                                {marketingDetailImages.map((value, idx) => (
                                  <div key={`detail-${idx}`}>
                                    {renderMarketingImageInput(
                                      `detailImage${idx + 1}` as MarketingImageField,
                                      value,
                                      (nextValue) => {
                                        const next = [...marketingDetailImages]
                                        next[idx] = nextValue
                                        setMarketingDetailImages(next)
                                      },
                                      `详情图 ${idx + 1} URL`,
                                    )}
                                  </div>
                                ))}
                                {marketingReviewImages.map((value, idx) => (
                                  <div key={`review-${idx}`}>
                                    {renderMarketingImageInput(
                                      `reviewImage${idx + 1}` as MarketingImageField,
                                      value,
                                      (nextValue) => {
                                        const next = [...marketingReviewImages]
                                        next[idx] = nextValue
                                        setMarketingReviewImages(next)
                                      },
                                      `评价图 ${idx + 1} URL`,
                                    )}
                                  </div>
                                ))}
	                                <select
	                                  style={{ ...s.field, height: 38, marginBottom: 8 }}
	                                  value={marketingStatus}
	                                  onChange={(e) => setMarketingStatus(e.target.value as 'DRAFT' | 'PUBLISHED' | 'DISABLED')}
	                                >
	                                  <option value="DRAFT">DRAFT</option>
	                                  <option value="PUBLISHED">PUBLISHED</option>
	                                  <option value="DISABLED">DISABLED</option>
	                                </select>
	                                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, overflowWrap: 'anywhere' }}>
	                                  {productPageUrl(marketingSlug)}
	                                </div>
	                                <div style={ls.actionRow}>
	                                  <button
	                                    type="button"
	                                    style={{ ...ls.actionBtn, opacity: marketingSaving ? 0.5 : 1 }}
	                                    disabled={marketingSaving}
	                                    onClick={saveMarketingPage}
	                                  >
	                                    {marketingSaving ? '保存中...' : '保存'}
	                                  </button>
	                                  <button type="button" style={ls.actionBtn} onClick={() => copyMarketingLink(p.id)}>
	                                    复制链接
	                                  </button>
	                                  <button type="button" style={ls.actionBtn} onClick={() => setMarketingEditing(null)}>
	                                    收起
	                                  </button>
	                                </div>
	                              </div>
	                            )}
	                          </div>
	                        )}
	                      </div>
                    )
                  })}
                </>
              )}

              {!listLoading && productList.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--muted)', padding: '4px 0 8px' }}>{t('products.noProducts')}</div>
              )}

	              {deleteMsg && <div style={s.errorMsg}>{deleteMsg}</div>}
	              {marketingMsg && <div style={marketingMsg.includes('失败') ? s.errorMsg : s.successMsg}>{marketingMsg}</div>}
	            </div>
	          )}
	        </div>

        {/* ── 删除确认弹框 ── */}
        {deleteConfirm && (
          <div style={dlg.overlay}>
            <div style={dlg.box}>
              <div style={dlg.title}>{t('products.deleteConfirmTitle')}</div>
              {deleteConfirm.type === 'single' && (
                <div style={dlg.body}>{deleteConfirm.name}</div>
              )}
              {deleteConfirm.type === 'batch' && (
                <div style={dlg.body}>{fmt('products.deleteProductCount', { count: deleteConfirm.ids.length })}</div>
              )}
              <div style={dlg.hint}>{t('products.deleteConfirmHint')}</div>
              <div style={dlg.actions}>
                <button style={dlg.cancelBtn} onClick={() => setDeleteConfirm(null)} disabled={deleting}>
                  {t('products.deleteBack')}
                </button>
                <button style={dlg.confirmBtn} onClick={executeDelete} disabled={deleting}>
                  {deleting ? t('products.deleting') : t('products.deleteConfirmBtn')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 成功反馈 ── */}
        {mode === 'saved' && product && (
          <div style={s.savedCard}>
            <div style={s.savedCheck}>✓</div>
            <div style={s.savedTitle}>{t('products.saved')}</div>
            <div style={s.savedName}>{product.name}{product.spec ? ` · ${product.spec}` : ''}</div>
            <div style={s.savedPrice}>${product.sellPrice.toFixed(2)}</div>
            <div style={{
              ...s.savedBadge,
              background: product.status === 'ACTIVE' ? 'rgba(255,255,255,0.2)' : 'rgba(255,100,100,0.3)',
            }}>
              {product.status === 'ACTIVE' ? t('products.statusActiveBadge') : t('products.statusDisabledBadge')}
            </div>
            <button style={s.nextBtn} onClick={reset}>{t('products.continueBtn')}</button>
          </div>
        )}

        {mode !== 'saved' && (
          <>
            {/* ── 商品已存在：编辑表单 ── */}
            {mode === 'found' && product && (
              <div style={s.card}>
                <div style={s.sectionLabel}>{t('products.editSection')}</div>

                {/* 商品主图管理 */}
                <div style={img.section}>
                  <div style={img.title}>{t('products.imageManageTitle')}</div>
                  <input
                    ref={imageFileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleImageUpload(file, Number(imageFileRef.current?.dataset.slot ?? '0'))
                    }}
                  />
                  <div style={img.galleryGrid}>
                    {[0, 1, 2].map((slot) => {
                      const url = productImages(product)[slot]
                      return (
                        <div key={slot} style={img.gallerySlot}>
                          <div style={img.slotLabel}>{slot === 0 ? t('products.mainImage') : fmt('products.imageSlot', { index: slot + 1 })}</div>
                          {url ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt={product.name} loading="lazy" decoding="async" style={img.slotImg} />
                              <div style={img.slotActions}>
                                <button
                                  type="button"
                                  style={img.slotBtn}
                                  disabled={imageUploading}
                                  onClick={() => {
                                    if (imageFileRef.current) imageFileRef.current.dataset.slot = String(slot)
                                    imageFileRef.current?.click()
                                  }}
                                >
                                  {t('products.imageReplace')}
                                </button>
                                <button
                                  type="button"
                                  style={{ ...img.slotBtn, ...img.slotBtnDanger }}
                                  disabled={imageUploading}
                                  onClick={() => handleImageDelete(slot)}
                                >
                                  {t('products.imageDelete')}
                                </button>
                              </div>
                            </>
                          ) : (
                            <button
                              type="button"
                              style={img.addSlotBtn}
                              disabled={imageUploading}
                              onClick={() => {
                                if (imageFileRef.current) imageFileRef.current.dataset.slot = String(slot)
                                imageFileRef.current?.click()
                              }}
                            >
                              {t('products.uploadPlus')}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {imageError && <div style={img.err}>{imageError}</div>}
                </div>

                <div style={s.barcodeRow}>
                  <span style={s.barcodeLabel}>{t('products.barcodeLabel')}</span>
                  <span style={s.barcodeValue}>{product.barcode}</span>
                </div>

                <Field label={t('products.fieldName')}>
                  <input
                    ref={editNameRef}
                    style={s.field}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder={t('products.namePlaceholder')}
                  />
                </Field>

                <Field label={t('products.fieldSpec')}>
                  <input
                    style={s.field}
                    value={editSpec}
                    onChange={(e) => setEditSpec(e.target.value)}
                    placeholder={t('products.specPlaceholder')}
                  />
                </Field>

                <Field label={t('products.fieldPrice')}>
                  <input
                    style={s.field}
                    type="text"
                    inputMode="decimal"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="0.00"
                  />
                  <div style={s.priceAdjRow}>
                    {[
                      { label: t('products.clearFilter'), fn: () => setEditPrice('') },
                      { label: '-1',   fn: () => setEditPrice((v) => String(Math.max(0, parseFloat(v || '0') - 1))) },
                      { label: '-0.5', fn: () => setEditPrice((v) => String(Math.max(0, parseFloat(v || '0') - 0.5))) },
                      { label: '+0.5', fn: () => setEditPrice((v) => String(Math.max(0, parseFloat(v || '0') + 0.5))) },
                      { label: '+1',   fn: () => setEditPrice((v) => String(Math.max(0, parseFloat(v || '0') + 1))) },
                    ].map(({ label, fn }) => (
                      <button key={label} type="button" style={s.priceAdjBtn} onClick={fn}>
                        {label}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label={t('products.fieldCategory')}>
                  <CategorySelect
                    categories={categories}
                    value={editCategoryId}
                    onChange={setEditCategoryId}
                    noneLabel={t('products.noCategory')}
                  />
                </Field>

                <Field label={t('products.fieldStatus')}>
                  <div style={s.statusRow}>
                    {(['ACTIVE', 'DISABLED'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        style={{
                          ...s.statusBtn,
                          ...(editStatus === st ? (st === 'ACTIVE' ? s.statusActive : s.statusDisabled) : {}),
                        }}
                        onClick={() => setEditStatus(st)}
                      >
                        {st === 'ACTIVE' ? t('products.statusActiveBtn') : t('products.statusDisabledBtn')}
                      </button>
                    ))}
                  </div>
                </Field>

                <button style={s.saveBtn} onClick={handleSave}>{t('products.saveBtn')}</button>
                <button
                  style={s.dangerBtn}
                  onClick={() => setDeleteConfirm({ type: 'single', id: product.id, name: product.name })}
                >
                  {t('products.deleteBtn')}
                </button>
              </div>
            )}

            {/* ── 商品不存在：快速新增 ── */}
            {mode === 'not-found' && (
              <div style={s.card}>
                <div style={s.noticeRow}>
                    <span style={s.noticeIcon}>＋</span>
                  <div>
                    <div style={s.noticeTitle}>{t('products.notFoundTitle')}</div>
                    <div style={s.noticeSub}>
                      {newBarcode ? `${t('products.barcodeLabel')}：${newBarcode}` : t('products.barcodeAutoHint')}
                    </div>
                  </div>
                </div>

                <div style={{ ...img.section, ...img.createSection }}>
                  <div style={img.title}>{t('products.imageManageTitle')}</div>
                  <input
                    ref={createImageFileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleNewImageSelect(file)
                    }}
                  />
                  <div style={img.galleryGrid}>
                    {[0, 1, 2].map((slot) => {
                      const url = newImagePreviews[slot]
                      return (
                        <div key={slot} style={img.gallerySlot}>
                          <div style={img.slotLabel}>{slot === 0 ? t('products.mainImage') : fmt('products.imageSlot', { index: slot + 1 })}</div>
                          {url ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt={newName || t('products.imageTitle')} loading="lazy" decoding="async" style={img.slotImg} />
                              <button
                                type="button"
                                style={{ ...img.slotBtn, ...img.slotBtnDanger }}
                                disabled={creating}
                                onClick={() => removeNewImage(slot)}
                              >
                                {t('products.imageDelete')}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              style={img.addSlotBtn}
                              disabled={creating || newImagePreviews.length >= 3}
                              onClick={() => createImageFileRef.current?.click()}
                            >
                              {t('products.uploadPlus')}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {newImageError && <div style={img.err}>{newImageError}</div>}
                </div>

                <Field label={t('products.barcodeLabel')}>
                  <input
                    style={s.field}
                    value={newBarcode}
                    onChange={(e) => setNewBarcode(e.target.value)}
                    placeholder={t('products.barcodePlaceholder')}
                  />
                </Field>

                <Field label={t('products.fieldName')}>
                  <input
                    style={s.field}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={t('products.namePlaceholder')}
                    autoFocus
                  />
                </Field>

                <Field label={t('products.fieldSpec')}>
                  <input
                    style={s.field}
                    value={newSpec}
                    onChange={(e) => setNewSpec(e.target.value)}
                    placeholder={t('products.specPlaceholder')}
                  />
                </Field>

                <Field label={t('products.fieldPrice')}>
                  <input
                    style={s.field}
                    type="text"
                    inputMode="decimal"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="0.00"
                  />
                </Field>

                <Field label={t('products.fieldCategory')}>
                  <CategorySelect
                    categories={categories}
                    value={newCategoryId}
                    onChange={setNewCategoryId}
                    noneLabel={t('products.noCategory')}
                  />
                </Field>

                <button
                  style={{ ...s.saveBtn, opacity: creating ? 0.65 : 1 }}
                  disabled={creating}
                  onClick={handleCreate}
                >
                  {creating ? t('products.saving') : t('products.createBtn')}
                </button>
              </div>
            )}

            {/* 空状态 */}
            {mode === 'idle' && (
              <div style={s.empty}>
                <div style={s.emptyIcon}>⊡</div>
                <div style={s.emptyTitle}>{t('products.emptyTitle')}</div>
                <div style={s.emptySub}>{t('products.emptySub')}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={f.wrap}>
      <div style={f.label}>{label}</div>
      {children}
    </div>
  )
}

const f: Record<string, React.CSSProperties> = {
  wrap: { marginBottom: 12 },
  label: { fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 6 },
}

// ─── 分类来源标签 ─────────────────────────────────────────────────────────────

function CatSourceBadge({ source }: { source: 'MANUAL' | 'AUTO' | 'NONE' }) {
  const { t } = useLocale()
  if (source === 'MANUAL') return <span style={badge.manual}>{t('products.catSourceManual')}</span>
  if (source === 'AUTO')   return <span style={badge.auto}>{t('products.catSourceAuto')}</span>
  return <span style={badge.none}>{t('products.catSourceNone')}</span>
}

const badge: Record<string, React.CSSProperties> = {
  manual: { fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#e6f4ff', color: '#1677ff', fontWeight: 700 },
  auto:   { fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#fff7e6', color: '#fa8c16', fontWeight: 700 },
  none:   { fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#f5f5f5', color: '#999',    fontWeight: 600 },
}

// ─── CategorySelect ───────────────────────────────────────────────────────────
// 扁平 select，L1 直接显示，L2 用"└ "前缀缩进，视觉清晰。

function CategorySelect({
  categories, value, onChange, noneLabel,
}: {
  categories: Category[]
  value: string
  onChange: (v: string) => void
  noneLabel: string
}) {
  const { t } = useLocale()
  const l1 = categories.filter((c) => !c.parentId)
  const l2ByParent = new Map<string, Category[]>()
  categories.filter((c) => c.parentId).forEach((c) => {
    const arr = l2ByParent.get(c.parentId!) ?? []
    arr.push(c)
    l2ByParent.set(c.parentId!, arr)
  })
  // Orphan L2 (parent removed) shown at bottom
  const knownL1Ids = new Set(l1.map((c) => c.id))
  const orphans = categories.filter((c) => c.parentId && !knownL1Ids.has(c.parentId))

  return (
    <select
      style={cs.catSelectField}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{noneLabel}</option>
      {l1.map((cat) => (
        <optgroup key={cat.id} label={cat.name}>
          <option value={cat.id}>{cat.name}{t('products.catParentSuffix')}</option>
          {(l2ByParent.get(cat.id) ?? []).map((sub) => (
            <option key={sub.id} value={sub.id}>└ {sub.name}</option>
          ))}
        </optgroup>
      ))}
      {orphans.map((c) => (
        <option key={c.id} value={c.id}>└ {c.name}</option>
      ))}
    </select>
  )
}

const cs: Record<string, React.CSSProperties> = {
  catSelectField: {
    display: 'block', width: '100%', height: 44,
    border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)',
    padding: '0 12px', fontSize: 15, outline: 'none',
    background: '#f7f8fa', boxSizing: 'border-box',
    color: 'var(--text)',
  },
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
  },
  headerBar: {
    background: 'var(--blue)',
    padding: '16px 16px 18px',
    display: 'flex',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: '0.02em',
  },
  body: {
    flex: 1,
    padding: '12px 12px 80px',
    maxWidth: 480,
    margin: '0 auto',
    width: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  centerIntro: {
    order: 0,
    margin: '2px 2px 10px',
  },
  centerSubtitle: {
    fontSize: 13,
    lineHeight: 1.45,
    color: 'var(--muted)',
  },
  statsGrid: {
    order: 0,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1fr',
    gap: 8,
    marginBottom: 10,
  },
  statCard: {
    minWidth: 0,
    background: '#fff',
    border: '1px solid rgba(15, 23, 42, 0.06)',
    borderRadius: 16,
    padding: '10px 6px',
    textAlign: 'center' as const,
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)',
  },
  statValue: {
    fontSize: 18,
    lineHeight: 1.1,
    fontWeight: 800,
    color: 'var(--text)',
    letterSpacing: '-0.01em',
  },
  statLabel: {
    marginTop: 4,
    fontSize: 10,
    lineHeight: 1.2,
    color: 'var(--muted)',
    fontWeight: 700,
  },
  aiHeroCard: {
    order: 0,
    position: 'relative' as const,
    overflow: 'hidden',
    borderRadius: 24,
    padding: 18,
    marginBottom: 10,
    background: 'linear-gradient(135deg, #101828 0%, #155eef 54%, #38bdf8 100%)',
    color: '#fff',
    boxShadow: '0 18px 42px rgba(21, 94, 239, 0.22)',
  },
  aiHeroGlow: {
    position: 'absolute' as const,
    right: -36,
    top: -44,
    width: 140,
    height: 140,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.22)',
  },
  aiHeroContent: {
    position: 'relative' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  aiHeroEyebrow: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    padding: '4px 9px',
    background: 'rgba(255,255,255,0.16)',
    border: '1px solid rgba(255,255,255,0.22)',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.04em',
  },
  aiHeroTitle: {
    fontSize: 24,
    lineHeight: 1.12,
    fontWeight: 900,
    letterSpacing: '-0.02em',
  },
  aiHeroSubtitle: {
    maxWidth: 330,
    fontSize: 14,
    lineHeight: 1.45,
    color: 'rgba(255,255,255,0.84)',
  },
  aiHeroTags: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  aiHeroTag: {
    borderRadius: 999,
    padding: '5px 9px',
    background: 'rgba(255,255,255,0.14)',
    color: '#fff',
    fontSize: 11,
    fontWeight: 800,
  },
  aiHeroBtn: {
    height: 46,
    marginTop: 2,
    border: 'none',
    borderRadius: 14,
    background: '#fff',
    color: '#0f172a',
    fontSize: 15,
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: '0 10px 24px rgba(15,23,42,0.2)',
  },
  quickEntryGrid: {
    order: 0,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    marginBottom: 10,
  },
  secondaryEntryBtn: {
    minHeight: 48,
    border: '1px solid rgba(15, 23, 42, 0.08)',
    borderRadius: 16,
    background: '#fff',
    color: 'var(--text)',
    fontSize: 14,
    fontWeight: 850,
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)',
  },
  searchCard: {
    order: 0,
    background: '#fff',
    border: '1px solid rgba(15, 23, 42, 0.06)',
    borderRadius: 18,
    padding: 10,
    marginBottom: 10,
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)',
  },
  searchInputWrap: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 42px 42px',
    gap: 6,
    alignItems: 'center',
  },
  searchInput: {
    width: '100%',
    height: 42,
    minWidth: 0,
    border: 'none',
    borderRadius: 12,
    padding: '0 11px',
    fontSize: 15,
    outline: 'none',
    background: '#f7f8fa',
    color: 'var(--text)',
    boxSizing: 'border-box' as const,
  },
  searchIconBtn: {
    width: 42,
    height: 42,
    border: 'none',
    borderRadius: 12,
    background: '#eef4ff',
    color: 'var(--blue)',
    fontSize: 19,
    fontWeight: 900,
    cursor: 'pointer',
  },
  scanIconBtn: {
    width: 42,
    height: 42,
    border: 'none',
    borderRadius: 12,
    background: 'var(--blue)',
    color: '#fff',
    fontSize: 22,
    fontWeight: 900,
    cursor: 'pointer',
  },
  card: {
    order: 1,
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '14px 16px',
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 12,
    color: 'var(--muted)',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    marginBottom: 14,
  },
  scanBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    height: 48,
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 12,
  },
  scanIcon: { fontSize: 22 },
  entryRow: { display: 'flex', gap: 8, marginBottom: 12 },
  manualNewBtn: {
    flex: 1,
    height: 48,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    background: '#fff',
    color: 'var(--blue)',
    border: '1.5px solid var(--blue)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  plusIcon: { fontSize: 22, fontWeight: 700, lineHeight: 1 },
  orRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  orLine: { flex: 1, height: 1, background: 'var(--border)' },
  orText: { fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' as const },
  inputRow: { display: 'flex', gap: 8 },
  input: {
    flex: 1,
    height: 44,
    minWidth: 0,
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 12px',
    fontSize: 16,
    outline: 'none',
    background: '#f7f8fa',
  },
  queryBtn: {
    flexShrink: 0,
    height: 44,
    padding: '0 18px',
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 15,
    fontWeight: 600,
  },
  field: {
    display: 'block',
    width: '100%',
    height: 44,
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 12px',
    fontSize: 15,
    outline: 'none',
    background: '#f7f8fa',
    boxSizing: 'border-box' as const,
  },
  priceAdjRow: {
    display: 'flex',
    gap: 6,
    marginTop: 6,
  },
  priceAdjBtn: {
    flex: 1,
    height: 34,
    fontSize: 13,
    fontWeight: 600,
    background: '#f0f5ff',
    border: '1.5px solid #91caff',
    borderRadius: 6,
    color: 'var(--blue)',
    cursor: 'pointer',
  },
  barcodeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    padding: '8px 12px',
    background: '#f7f8fa',
    borderRadius: 'var(--radius-sm)',
  },
  barcodeLabel: { fontSize: 12, color: 'var(--muted)' },
  barcodeValue: { fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)' },
  statusRow: { display: 'flex', gap: 8 },
  statusBtn: {
    flex: 1,
    height: 40,
    border: '1.5px solid var(--border)',
    borderRadius: 20,
    background: '#f7f8fa',
    fontSize: 14,
    color: 'var(--muted)',
    fontWeight: 500,
  },
  statusActive: {
    background: '#e8f5e9',
    borderColor: '#4caf50',
    color: '#2e7d32',
    fontWeight: 700,
  },
  statusDisabled: {
    background: '#fff0f0',
    borderColor: '#e57373',
    color: '#c62828',
    fontWeight: 700,
  },
  saveBtn: {
    display: 'block',
    width: '100%',
    height: 48,
    marginTop: 4,
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 16,
    fontWeight: 700,
  },
  dangerBtn: {
    display: 'block',
    width: '100%',
    height: 40,
    marginTop: 8,
    background: 'none',
    color: 'var(--red)',
    border: '1.5px solid var(--red)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 14,
    fontWeight: 600,
  },
  noticeRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
    padding: '10px 12px',
    background: '#fffbe6',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid #ffe58f',
  },
  noticeIcon: { fontSize: 22, color: '#fa8c16', flexShrink: 0, lineHeight: 1.3 },
  noticeTitle: { fontSize: 14, fontWeight: 600, color: '#7c4a00', marginBottom: 2 },
  noticeSub: { fontSize: 12, color: '#ad6800', fontFamily: 'monospace' },
  errorMsg: {
    fontSize: 13,
    color: 'var(--red)',
    padding: '0 2px 8px',
  },
  successMsg: {
    fontSize: 13,
    color: '#15803d',
    padding: '0 2px 8px',
  },
  marketingImageRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  marketingImageInput: {
    height: 38,
    marginBottom: 0,
    minWidth: 0,
  },
  marketingUploadBtn: {
    height: 38,
    minWidth: 76,
    padding: '0 10px',
    whiteSpace: 'nowrap',
  },
  scanHintMsg: {
    fontSize: 12, color: '#fa8c16', background: '#fff7e6',
    border: '1px solid #ffd591', borderRadius: 6, padding: '6px 10px', marginBottom: 8,
  },
  hidOkMsg: { fontSize: 13, color: '#389e0d', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, padding: '6px 10px', marginBottom: 8 },
  hidFailMsg: { fontSize: 13, color: '#cf1322', background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 6, padding: '6px 10px', marginBottom: 8 },
  // ── Saved / Success ──
  savedCard: {
    background: 'var(--blue)',
    borderRadius: 'var(--radius)',
    padding: '28px 20px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  savedCheck: {
    width: 52,
    height: 52,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 26,
    color: '#fff',
    marginBottom: 4,
  },
  savedTitle: { fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 4 },
  savedName: { fontSize: 18, fontWeight: 700, color: '#fff' },
  savedPrice: { fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' },
  savedBadge: {
    fontSize: 13,
    color: '#fff',
    padding: '4px 14px',
    borderRadius: 20,
    marginTop: 4,
  },
  nextBtn: {
    marginTop: 12,
    height: 44,
    padding: '0 28px',
    background: 'rgba(255,255,255,0.2)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 15,
    fontWeight: 600,
  },
  // ── Import ──
  importSection: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    marginBottom: 10,
    overflow: 'hidden',
  },
  importToggle: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '13px 16px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  },
  importToggleText: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text)',
  },
  importToggleArrow: {
    fontSize: 10,
    color: 'var(--muted)',
  },
  importBody: {
    padding: '0 16px 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    borderTop: '1px solid var(--border)',
  },
  templateBtn: {
    height: 40,
    background: '#f0f5ff',
    border: '1.5px solid #91caff',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--blue)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 12,
  },
  uploadRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  fileInput: {
    flex: 1,
    fontSize: 13,
    color: 'var(--text)',
    minWidth: 0,
  },
  hiddenFileInput: {
    display: 'none',
  },
  aiUploadStack: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  aiUploadCard: {
    minHeight: 116,
    border: '1.5px dashed #b7cffd',
    borderRadius: 22,
    background: 'linear-gradient(180deg, #fbfdff 0%, #f4f8ff 100%)',
    color: 'var(--text)',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '18px 16px',
    cursor: 'pointer',
    textAlign: 'center' as const,
  },
  aiUploadIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#eaf2ff',
    fontSize: 22,
  },
  aiUploadTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: 'var(--text)',
  },
  aiUploadSubtitle: {
    fontSize: 12,
    color: 'var(--muted)',
  },
  aiSelectedFile: {
    borderRadius: 14,
    background: '#f6f7f9',
    padding: '10px 12px',
    fontSize: 13,
    color: 'var(--text)',
    lineHeight: 1.45,
    wordBreak: 'break-all' as const,
  },
  aiRecognizeBtn: {
    minHeight: 52,
    padding: '0 18px',
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 18,
    fontSize: 15,
    fontWeight: 800,
    whiteSpace: 'nowrap' as const,
  },
  aiRecognizingBox: {
    padding: '20px 0',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 12,
  },
  aiRecognizingSpinner: {
    width: 34,
    height: 34,
    borderRadius: '50%',
    background: '#eaf2ff',
    color: 'var(--blue)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
  },
  aiDraftStack: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    paddingTop: 12,
  },
  aiDraftNotice: {
    borderRadius: 18,
    background: '#f6f8fb',
    padding: '14px 16px',
  },
  aiDraftNoticeTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: 'var(--text)',
  },
  aiDraftNoticeSub: {
    marginTop: 4,
    fontSize: 13,
    color: 'var(--muted)',
    lineHeight: 1.5,
  },
  aiDraftCard: {
    borderRadius: 22,
    background: '#fff',
    border: '1px solid var(--border)',
    padding: 14,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  aiDraftImageWrap: {
    width: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    background: '#f3f4f6',
    border: '1px solid var(--border)',
  },
  aiDraftImage: {
    display: 'block',
    width: '100%',
    maxHeight: 220,
    objectFit: 'contain' as const,
    background: '#fff',
  },
  aiDraftWarning: {
    borderRadius: 14,
    background: '#fff7e6',
    color: '#8a5a00',
    padding: '10px 12px',
    fontSize: 13,
    lineHeight: 1.45,
  },
  aiDraftStatusLine: {
    borderRadius: 14,
    background: '#f6f7f9',
    color: 'var(--muted)',
    padding: '10px 12px',
    fontSize: 13,
  },
  aiMatchedCard: {
    borderRadius: 20,
    background: '#fff',
    border: '1px solid var(--border)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  aiMatchedMain: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  },
  aiMatchedImg: {
    width: 64,
    height: 64,
    borderRadius: 14,
    objectFit: 'cover' as const,
    background: '#f3f4f6',
  },
  aiMatchedPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 14,
    background: '#eef1f5',
    color: 'var(--muted)',
    fontSize: 11,
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiMatchedName: {
    fontSize: 15,
    fontWeight: 800,
    color: 'var(--text)',
    lineHeight: 1.35,
  },
  aiMatchedMeta: {
    marginTop: 3,
    fontSize: 13,
    color: 'var(--muted)',
  },
  aiMatchedReason: {
    marginTop: 6,
    fontSize: 12,
    color: 'var(--blue)',
    fontWeight: 700,
  },
  aiSmallPrimaryBtn: {
    minHeight: 44,
    borderRadius: 16,
    border: 'none',
    background: 'var(--blue)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 800,
  },
  aiSecondaryBtn: {
    minHeight: 44,
    borderRadius: 16,
    border: '1px solid var(--border)',
    background: '#fff',
    color: 'var(--text)',
    fontSize: 14,
    fontWeight: 700,
  },
  importBtn: {
    flexShrink: 0,
    height: 40,
    padding: '0 16px',
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 14,
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
  },
  importErrorMsg: {
    fontSize: 13,
    color: 'var(--red)',
  },
  importResult: {
    background: '#f8f8f8',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  importResultSummary: {
    display: 'flex',
    gap: 16,
    alignItems: 'center',
    fontSize: 14,
    fontWeight: 700,
  },
  importOk: {
    color: '#52c41a',
  },
  importFail: {
    color: 'var(--red)',
  },
  importErrorList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    maxHeight: 200,
    overflowY: 'auto' as const,
    borderTop: '1px solid var(--border)',
    paddingTop: 8,
  },
  importErrorRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
    fontSize: 12,
  },
  importErrorRowNum: {
    flexShrink: 0,
    color: 'var(--muted)',
    minWidth: 44,
  },
  importErrorBarcode: {
    flexShrink: 0,
    fontFamily: 'monospace',
    color: 'var(--text)',
    minWidth: 80,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  importErrorReason: {
    color: 'var(--red)',
    flex: 1,
  },
  // ── Category management ──
  catList: {
    borderBottom: '1px solid var(--border)',
    paddingBottom: 10,
    marginBottom: 10,
  },
  catL1Row: {
    fontSize: 13, fontWeight: 700, color: 'var(--text)',
    padding: '4px 0',
  },
  catL2Row: {
    fontSize: 13, color: 'var(--muted)',
    padding: '2px 0 2px 12px',
  },
  catAddRow: {
    display: 'flex', gap: 8, alignItems: 'center',
  },
  catParentSelect: {
    flexShrink: 0,
    height: 40,
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 8px',
    fontSize: 13,
    background: '#f7f8fa',
    color: 'var(--text)',
    maxWidth: 130,
  },
  // ── Empty ──
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '40px 20px',
    gap: 8,
  },
  emptyIcon: { fontSize: 48, color: '#d0d0d0', lineHeight: 1, marginBottom: 4 },
  emptyTitle: { fontSize: 15, fontWeight: 600, color: '#bbb' },
  emptySub: { fontSize: 13, color: '#ccc' },
}

// ─── 导入预览表格样式 ─────────────────────────────────────────────────────────

const pr: Record<string, React.CSSProperties> = {
  summary: {
    fontSize: 13,
    color: 'var(--muted)',
    padding: '4px 0 6px',
  },
  scroll: {
    overflowX: 'auto' as const,
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    maxHeight: 320,
    overflowY: 'auto' as const,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 12,
    whiteSpace: 'nowrap' as const,
  },
  th: {
    background: '#f5f5f5',
    fontWeight: 700,
    color: 'var(--muted)',
    padding: '8px 10px',
    textAlign: 'left' as const,
    borderBottom: '1px solid var(--border)',
    position: 'sticky' as const,
    top: 0,
  },
  td: {
    padding: '7px 10px',
    borderBottom: '1px solid var(--border)',
    color: 'var(--text)',
    verticalAlign: 'top' as const,
  },
  errRow: {
    background: '#fff5f5',
  },
  actions: {
    display: 'flex',
    gap: 8,
    marginTop: 4,
  },
}

// ─── 商品主图管理样式 ─────────────────────────────────────────────────────────

const img: Record<string, React.CSSProperties> = {
  section: {
    marginBottom: 14,
    padding: '12px 12px',
    background: '#f7f8fa',
    borderRadius: 'var(--radius-sm)',
  },
  createSection: {
    background: '#f0f7ff',
    border: '1.5px solid #91caff',
  },
  title: {
    fontSize: 12,
    color: 'var(--muted)',
    fontWeight: 600,
    marginBottom: 8,
  },
  previewWrap: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  preview: {
    width: '100%',
    maxHeight: 200,
    objectFit: 'contain' as const,
    background: '#fff',
    borderRadius: 6,
    border: '1px solid var(--border)',
  },
  galleryGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: 8,
  },
  gallerySlot: {
    minWidth: 0,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: '#fff',
    padding: 6,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  slotLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--muted)',
  },
  slotImg: {
    width: '100%',
    aspectRatio: '1 / 1',
    objectFit: 'cover' as const,
    borderRadius: 6,
    background: '#f7f8fa',
  },
  slotActions: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 4,
  },
  slotBtn: {
    minWidth: 0,
    height: 28,
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: '#fff',
    color: 'var(--text)',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
  },
  slotBtnDanger: {
    color: 'var(--red)',
    borderColor: '#ffa39e',
  },
  addSlotBtn: {
    width: '100%',
    aspectRatio: '1 / 1',
    border: '1.5px dashed #91caff',
    borderRadius: 8,
    background: '#f0f7ff',
    color: 'var(--blue)',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  },
  btnRow: { display: 'flex', gap: 8 },
  btn: {
    flex: 1,
    height: 36,
    fontSize: 13,
    fontWeight: 600,
    background: '#fff',
    border: '1.5px solid var(--border)',
    borderRadius: 6,
    cursor: 'pointer',
    color: 'var(--text)',
  },
  btnDanger: {
    color: 'var(--red)',
    borderColor: '#ffa39e',
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 4px',
  },
  createEmpty: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'stretch',
    gap: 8,
    padding: '4px 0',
  },
  createBtn: {
    width: '100%',
    height: 42,
    background: 'var(--blue)',
    borderColor: 'var(--blue)',
    color: '#fff',
    fontSize: 14,
  },
  emptyText: { fontSize: 13, color: 'var(--muted)' },
  err: { fontSize: 12, color: 'var(--red)', marginTop: 6 },
}

// ─── AI 识别表格单元样式 ──────────────────────────────────────────────────────

const ai: Record<string, React.CSSProperties> = {
  cellInput: {
    width: '100%',
    height: 28,
    fontSize: 12,
    padding: '0 6px',
    border: '1px solid var(--border)',
    borderRadius: 4,
    background: '#fff',
    color: 'var(--text)',
    boxSizing: 'border-box' as const,
    outline: 'none',
  },
  warnText: {
    fontSize: 10,
    color: '#fa8c16',
    marginTop: 2,
    whiteSpace: 'normal' as const,
  },
  delBtn: {
    width: 24,
    height: 24,
    background: 'none',
    border: '1px solid #d9d9d9',
    borderRadius: 4,
    color: '#999',
    fontSize: 16,
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
  },
}

// ─── Product list row styles ──────────────────────────────────────────────────

const ls: Record<string, React.CSSProperties> = {
  filterRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 120px auto',
    gap: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  searchInput: {
    minWidth: 0,
    height: 36,
    border: '1.5px solid var(--border)',
    borderRadius: 8,
    padding: '0 10px',
    fontSize: 13,
    outline: 'none',
    background: '#fff',
    color: 'var(--text)',
  },
  categoryFilter: {
    minWidth: 0,
    height: 36,
    border: '1.5px solid var(--border)',
    borderRadius: 8,
    padding: '0 8px',
    fontSize: 12,
    outline: 'none',
    background: '#fff',
    color: 'var(--text)',
  },
  resetFilterBtn: {
    height: 36,
    border: '1px solid #d9d9d9',
    borderRadius: 8,
    background: '#f7f8fa',
    color: 'var(--muted)',
    fontSize: 12,
    padding: '0 10px',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
    borderBottom: '1px solid var(--border)',
    marginBottom: 4,
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
  },
  checkbox: {
    width: 16,
    height: 16,
    flexShrink: 0,
    cursor: 'pointer',
  },
  selectAllText: {
    fontSize: 13,
    color: 'var(--muted)',
    fontWeight: 600,
  },
  batchDeleteBtn: {
    height: 32,
    padding: '0 12px',
    background: 'none',
    border: '1.5px solid var(--red)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--red)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  rowWrap: {
    borderBottom: '1px solid var(--border)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 0',
  },
  chevronBtn: {
    flexShrink: 0,
    width: 30,
    height: 30,
    padding: 0,
    background: 'none',
    border: 'none',
    color: 'var(--muted)',
    fontSize: 14,
    cursor: 'pointer',
  },
  imgTag: {
    fontSize: 11,
    color: '#52c41a',
    fontFamily: 'inherit',
  },
  expandedPanel: {
    padding: '4px 0 12px 24px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  imgRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },
  imgPreview: {
    width: 56,
    height: 56,
    objectFit: 'cover' as const,
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: '#f5f5f5',
    flexShrink: 0,
  },
  imgEmpty: {
    width: 56,
    height: 56,
    borderRadius: 6,
    border: '1px dashed var(--border)',
    background: '#fafafa',
    color: 'var(--muted)',
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  imgBtns: { display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' as const },
  imgBtn: {
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 12px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: '#fff',
    color: 'var(--text)',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  imgBtnDanger: { color: 'var(--red)', borderColor: '#ffa39e' },
  imgErr: { fontSize: 12, color: 'var(--red)' },
  actionRow: { display: 'flex', gap: 8 },
  actionBtn: {
    flex: 1,
    height: 34,
    fontSize: 13,
    fontWeight: 600,
    background: '#fff',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text)',
    cursor: 'pointer',
  },
  actionBtnDanger: {
    color: 'var(--red)',
    borderColor: 'var(--red)',
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  rowName: {
    fontSize: 14,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  rowMeta: {
    fontSize: 12,
    color: 'var(--muted)',
    fontFamily: 'monospace',
  },
  disabledTag: {
    fontSize: 11,
    color: 'var(--red)',
    fontFamily: 'inherit',
  },
  deleteRowBtn: {
    flexShrink: 0,
    height: 30,
    padding: '0 10px',
    background: 'none',
    border: '1px solid var(--red)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--red)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
}

// ─── Delete confirm dialog styles ────────────────────────────────────────────

const dlg: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 800,
    padding: '0 24px',
  },
  box: {
    background: '#fff',
    borderRadius: 'var(--radius)',
    padding: '24px 20px 20px',
    width: '100%',
    maxWidth: 360,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: 700,
    color: 'var(--text)',
  },
  body: {
    fontSize: 15,
    color: 'var(--text)',
    fontWeight: 600,
    wordBreak: 'break-all' as const,
  },
  hint: {
    fontSize: 13,
    color: 'var(--muted)',
    marginBottom: 4,
  },
  actions: {
    display: 'flex',
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    background: '#f5f5f5',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text)',
    cursor: 'pointer',
  },
  confirmBtn: {
    flex: 1,
    height: 44,
    background: 'var(--red)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 15,
    fontWeight: 700,
    color: '#fff',
    cursor: 'pointer',
  },
}
