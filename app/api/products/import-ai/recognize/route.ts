/**
 * POST /api/products/import-ai/recognize  — AI 菜单识别（OWNER）
 *
 * 接收单张菜单图片 → 调 Anthropic 视觉模型识别 → 返回 PreviewRow[]，
 * 不直接写库。后续仍由 /api/products/import/confirm 完成实际导入。
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { getContext } from '@/lib/context'
import { normalizeMenuItems, quantizedSourceBox, recognizeMenuImage, type AiMenuItem } from '@/lib/ai-menu-recognize'
import { prisma } from '@/lib/prisma'
import { stableRowIdentity } from '@/lib/product-bulk-import/barcode'
import { resolveExistingCategory } from '@/lib/product-bulk-import/categories'
import { allocateStableGeneratedBarcode } from '@/lib/product-bulk-import/jobs'
import type { PreviewRow } from '../../import/route'

const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以导入商品' }, { status: 403 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'INVALID_FORM', message: '请上传图片' }, { status: 400 })
  }
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'NO_FILE', message: '未收到文件' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'INVALID_TYPE', message: '仅支持 JPG / PNG / WebP' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE', message: '图片不能超过 5MB' }, { status: 400 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const base64 = buf.toString('base64')
  const sourceFileHash = createHash('sha256').update(buf).digest('hex')
  const cacheId = `menu-ai-v2-${createHash('sha256').update(`${ctx.tenantId}:${sourceFileHash}`).digest('hex')}`

  let items: AiMenuItem[]
  try {
    const cached = await prisma.productBulkImportJob.findUnique({ where: { id: cacheId }, select: { analysisMetadata: true } })
    const cachedItems = cached?.analysisMetadata && typeof cached.analysisMetadata === 'object' && !Array.isArray(cached.analysisMetadata)
      ? (cached.analysisMetadata as Record<string, unknown>).menuItems
      : null
    if (cachedItems) {
      items = normalizeMenuItems(cachedItems)
    } else {
      const recognized = await recognizeMenuImage(base64, file.type)
      const now = new Date()
      const canonical = await prisma.productBulkImportJob.upsert({
        where: { id: cacheId },
        create: {
          id: cacheId,
          tenantId: ctx.tenantId,
          sourceFileName: file.name.slice(0, 255) || 'menu-image',
          sourceMimeType: file.type,
          sourceFormat: 'MENU_IMAGE_CACHE',
          sourceFileSize: file.size,
          sourceFileHash,
          stagingStorageKey: `analysis-cache/menu-image-v2/${cacheId}`,
          status: 'COMPLETED',
          analysisRevision: 1,
          analysisMetadata: { capability: 'MENU_IMAGE_V2', menuItems: recognized },
          resultSummary: { cachedItems: recognized.length },
          expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
          analyzedAt: now,
          completedAt: now,
          stagingCleanedAt: now,
        },
        update: {},
        select: { analysisMetadata: true },
      })
      const canonicalItems = canonical.analysisMetadata && typeof canonical.analysisMetadata === 'object' && !Array.isArray(canonical.analysisMetadata)
        ? (canonical.analysisMetadata as Record<string, unknown>).menuItems
        : null
      items = normalizeMenuItems(canonicalItems)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'AI_FAILED'
    if (msg === 'AI_NOT_CONFIGURED') {
      return NextResponse.json(
        { error: 'AI_NOT_CONFIGURED', message: '后端未配置 AI 服务，请联系管理员设置 ANTHROPIC_API_KEY' },
        { status: 500 },
      )
    }
    if (msg === 'AI_JSON_PARSE_ERROR' || msg === 'AI_NOT_ARRAY' || msg === 'AI_RESP_PARSE_ERROR' || msg === 'AI_SCHEMA_INVALID') {
      return NextResponse.json(
        { error: 'AI_PARSE_ERROR', message: 'AI 返回内容无法解析，请重试或换一张更清晰的图片' },
        { status: 502 },
      )
    }
    return NextResponse.json(
      { error: 'AI_FAILED', message: '识别失败：' + msg.slice(0, 200) },
      { status: 502 },
    )
  }

  if (items.length === 0) {
    return NextResponse.json(
      { error: 'AI_EMPTY', message: '未识别到任何商品，请换一张更清晰的菜单图片', preview: [] },
      { status: 200 },
    )
  }

  const barcodes = await Promise.all(items.map((item) => allocateStableGeneratedBarcode(
    ctx.tenantId,
    sourceFileHash,
    stableRowIdentity(['menu-image-block-v1', ...quantizedSourceBox(item.sourceBox)]),
  )))
  const existingCategories = await prisma.productCategory.findMany({
    where: { tenantId: ctx.tenantId },
    select: { id: true, name: true, parentId: true },
  })
  const categoriesById = new Map(existingCategories.map((category) => [category.id, category]))
  const preview: PreviewRow[] = items.map((it, i) => {
    const categoryResolution = resolveExistingCategory(existingCategories, it.category, null)
    const matchedCategory = categoryResolution.status === 'MATCHED'
      ? categoriesById.get(categoryResolution.categoryId)
      : null
    return {
    rowNum: i + 1,
    barcode: barcodes[i],
    sku:     null,
    name:    it.name,
    nameZh:  it.name ?? null,
    nameEn:  null,
    nameKm:  null,
    descZh:  null,
    descEn:  null,
    descKm:  null,
    spec:    it.unit ?? null,
    sellPrice: it.price ?? 0,
    status: 'ACTIVE',
    imageUrl: null,
    category1Raw: it.category ?? '',
    category2Raw: '',
    resolvedL1: matchedCategory?.name ?? null,
    resolvedL2: null,
    catSource: matchedCategory ? 'AUTO' : 'NONE',
    isDuplicate: false,
    error: null,
    confidence: it.confidence,
    warnings: it.category && !matchedCategory
      ? [...it.warnings, `分类候选“${it.category}”未匹配现有分类，需人工确认`]
      : it.warnings,
    }
  })

  return NextResponse.json({ preview })
}
