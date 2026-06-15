import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { recognizeSingleProduct, type AiProductFeature } from '@/lib/ai-photo-product-recognize'

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 2 * 1024 * 1024
const PRODUCT_PRE_LIMIT = 500
const MATCH_THRESHOLD = 0.55
const TOPN = 5

type MatchedProduct = {
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

type DraftProduct = {
  name: string
  brand: string | null
  spec: string | null
  categoryName: string | null
  categoryId: string | null
  categorySuggestion: string | null
  sku: string | null
  barcode: string | null
  imageUrl: null
  confidence: number
  warning: string
}

type ProductRow = {
  id: string
  barcode: string
  name: string
  spec: string | null
  sellPrice: { toNumber(): number }
  status: 'ACTIVE' | 'DISABLED'
  imageUrl: string | null
  categoryId: string | null
  nameZh: string | null
  nameEn: string | null
  nameKm: string | null
}

type CategoryRow = {
  id: string
  name: string
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以使用 AI 建档' }, { status: 403 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'INVALID_FORM', message: '图片参数无效' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'MISSING_IMAGE', message: '请先上传商品图片' }, { status: 400 })
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: 'INVALID_MIME', message: '仅支持 JPG / PNG / WebP 图片' }, { status: 400 })
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'INVALID_IMAGE', message: '图片无效或过大，请换一张更清晰的商品图' }, { status: 400 })
  }

  const imageBase64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  let feature: AiProductFeature
  try {
    feature = await recognizeSingleProduct(imageBase64, file.type)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'AI_FAILED'
    if (msg === 'AI_NOT_CONFIGURED') {
      return NextResponse.json({ error: 'AI_NOT_CONFIGURED', message: 'AI 识别暂未配置，请稍后再试' }, { status: 200 })
    }
    if (msg === 'AI_TIMEOUT') {
      return NextResponse.json({ error: 'AI_TIMEOUT', message: 'AI 识别超时，请换一张更清晰的图片重试' }, { status: 200 })
    }
    return NextResponse.json({ error: 'AI_FAILED', message: 'AI 识别失败，请换一张商品正面图重试' }, { status: 200 })
  }

  if (!feature || (!feature.name && !feature.brand && !feature.barcode && !feature.packageText)) {
    return NextResponse.json({ error: 'AI_EMPTY', message: '未识别到清晰商品，请拍商品正面', matchedProducts: [], draft: null }, { status: 200 })
  }

  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId: ctx.tenantId },
      select: {
        id: true,
        barcode: true,
        name: true,
        spec: true,
        sellPrice: true,
        status: true,
        imageUrl: true,
        categoryId: true,
        nameZh: true,
        nameEn: true,
        nameKm: true,
      },
      take: PRODUCT_PRE_LIMIT,
    }),
    prisma.productCategory.findMany({
      where: { tenantId: ctx.tenantId },
      select: { id: true, name: true },
      take: 200,
    }),
  ])

  const candidates = scoreCandidates(feature, products).slice(0, TOPN)
  const matchedProducts = candidates.filter((c) => c.confidence >= MATCH_THRESHOLD)
  const category = resolveCategory(feature.category, categories)
  const draft = buildDraft(feature, category)

  return NextResponse.json({
    matchedProducts,
    draft: matchedProducts.length > 0 ? null : draft,
    aiFeature: {
      name: feature.name,
      brand: feature.brand,
      spec: feature.spec,
      barcode: feature.barcode,
      category: feature.category,
      packageText: feature.packageText,
      confidence: feature.confidence,
    },
    needManualConfirm: true,
  })
}

function buildDraft(feature: AiProductFeature, category: CategoryRow | null): DraftProduct {
  const name = cleanText(feature.name) || cleanText(feature.packageText) || cleanText(feature.brand) || ''
  return {
    name,
    brand: cleanText(feature.brand) || null,
    spec: cleanText(feature.spec) || null,
    categoryName: category?.name ?? null,
    categoryId: category?.id ?? null,
    categorySuggestion: cleanText(feature.category) || null,
    sku: cleanText(feature.barcode) || null,
    barcode: cleanText(feature.barcode) || null,
    imageUrl: null,
    confidence: feature.confidence,
    warning: 'AI识别结果可能不准确，请确认后保存',
  }
}

function cleanText(s: string | null | undefined): string {
  return (s ?? '').trim()
}

function normalizeToken(s: string | null | undefined): string {
  return (s ?? '').toString().toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ' ').trim()
}

function tokenize(s: string | null | undefined): string[] {
  const n = normalizeToken(s)
  if (!n) return []
  const ascii = n.match(/[a-z0-9]+/gi) ?? []
  const cjk = n.replace(/[a-z0-9\s]+/gi, '')
  const cjkUnigrams = Array.from(cjk).filter((c) => c.trim())
  const cjkBigrams: string[] = []
  for (let i = 0; i + 1 < cjkUnigrams.length; i++) cjkBigrams.push(cjkUnigrams[i] + cjkUnigrams[i + 1])
  return [...ascii.map((s) => s.toLowerCase()), ...cjkUnigrams, ...cjkBigrams]
}

function overlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setB = new Set(b)
  let hit = 0
  for (const t of a) if (setB.has(t)) hit++
  return hit / a.length
}

function resolveCategory(categoryName: string | null, categories: CategoryRow[]): CategoryRow | null {
  const aiTokens = tokenize(categoryName)
  if (aiTokens.length === 0) return null
  let best: { category: CategoryRow; score: number } | null = null
  for (const c of categories) {
    const score = overlapRatio(aiTokens, tokenize(c.name))
    if (score > 0 && (!best || score > best.score)) best = { category: c, score }
  }
  return best?.score && best.score >= 0.5 ? best.category : null
}

function scoreCandidates(f: AiProductFeature, products: ProductRow[]): MatchedProduct[] {
  const aiNameTokens = tokenize(f.name)
  const aiBrandTokens = tokenize(f.brand)
  const aiPkgTokens = tokenize(f.packageText)
  const aiSpecTokens = tokenize(f.spec)
  const aiBarcode = (f.barcode ?? '').replace(/\D/g, '')

  const scored: MatchedProduct[] = []
  for (const p of products) {
    const reasons: string[] = []
    let score = 0

    if (aiBarcode && p.barcode && p.barcode.replace(/\D/g, '') === aiBarcode) {
      score += 0.85
      reasons.push('BARCODE_EXACT')
    }

    const nameTokens = [
      ...tokenize(p.name),
      ...tokenize(p.nameZh),
      ...tokenize(p.nameEn),
      ...tokenize(p.nameKm),
    ]
    const nameHit = overlapRatio(aiNameTokens, nameTokens)
    if (nameHit > 0) {
      score += nameHit * 0.55
      reasons.push(nameHit >= 0.5 ? 'NAME_MATCH' : 'NAME_PARTIAL')
    }

    if (aiBrandTokens.length > 0) {
      const brandHit = overlapRatio(aiBrandTokens, nameTokens)
      if (brandHit > 0) {
        score += brandHit * 0.25
        reasons.push('BRAND_MATCH')
      }
    }

    if (aiPkgTokens.length > 0) {
      const pkgHit = overlapRatio(aiPkgTokens, nameTokens)
      if (pkgHit > 0) {
        score += pkgHit * 0.2
        reasons.push('PACKAGE_TEXT_MATCH')
      }
    }

    if (aiSpecTokens.length > 0 && p.spec) {
      const specHit = overlapRatio(aiSpecTokens, tokenize(p.spec))
      if (specHit > 0) {
        score += specHit * 0.15
        reasons.push('SPEC_MATCH')
      }
    }

    if (score <= 0) continue
    const confidence = Math.max(0, Math.min(1, score * (0.5 + 0.5 * (f.confidence || 0.5))))
    scored.push({
      productId: p.id,
      name: p.name,
      spec: p.spec,
      price: p.sellPrice.toNumber(),
      imageUrl: p.imageUrl,
      categoryId: p.categoryId,
      status: p.status,
      confidence: +confidence.toFixed(3),
      reason: reasons,
    })
  }
  scored.sort((a, b) => b.confidence - a.confidence)
  return scored
}
