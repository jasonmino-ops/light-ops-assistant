/**
 * POST /api/sales/photo-recognize-multi
 *
 * AI 拍照多商品识别 Beta 后端接口。
 *
 * 安全契约：
 * - 不改现有 /api/sales/photo-recognize 单商品稳定版
 * - 不接受前端 tenantId / storeId / productId
 * - 不存图，不创建商品，不加入购物车，不下单，不收款
 * - AI 只返回视觉 aiHint；候选 productId/name/spec/price/imageUrl 全部来自数据库 Product
 * - needManualConfirm 永远为 true
 * - OperationLog 使用独立 actionType='AI_PHOTO_RECOGNIZE_MULTI'
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import {
  AI_PHOTO_MULTI_MODEL,
  AI_PHOTO_MULTI_PROVIDER,
  recognizeMultipleProducts,
  type AiPhotoMultiHint,
} from '@/lib/ai-photo-multi-products-recognize'
import {
  AI_PHOTO_MULTI_FEATURE_KEY,
  getAiPhotoMultiTrialStoreIds,
  getAiPhotoMultiUsedToday,
  resolveAiPhotoMultiUsagePolicy,
  type AiPhotoMultiConfigSource,
} from '@/lib/ai-photo-usage-multi'
import { getEnvPositiveInt } from '@/lib/ai-photo-usage'
import type { TenantTier } from '@/lib/tier'

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 1024 * 1024
const MAX_BASE64_LEN = Math.ceil(MAX_BYTES * 4 / 3) + 64
const PRODUCT_PRE_LIMIT = 500

type Candidate = {
  productId: string
  name: string
  spec: string | null
  price: number
  imageUrl: string | null
  confidence: number
  reason: string[]
}

type MultiItem = {
  itemIndex: number
  aiHint: AiPhotoMultiHint
  candidates: Candidate[]
  needManualConfirm: true
}

type ErrorCode =
  | 'AI_MULTI_BETA_DISABLED'
  | 'AI_DISABLED_BY_OPS'
  | 'AI_DAILY_LIMIT_REACHED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_TIMEOUT'
  | 'AI_EMPTY'
  | 'AI_FAILED'
  | 'INVALID_IMAGE'
  | 'INVALID_MIME'

type ResponseBody = {
  items: MultiItem[]
  itemCount: number
  needManualConfirm: true
  usage: {
    usedToday: number
    dailyLimit: number
  }
  errorCode: ErrorCode | null
  fallbackMessage: string | null
}

type ProductRow = {
  id: string
  barcode: string
  name: string
  spec: string | null
  sellPrice: { toNumber(): number }
  imageUrl: string | null
  nameZh: string | null
  nameEn: string | null
  nameKm: string | null
}

const FALLBACK_BY_ERROR: Record<ErrorCode, string> = {
  AI_MULTI_BETA_DISABLED: 'AI 多商品识别 Beta 暂未开启',
  AI_DISABLED_BY_OPS: '当前门店 AI 多商品识别已暂停，请使用扫码或手动选择商品。',
  AI_DAILY_LIMIT_REACHED: '今日 AI 多商品识别次数已用完，请使用扫码或手动选择商品。',
  AI_NOT_CONFIGURED: 'AI 识别暂未配置，请使用扫码或手动选择商品。',
  AI_TIMEOUT: '识别超时，请换一张更清晰的图片重试。',
  AI_EMPTY: '未识别到清晰商品，请拍商品正面。',
  AI_FAILED: 'AI 识别失败，请使用扫码或手动选择商品。',
  INVALID_IMAGE: '图片无效或过大，请换一张 JPG 图片。',
  INVALID_MIME: '图片格式不支持，请换 JPG 图片。',
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  let body: { imageBase64?: unknown; mime?: unknown; source?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const sourceRaw = typeof body.source === 'string' ? body.source.trim() : ''
  if (sourceRaw && sourceRaw !== 'sale_recognize_multi_v1') {
    return NextResponse.json({ error: 'INVALID_SOURCE' }, { status: 400 })
  }
  const source = sourceRaw || 'sale_recognize_multi_v1'

  const betaEnabled = (process.env.AI_PHOTO_MULTI_ENABLED ?? '0').trim() === '1'
  const trialStoreIds = getAiPhotoMultiTrialStoreIds()
  if (!betaEnabled || !trialStoreIds.has(ctx.storeId)) {
    return respondLogged({
      ctx,
      startedAt,
      source,
      items: [],
      errorCode: 'AI_MULTI_BETA_DISABLED',
      imageSizeBytes: 0,
      status: 'FAILED',
      message: 'AI_MULTI_BETA_DISABLED',
      dailyLimit: 0,
      usedToday: 0,
      enabled: false,
    })
  }

  const usagePolicy = await resolveAiPhotoMultiUsagePolicy(ctx.tenantId, ctx.storeId)
  const { dailyLimit, tenantTier, configSource, enabled, trialUntil } = usagePolicy
  const usedToday = await getAiPhotoMultiUsedToday(ctx.storeId)

  if (!enabled) {
    return respondLogged({
      ctx,
      startedAt,
      source,
      items: [],
      errorCode: 'AI_DISABLED_BY_OPS',
      imageSizeBytes: 0,
      status: 'FAILED',
      message: 'AI_DISABLED_BY_OPS',
      dailyLimit,
      usedToday,
      tenantTier,
      configSource,
      enabled,
      trialUntil,
    })
  }

  if (usedToday >= dailyLimit) {
    return respondLogged({
      ctx,
      startedAt,
      source,
      items: [],
      errorCode: 'AI_DAILY_LIMIT_REACHED',
      imageSizeBytes: 0,
      status: 'FAILED',
      message: 'AI_DAILY_LIMIT_REACHED',
      dailyLimit,
      usedToday,
      tenantTier,
      configSource,
      enabled,
      trialUntil,
    })
  }

  const usedTodayAfterThisCall = usedToday + 1
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : ''
  const mime = typeof body.mime === 'string' ? body.mime.trim().toLowerCase() : ''
  if (!imageBase64) {
    return respondLogged({
      ctx, startedAt, source, items: [], errorCode: 'INVALID_IMAGE',
      imageSizeBytes: 0, status: 'FAILED', message: 'MISSING_IMAGE',
      dailyLimit, usedToday: usedTodayAfterThisCall, tenantTier, configSource, enabled, trialUntil,
    })
  }
  if (!ALLOWED_MIME.has(mime)) {
    return respondLogged({
      ctx, startedAt, source, items: [], errorCode: 'INVALID_MIME',
      imageSizeBytes: 0, status: 'FAILED', message: 'INVALID_MIME',
      dailyLimit, usedToday: usedTodayAfterThisCall, tenantTier, configSource, enabled, trialUntil,
    })
  }
  if (imageBase64.length > MAX_BASE64_LEN) {
    return respondLogged({
      ctx, startedAt, source, items: [], errorCode: 'INVALID_IMAGE',
      imageSizeBytes: imageBase64.length, status: 'FAILED', message: 'IMAGE_TOO_LARGE',
      dailyLimit, usedToday: usedTodayAfterThisCall, tenantTier, configSource, enabled, trialUntil,
    })
  }

  let imageSizeBytes = 0
  try {
    const buf = Buffer.from(imageBase64, 'base64')
    imageSizeBytes = buf.length
    if (imageSizeBytes === 0) throw new Error('EMPTY')
    if (imageSizeBytes > MAX_BYTES) {
      return respondLogged({
        ctx, startedAt, source, items: [], errorCode: 'INVALID_IMAGE',
        imageSizeBytes, status: 'FAILED', message: 'IMAGE_TOO_LARGE',
        dailyLimit, usedToday: usedTodayAfterThisCall, tenantTier, configSource, enabled, trialUntil,
      })
    }
  } catch {
    return respondLogged({
      ctx, startedAt, source, items: [], errorCode: 'INVALID_IMAGE',
      imageSizeBytes: 0, status: 'FAILED', message: 'BASE64_DECODE_FAIL',
      dailyLimit, usedToday: usedTodayAfterThisCall, tenantTier, configSource, enabled, trialUntil,
    })
  }

  const maxItems = Math.min(getEnvPositiveInt('AI_PHOTO_MULTI_MAX_ITEMS', 3), 3)
  const maxCandidates = Math.min(getEnvPositiveInt('AI_PHOTO_MULTI_MAX_CANDIDATES', 3), 3)
  let aiHints: AiPhotoMultiHint[] = []
  let aiError: ErrorCode | null = null
  let aiErrorRaw: string | null = null
  try {
    aiHints = await recognizeMultipleProducts(imageBase64, mime, maxItems)
  } catch (e) {
    const m = e instanceof Error ? e.message : 'AI_FAILED'
    aiErrorRaw = m.slice(0, 200)
    if (m === 'AI_NOT_CONFIGURED') aiError = 'AI_NOT_CONFIGURED'
    else if (m === 'AI_TIMEOUT') aiError = 'AI_TIMEOUT'
    else aiError = 'AI_FAILED'
  }

  if (aiError) {
    return respondLogged({
      ctx, startedAt, source, items: [], errorCode: aiError,
      imageSizeBytes, status: 'FAILED', message: aiErrorRaw ?? aiError,
      dailyLimit, usedToday: usedTodayAfterThisCall, tenantTier, configSource, enabled, trialUntil,
    })
  }

  if (aiHints.length === 0) {
    return respondLogged({
      ctx, startedAt, source, items: [], errorCode: 'AI_EMPTY',
      imageSizeBytes, status: 'SUCCESS', message: 'items=0',
      dailyLimit, usedToday: usedTodayAfterThisCall, tenantTier, configSource, enabled, trialUntil,
    })
  }

  const products = await prisma.product.findMany({
    where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
    select: {
      id: true,
      barcode: true,
      name: true,
      spec: true,
      sellPrice: true,
      imageUrl: true,
      nameZh: true,
      nameEn: true,
      nameKm: true,
    },
    take: PRODUCT_PRE_LIMIT,
  })

  const items = dedupeAcrossItems(
    aiHints.slice(0, maxItems).map((hint, index) => ({
      itemIndex: index,
      aiHint: hint,
      candidates: scoreCandidates(hint, products).slice(0, maxCandidates),
      needManualConfirm: true as const,
    })),
  )

  return respondLogged({
    ctx,
    startedAt,
    source,
    items,
    imageSizeBytes,
    status: 'SUCCESS',
    message: `items=${items.length};candidates=${items.reduce((sum, item) => sum + item.candidates.length, 0)}`,
    dailyLimit,
    usedToday: usedTodayAfterThisCall,
    tenantTier,
    configSource,
    enabled,
    trialUntil,
  })
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

function scoreCandidates(hint: AiPhotoMultiHint, products: ProductRow[]): Candidate[] {
  const aiNameTokens = tokenize(hint.name)
  const aiBrandTokens = tokenize(hint.brand)
  const aiPkgTokens = tokenize(hint.packageText)
  const aiSpecTokens = tokenize(hint.spec)
  const aiCategoryTokens = tokenize(hint.category)

  const scored: Candidate[] = []
  for (const p of products) {
    const reasons: string[] = []
    let score = 0
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

    const brandHit = overlapRatio(aiBrandTokens, nameTokens)
    if (brandHit > 0) {
      score += brandHit * 0.25
      reasons.push('BRAND_MATCH')
    }

    const pkgHit = overlapRatio(aiPkgTokens, nameTokens)
    if (pkgHit > 0) {
      score += pkgHit * 0.22
      reasons.push('PACKAGE_TEXT_MATCH')
    }

    if (aiSpecTokens.length > 0 && p.spec) {
      const specHit = overlapRatio(aiSpecTokens, tokenize(p.spec))
      if (specHit > 0) {
        score += specHit * 0.18
        reasons.push('SPEC_MATCH')
      }
    }

    if (aiCategoryTokens.length > 0) {
      const categoryHit = overlapRatio(aiCategoryTokens, nameTokens)
      if (categoryHit > 0) {
        score += categoryHit * 0.08
        reasons.push('CATEGORY_MATCH')
      }
    }

    if (score <= 0) continue
    const finalConfidence = Math.max(0, Math.min(1, score * (0.5 + 0.5 * (hint.confidence || 0.5))))
    scored.push({
      productId: p.id,
      name: p.name,
      spec: p.spec,
      price: p.sellPrice.toNumber(),
      imageUrl: p.imageUrl,
      confidence: +finalConfidence.toFixed(3),
      reason: Array.from(new Set(reasons)),
    })
  }
  scored.sort((a, b) => b.confidence - a.confidence)
  return scored
}

function dedupeAcrossItems(items: MultiItem[]): MultiItem[] {
  const winnerByProductId = new Map<string, { itemIndex: number; confidence: number }>()
  for (const item of items) {
    for (const candidate of item.candidates) {
      const current = winnerByProductId.get(candidate.productId)
      if (!current || candidate.confidence > current.confidence) {
        winnerByProductId.set(candidate.productId, { itemIndex: item.itemIndex, confidence: candidate.confidence })
      }
    }
  }
  return items.map((item) => ({
    ...item,
    candidates: item.candidates.filter((candidate) => {
      const winner = winnerByProductId.get(candidate.productId)
      return winner?.itemIndex === item.itemIndex
    }),
  }))
}

async function respondLogged(params: {
  ctx: { tenantId: string; userId: string; storeId?: string | null }
  startedAt: number
  source: string
  items: MultiItem[]
  errorCode?: ErrorCode
  imageSizeBytes: number
  status: 'SUCCESS' | 'FAILED'
  message?: string
  dailyLimit?: number
  usedToday?: number
  tenantTier?: TenantTier
  configSource?: AiPhotoMultiConfigSource
  enabled?: boolean
  trialUntil?: string | null
}) {
  const latencyMs = Date.now() - params.startedAt
  const body: ResponseBody = {
    items: params.items,
    itemCount: params.items.length,
    needManualConfirm: true,
    usage: {
      usedToday: params.usedToday ?? 0,
      dailyLimit: params.dailyLimit ?? 0,
    },
    errorCode: params.errorCode ?? null,
    fallbackMessage: params.errorCode ? FALLBACK_BY_ERROR[params.errorCode] : null,
  }

  try {
    await prisma.operationLog.create({
      data: {
        tenantId: params.ctx.tenantId,
        storeId: params.ctx.storeId ?? null,
        userId: params.ctx.userId ?? null,
        actionType: AI_PHOTO_MULTI_FEATURE_KEY,
        targetType: 'AiPhotoRecognizeMulti',
        targetId: null,
        status: params.status,
        message: (params.message ?? '').slice(0, 240),
        payloadSnapshot: {
          aiProvider: AI_PHOTO_MULTI_PROVIDER,
          aiModel: AI_PHOTO_MULTI_MODEL,
          storeId: params.ctx.storeId ?? null,
          tenantTier: params.tenantTier ?? null,
          configSource: params.configSource ?? null,
          enabled: params.enabled ?? null,
          trialUntil: params.trialUntil ?? null,
          source: params.source,
          dailyLimit: params.dailyLimit ?? null,
          usedToday: params.usedToday ?? null,
          imageSizeBytes: params.imageSizeBytes,
          latencyMs,
          itemCount: params.items.length,
          candidateProductIds: params.items.flatMap((item) => item.candidates.map((candidate) => candidate.productId)),
          candidateCount: params.items.reduce((sum, item) => sum + item.candidates.length, 0),
          errorCode: params.errorCode ?? null,
        },
      },
    })
  } catch (e) {
    console.error('[ai-photo-recognize-multi] OperationLog write failed', e)
  }

  return NextResponse.json(body)
}
