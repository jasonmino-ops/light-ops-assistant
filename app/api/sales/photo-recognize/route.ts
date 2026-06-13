/**
 * POST /api/sales/photo-recognize
 *
 * 销售拍照识别（Phase 2A，只读 API；前端 Phase 2B 才接）。
 *
 * 流程：
 *   1. 校验 body：imageBase64 + mime + (可选) source
 *   2. base64 解码 ≤ 1MB
 *   3. ctx = getContext(req) —— 拒绝匿名；tenantId/userId/storeId 由服务端决定
 *   4. 调 Anthropic 视觉模型（lib/ai-photo-product-recognize.ts，5s 超时）
 *   5. 在当前 tenant ACTIVE 商品库内做"AI 文本特征 → Product"打分匹配
 *   6. 返回最多 5 个候选 + needManualConfirm=true
 *   7. 任何 AI 失败 / 超时 / 空结果都返回 200 + candidates:[] + errorCode + fallbackMessage
 *   8. 全程写一条 OperationLog（actionType='AI_PHOTO_RECOGNIZE'）
 *
 * 安全契约（不可破坏）：
 *   - 不接受前端 tenantId / storeId / productId
 *   - 候选 productId 全部来自 prisma.product.findMany({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' } })
 *   - 路由不导入 prisma.saleRecord / paymentIntent / customerOrder；不写 Product
 *   - 不存图片到 Storage；imageBase64 仅在内存中流转
 *   - needManualConfirm 永远为 true
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { recognizeSingleProduct, type AiProductFeature } from '@/lib/ai-photo-product-recognize'

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 1024 * 1024              // 1MB（base64 解码后）
const MAX_BASE64_LEN = Math.ceil(MAX_BYTES * 4 / 3) + 64
const PRODUCT_PRE_LIMIT = 500              // 候选拼接的商品库扫描上限
const TOPN = 5
const AI_PROVIDER = 'anthropic'
const AI_MODEL = 'claude-haiku-4-5-20251001'

type Candidate = {
  productId: string
  name: string
  spec: string | null
  price: number
  imageUrl: string | null
  confidence: number
  reason: string[]
}

type ErrorCode = 'AI_NOT_CONFIGURED' | 'AI_TIMEOUT' | 'AI_EMPTY' | 'AI_FAILED' | 'INVALID_IMAGE'

type SuccessBody = {
  candidates: Candidate[]
  needManualConfirm: true
  errorCode?: ErrorCode
  fallbackMessage?: string
}

const FALLBACK_MSG = '识别失败，请使用扫码或手动选择商品'

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  // ── 1. 解析与校验 body ─────────────────────────────────────────────────────
  let body: { imageBase64?: unknown; mime?: unknown; source?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : ''
  const mime = typeof body.mime === 'string' ? body.mime.trim().toLowerCase() : ''
  const sourceRaw = typeof body.source === 'string' ? body.source.trim() : ''
  if (sourceRaw && sourceRaw !== 'sale_recognize_v1') {
    return NextResponse.json({ error: 'INVALID_SOURCE' }, { status: 400 })
  }
  if (!imageBase64) return NextResponse.json({ error: 'MISSING_IMAGE' }, { status: 400 })
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: 'INVALID_MIME' }, { status: 400 })
  }
  if (imageBase64.length > MAX_BASE64_LEN) {
    return respondLogged({
      ctx, startedAt, source: sourceRaw,
      candidates: [], errorCode: 'INVALID_IMAGE',
      imageSizeBytes: imageBase64.length, status: 'FAILED',
      message: 'IMAGE_TOO_LARGE',
    })
  }

  // 严校验 base64 + 字节大小
  let imageSizeBytes = 0
  try {
    const buf = Buffer.from(imageBase64, 'base64')
    imageSizeBytes = buf.length
    if (imageSizeBytes === 0) throw new Error('EMPTY')
    if (imageSizeBytes > MAX_BYTES) {
      return respondLogged({
        ctx, startedAt, source: sourceRaw,
        candidates: [], errorCode: 'INVALID_IMAGE',
        imageSizeBytes, status: 'FAILED',
        message: 'IMAGE_TOO_LARGE',
      })
    }
  } catch {
    return respondLogged({
      ctx, startedAt, source: sourceRaw,
      candidates: [], errorCode: 'INVALID_IMAGE',
      imageSizeBytes: 0, status: 'FAILED',
      message: 'BASE64_DECODE_FAIL',
    })
  }

  // ── 2. 调 AI；任何失败都返回 200 + errorCode（不抛 500） ─────────────────
  let feature: AiProductFeature | null = null
  let aiError: ErrorCode | null = null
  let aiErrorRaw: string | null = null
  try {
    feature = await recognizeSingleProduct(imageBase64, mime)
  } catch (e) {
    const m = e instanceof Error ? e.message : 'AI_FAILED'
    aiErrorRaw = m.slice(0, 200)
    if (m === 'AI_NOT_CONFIGURED') aiError = 'AI_NOT_CONFIGURED'
    else if (m === 'AI_TIMEOUT')   aiError = 'AI_TIMEOUT'
    else                            aiError = 'AI_FAILED'
  }

  if (aiError) {
    return respondLogged({
      ctx, startedAt, source: sourceRaw,
      candidates: [], errorCode: aiError,
      imageSizeBytes, status: 'FAILED',
      message: aiErrorRaw ?? aiError,
    })
  }

  // AI 返回空特征（图中无清晰商品 / 包含敏感物体 / confidence=0）
  if (!feature || (!feature.name && !feature.brand && !feature.barcode && !feature.packageText)) {
    return respondLogged({
      ctx, startedAt, source: sourceRaw,
      candidates: [], errorCode: 'AI_EMPTY',
      imageSizeBytes, status: 'SUCCESS',
      message: `confidence=${feature?.confidence ?? 0}`,
    })
  }

  // ── 3. 商品库匹配（严格 tenant 隔离） ─────────────────────────────────────
  const products = await prisma.product.findMany({
    where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
    select: {
      id: true, barcode: true, name: true, spec: true,
      sellPrice: true, imageUrl: true, categoryId: true,
      nameZh: true, nameEn: true, nameKm: true,
    },
    take: PRODUCT_PRE_LIMIT,
  })

  const candidates = scoreCandidates(feature, products).slice(0, TOPN)

  return respondLogged({
    ctx, startedAt, source: sourceRaw,
    candidates,
    imageSizeBytes, status: 'SUCCESS',
    message: `aiConf=${feature.confidence};hits=${candidates.length}`,
  })
}

// ─── 候选打分 ──────────────────────────────────────────────────────────────

type ProductRow = {
  id: string; barcode: string; name: string; spec: string | null
  sellPrice: { toNumber(): number }; imageUrl: string | null; categoryId: string | null
  nameZh: string | null; nameEn: string | null; nameKm: string | null
}

function normalizeToken(s: string | null | undefined): string {
  return (s ?? '').toString().toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ' ').trim()
}

function tokenize(s: string | null | undefined): string[] {
  const n = normalizeToken(s)
  if (!n) return []
  // 中英混排：英文按空格切；中文逐字+二元
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

function scoreCandidates(f: AiProductFeature, products: ProductRow[]): Candidate[] {
  const aiNameTokens    = tokenize(f.name)
  const aiBrandTokens   = tokenize(f.brand)
  const aiPkgTokens     = tokenize(f.packageText)
  const aiSpecTokens    = tokenize(f.spec)
  const aiBarcode       = (f.barcode ?? '').replace(/\D/g, '')

  const scored: Candidate[] = []
  for (const p of products) {
    const reasons: string[] = []
    let score = 0

    // 条码：精确命中权重最高
    if (aiBarcode && p.barcode && p.barcode.replace(/\D/g, '') === aiBarcode) {
      score += 0.85; reasons.push('BARCODE_EXACT')
    }

    // 名称（含多语言）
    const nameTokens = [
      ...tokenize(p.name),
      ...tokenize(p.nameZh),
      ...tokenize(p.nameEn),
      ...tokenize(p.nameKm),
    ]
    const nameHit = overlapRatio(aiNameTokens, nameTokens)
    if (nameHit > 0) {
      score += nameHit * 0.55
      if (nameHit >= 0.5) reasons.push('NAME_MATCH')
      else if (nameHit > 0) reasons.push('NAME_PARTIAL')
    }

    // 品牌嵌入名称
    if (aiBrandTokens.length > 0) {
      const brandHit = overlapRatio(aiBrandTokens, nameTokens)
      if (brandHit > 0) { score += brandHit * 0.25; reasons.push('BRAND_MATCH') }
    }

    // 包装文字落在名称里
    if (aiPkgTokens.length > 0) {
      const pkgHit = overlapRatio(aiPkgTokens, nameTokens)
      if (pkgHit > 0) { score += pkgHit * 0.20; reasons.push('PACKAGE_TEXT_MATCH') }
    }

    // 规格
    if (aiSpecTokens.length > 0 && p.spec) {
      const specHit = overlapRatio(aiSpecTokens, tokenize(p.spec))
      if (specHit > 0) { score += specHit * 0.15; reasons.push('SPEC_MATCH') }
    }

    if (score <= 0) continue
    const finalConfidence = Math.max(0, Math.min(1, score * (0.5 + 0.5 * (f.confidence || 0.5))))
    scored.push({
      productId: p.id,
      name: p.name,
      spec: p.spec,
      price: p.sellPrice.toNumber(),
      imageUrl: p.imageUrl,
      confidence: +finalConfidence.toFixed(3),
      reason: reasons,
    })
  }
  scored.sort((a, b) => b.confidence - a.confidence)
  return scored
}

// ─── 统一响应 + OperationLog ──────────────────────────────────────────────

async function respondLogged(params: {
  ctx: { tenantId: string; userId: string; storeId?: string | null }
  startedAt: number
  source: string
  candidates: Candidate[]
  errorCode?: ErrorCode
  imageSizeBytes: number
  status: 'SUCCESS' | 'FAILED'
  message?: string
}) {
  const latencyMs = Date.now() - params.startedAt
  const body: SuccessBody = {
    candidates: params.candidates,
    needManualConfirm: true,
  }
  if (params.errorCode) {
    body.errorCode = params.errorCode
    body.fallbackMessage = FALLBACK_MSG
  }

  // OperationLog：失败也写一行；不阻断响应
  try {
    await prisma.operationLog.create({
      data: {
        tenantId: params.ctx.tenantId,
        storeId: params.ctx.storeId ?? null,
        userId: params.ctx.userId ?? null,
        actionType: 'AI_PHOTO_RECOGNIZE',
        targetType: 'AiPhotoRecognize',
        targetId: null,
        status: params.status,
        message: (params.message ?? '').slice(0, 240),
        payloadSnapshot: {
          aiProvider: AI_PROVIDER,
          aiModel: AI_MODEL,
          source: params.source || 'sale_recognize_v1',
          imageSizeBytes: params.imageSizeBytes,
          latencyMs,
          candidateProductIds: params.candidates.map((c) => c.productId),
          candidateCount: params.candidates.length,
          errorCode: params.errorCode ?? null,
        },
      },
    })
  } catch (e) {
    console.error('[ai-photo-recognize] OperationLog write failed', e)
  }

  return NextResponse.json(body)
}
