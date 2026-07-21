/** 商品导入确认：服务端复核 + 单事务写入，避免部分成功。 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import type { PreviewRow } from '../route'

type ErrorRow = { row: number; barcode: string; reason: string }
type ImportAction = 'CREATE' | 'UPDATE' | 'SKIP'

function actionFor(row: PreviewRow): ImportAction {
  return row.duplicateAction === 'UPDATE' || row.duplicateAction === 'SKIP' ? row.duplicateAction : 'CREATE'
}

function normalizedImageUrls(row: PreviewRow): string[] | null {
  const values = Array.isArray(row.imageUrls) && row.imageUrls.length > 0
    ? row.imageUrls
    : row.imageUrl ? [row.imageUrl] : []
  const seen = new Set<string>()
  const urls: string[] = []
  for (const value of values) {
    const url = String(value ?? '').trim()
    if (!url || seen.has(url)) continue
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    } catch {
      return null
    }
    seen.add(url)
    urls.push(url)
    if (urls.length === 3) break
  }
  return urls
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以导入商品' }, { status: 403 })

  let body: { rows?: PreviewRow[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }
  const rows = body.rows
  if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: 'MISSING_ROWS', message: '无可导入的行' }, { status: 400 })
  if (rows.length > 500) return NextResponse.json({ error: 'TOO_MANY_ROWS', message: '单次最多导入 500 行' }, { status: 400 })

  const errors: ErrorRow[] = []
  const rowByBarcode = new Map<string, PreviewRow>()
  const imageUrlsByBarcode = new Map<string, string[]>()
  for (const row of rows) {
    const rowNum = Number.isInteger(row.rowNum) ? row.rowNum : 0
    const barcode = String(row.barcode ?? '').trim()
    if (!barcode) errors.push({ row: rowNum, barcode: '—', reason: '条码或 SKU 不能为空' })
    else if (rowByBarcode.has(barcode)) errors.push({ row: rowNum, barcode, reason: '确认数据中存在重复条码' })
    else rowByBarcode.set(barcode, row)
    if (!String(row.name ?? '').trim()) errors.push({ row: rowNum, barcode: barcode || '—', reason: '商品名不能为空' })
    if (!Number.isFinite(row.sellPrice) || row.sellPrice <= 0) errors.push({ row: rowNum, barcode: barcode || '—', reason: '售价无效' })
    const imageUrls = normalizedImageUrls(row)
    if (!imageUrls) errors.push({ row: rowNum, barcode: barcode || '—', reason: '图片链接必须是 http 或 https URL' })
    else if (barcode) imageUrlsByBarcode.set(barcode, imageUrls)
  }
  if (errors.length > 0) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', failed: errors.length, errors: errors.sort((a, b) => a.row - b.row) }, { status: 422 })
  }

  const existing = await prisma.product.findMany({
    where: { tenantId: ctx.tenantId, barcode: { in: [...rowByBarcode.keys()] } },
    select: { id: true, barcode: true },
  })
  const existingByBarcode = new Map(existing.map((product) => [product.barcode, product]))
  const toCreate: PreviewRow[] = []
  const toUpdate: PreviewRow[] = []
  let skipped = 0
  for (const row of rows) {
    const exists = existingByBarcode.has(row.barcode)
    const action = actionFor(row)
    if (action === 'SKIP') {
      skipped++
      continue
    }
    if (exists && action !== 'UPDATE') {
      errors.push({ row: row.rowNum, barcode: row.barcode, reason: '条码已存在；请明确选择“更新已有商品”或“跳过”' })
    } else if (!exists && action === 'UPDATE') {
      errors.push({ row: row.rowNum, barcode: row.barcode, reason: '商品已不存在；请重新预览后按新增导入' })
    } else if (exists) {
      toUpdate.push(row)
    } else {
      toCreate.push(row)
    }
  }
  if (errors.length > 0) {
    return NextResponse.json({ error: 'STALE_PREVIEW', failed: errors.length, errors: errors.sort((a, b) => a.row - b.row) }, { status: 409 })
  }

  const neededPairs = new Map<string, { l1: string; l2: string | null }>()
  for (const row of toCreate) {
    if (row.resolvedL1?.trim()) neededPairs.set(`${row.resolvedL1}__${row.resolvedL2 ?? ''}`, { l1: row.resolvedL1, l2: row.resolvedL2 ?? null })
  }
  for (const row of toUpdate) {
    if (row.category1Raw?.trim() && row.resolvedL1?.trim()) {
      neededPairs.set(`${row.resolvedL1}__${row.resolvedL2 ?? ''}`, { l1: row.resolvedL1, l2: row.resolvedL2 ?? null })
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let catCreated = 0
      const categoryIds = new Map<string, string>()
      for (const [key, pair] of neededPairs) {
        let l1 = await tx.productCategory.findFirst({ where: { tenantId: ctx.tenantId, name: pair.l1, parentId: null } })
        if (!l1) {
          l1 = await tx.productCategory.create({ data: { tenantId: ctx.tenantId, name: pair.l1, sortOrder: 0 } })
          catCreated++
        }
        if (!pair.l2) {
          categoryIds.set(key, l1.id)
          continue
        }
        let l2 = await tx.productCategory.findFirst({ where: { tenantId: ctx.tenantId, name: pair.l2, parentId: l1.id } })
        if (!l2) {
          l2 = await tx.productCategory.create({ data: { tenantId: ctx.tenantId, name: pair.l2, parentId: l1.id, sortOrder: 0 } })
          catCreated++
        }
        categoryIds.set(key, l2.id)
      }

      const categoryIdForCreate = (row: PreviewRow) => row.resolvedL1 ? categoryIds.get(`${row.resolvedL1}__${row.resolvedL2 ?? ''}`) ?? null : null
      const imagesFor = (row: PreviewRow) => imageUrlsByBarcode.get(row.barcode) ?? []
      if (toCreate.length > 0) {
        await tx.product.createMany({
          data: toCreate.map((row) => {
            const imageUrls = imagesFor(row)
            return {
              tenantId: ctx.tenantId,
              barcode: row.barcode.trim(),
              sku: row.sku ?? null,
              name: row.name.trim(),
              nameZh: row.nameZh ?? null,
              nameEn: row.nameEn ?? null,
              nameKm: row.nameKm ?? null,
              descZh: row.descZh ?? null,
              descEn: row.descEn ?? null,
              descKm: row.descKm ?? null,
              spec: row.spec ?? null,
              sellPrice: String(row.sellPrice),
              status: row.status,
              categoryId: categoryIdForCreate(row),
              imageUrl: imageUrls[0] ?? null,
              imageUrls: imageUrls.length > 0 ? JSON.stringify(imageUrls) : null,
              imageStorageKey: null,
              imageStorageKeys: null,
            }
          }),
        })
      }
      for (const row of toUpdate) {
        const imageUrls = imagesFor(row)
        const categoryKey = row.category1Raw?.trim() && row.resolvedL1 ? `${row.resolvedL1}__${row.resolvedL2 ?? ''}` : null
        await tx.product.update({
          where: { id: existingByBarcode.get(row.barcode)!.id },
          data: {
            sku: row.sku ?? null,
            name: row.name.trim(),
            nameZh: row.nameZh ?? null,
            nameEn: row.nameEn ?? null,
            nameKm: row.nameKm ?? null,
            descZh: row.descZh ?? null,
            descEn: row.descEn ?? null,
            descKm: row.descKm ?? null,
            spec: row.spec ?? null,
            sellPrice: String(row.sellPrice),
            status: row.status,
            ...(categoryKey ? { categoryId: categoryIds.get(categoryKey) ?? null } : {}),
            ...(imageUrls.length > 0 ? {
              imageUrl: imageUrls[0],
              imageUrls: JSON.stringify(imageUrls),
              imageStorageKey: null,
              imageStorageKeys: null,
            } : {}),
          },
        })
      }
      return { created: toCreate.length, updated: toUpdate.length, catCreated }
    }, { timeout: 20_000 })
    return NextResponse.json({
      imported: result.created + result.updated,
      created: result.created,
      updated: result.updated,
      skipped,
      catCreated: result.catCreated,
      imageCount: [...toCreate, ...toUpdate].filter((row) => (imageUrlsByBarcode.get(row.barcode) ?? []).length > 0).length,
      failed: 0,
      errors: [],
    })
  } catch (error) {
    console.error('[products-import-confirm] transaction failed', error)
    return NextResponse.json(
      { error: 'IMPORT_TRANSACTION_FAILED', message: '导入未完成，系统已回滚本次写入；请检查数据后重试。' },
      { status: 500 },
    )
  }
}
