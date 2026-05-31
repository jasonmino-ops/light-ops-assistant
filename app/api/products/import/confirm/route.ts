/**
 * POST /api/products/import/confirm  — 确认导入
 *
 * 仅 OWNER 可用。
 * 接收前端预览确认后的行数据（已过滤掉有 error 的行），
 * 按需查找/新建 ProductCategory，再批量创建商品。
 *
 * Body: { rows: PreviewRow[] }
 * 返回: { imported, catCreated, imageCount, failed, errors }
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import type { PreviewRow } from '../route'

type ErrorRow = { row: number; barcode: string; reason: string }

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以导入商品' }, { status: 403 })
  }

  let body: { rows?: PreviewRow[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const rows = body.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'MISSING_ROWS', message: '无可导入的行' }, { status: 400 })
  }
  if (rows.length > 500) {
    return NextResponse.json({ error: 'TOO_MANY_ROWS', message: '单次最多导入 500 行' }, { status: 400 })
  }

  // 基础校验（防止前端绕过预览直接调用）
  const errors: ErrorRow[] = []
  const validRows: PreviewRow[] = []
  for (const row of rows) {
    if (!row.barcode?.trim()) { errors.push({ row: row.rowNum, barcode: '—', reason: '条码不能为空' }); continue }
    if (!row.name?.trim())    { errors.push({ row: row.rowNum, barcode: row.barcode, reason: '商品名不能为空' }); continue }
    if (!row.sellPrice || row.sellPrice <= 0) { errors.push({ row: row.rowNum, barcode: row.barcode, reason: '售价无效' }); continue }
    validRows.push(row)
  }

  if (validRows.length === 0) {
    return NextResponse.json({ imported: 0, catCreated: 0, imageCount: 0, failed: errors.length, errors })
  }

  // 再次防重：检查数据库已存在的条码
  const existing = await prisma.product.findMany({
    where: { tenantId: ctx.tenantId, barcode: { in: validRows.map((r) => r.barcode) } },
    select: { barcode: true },
  })
  const existingSet = new Set(existing.map((p) => p.barcode))

  const toCreate: PreviewRow[] = []
  for (const row of validRows) {
    if (existingSet.has(row.barcode)) {
      errors.push({ row: row.rowNum, barcode: row.barcode, reason: '条码已存在（跳过）' })
    } else {
      toCreate.push(row)
    }
  }

  if (toCreate.length === 0) {
    return NextResponse.json({ imported: 0, catCreated: 0, imageCount: 0, failed: errors.length, errors })
  }

  // ── 分类处理：查找或新建 ProductCategory ─────────────────────────────────
  const catKeyMap = new Map<string, string>() // catKey → categoryId
  const neededPairs = new Map<string, { l1: string; l2: string | null }>()
  for (const row of toCreate) {
    if (!row.resolvedL1) continue
    const key = `${row.resolvedL1}__${row.resolvedL2 ?? ''}`
    neededPairs.set(key, { l1: row.resolvedL1, l2: row.resolvedL2 ?? null })
  }

  let catCreated = 0
  for (const [catKey, pair] of neededPairs) {
    let l1Cat = await prisma.productCategory.findFirst({
      where: { tenantId: ctx.tenantId, name: pair.l1, parentId: null },
    })
    if (!l1Cat) {
      l1Cat = await prisma.productCategory.create({
        data: { tenantId: ctx.tenantId, name: pair.l1, sortOrder: 0 },
      })
      catCreated++
    }

    if (!pair.l2) {
      catKeyMap.set(catKey, l1Cat.id)
    } else {
      let l2Cat = await prisma.productCategory.findFirst({
        where: { tenantId: ctx.tenantId, name: pair.l2, parentId: l1Cat.id },
      })
      if (!l2Cat) {
        l2Cat = await prisma.productCategory.create({
          data: { tenantId: ctx.tenantId, name: pair.l2, parentId: l1Cat.id, sortOrder: 0 },
        })
        catCreated++
      }
      catKeyMap.set(catKey, l2Cat.id)
    }
  }

  // ── 批量插入商品 ──────────────────────────────────────────────────────────
  const imageCount = toCreate.filter((r) => !!r.imageUrl).length

  const result = await prisma.product.createMany({
    data: toCreate.map((r) => {
      const catKey = r.resolvedL1 ? `${r.resolvedL1}__${r.resolvedL2 ?? ''}` : null
      const categoryId = catKey ? (catKeyMap.get(catKey) ?? null) : null
      return {
        tenantId:   ctx.tenantId,
        barcode:    r.barcode.trim(),
        sku:        r.sku ?? null,
        name:       r.name.trim(),
        nameZh:     r.nameZh ?? null,
        nameEn:     r.nameEn ?? null,
        nameKm:     r.nameKm ?? null,
        descZh:     r.descZh ?? null,
        descEn:     r.descEn ?? null,
        descKm:     r.descKm ?? null,
        spec:       r.spec ?? null,
        sellPrice:  String(r.sellPrice),
        status:     r.status,
        categoryId: categoryId,
        imageUrl:   r.imageUrl ?? null,
      }
    }),
    skipDuplicates: true,
  })

  errors.sort((a, b) => a.row - b.row)

  return NextResponse.json({
    imported:   result.count,
    catCreated,
    imageCount,
    failed:     errors.length,
    errors,
  })
}
