/**
 * 商品导入：模板下载、Excel/CSV 自动解析与可编辑字段映射预览。
 * 所有写库均由 /confirm 显式完成。
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { hintCategory } from '@/lib/product-category-hint'
import {
  createProductTemplateWorkbook,
  parseProductSpreadsheet,
  type ProductImportColumnMapping,
  type ProductImportPreviewRow,
} from '@/lib/product-spreadsheet'

export type PreviewRow = ProductImportPreviewRow

const MAX_FILE_SIZE = 5 * 1024 * 1024

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const data = createProductTemplateWorkbook()
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="products_template.xlsx"',
      'Cache-Control': 'no-store',
    },
  })
}

function requestedMapping(value: FormDataEntryValue | null): ProductImportColumnMapping | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ProductImportColumnMapping : undefined
  } catch {
    return undefined
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以导入商品' }, { status: 403 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'INVALID_FORM', message: '请上传 Excel 或 CSV 文件' }, { status: 400 })
  }
  const file = formData.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'NO_FILE', message: '未收到文件' }, { status: 400 })
  if (file.size === 0 || file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE', message: '文件必须大于 0 且不超过 5MB' }, { status: 400 })
  }
  const parsed = parseProductSpreadsheet(Buffer.from(await file.arrayBuffer()), requestedMapping(formData.get('mapping')))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, message: parsed.message }, { status: 400 })

  const preview = parsed.value.preview
  for (const row of preview) {
    if (row.error || row.resolvedL1 || !row.name) continue
    const hint = hintCategory(row.name)
    if (hint) {
      row.resolvedL1 = hint.l1
      row.resolvedL2 = hint.l2
      row.catSource = 'AUTO'
    }
  }
  const validBarcodes = preview.filter((row) => !row.error && !!row.barcode).map((row) => row.barcode)
  if (validBarcodes.length > 0) {
    const existing = await prisma.product.findMany({
      where: { tenantId: ctx.tenantId, barcode: { in: validBarcodes } },
      select: { barcode: true },
    })
    const existingSet = new Set(existing.map((product) => product.barcode))
    for (const row of preview) {
      if (!row.error && existingSet.has(row.barcode)) {
        row.isDuplicate = true
        // 保护现有商品：重复条码默认跳过，必须由老板逐行显式选择更新。
        row.duplicateAction = 'SKIP'
        row.warnings.push('条码已存在，默认跳过；如确认覆盖，请选择“更新已有商品”。')
      }
    }
  }
  return NextResponse.json({
    preview,
    headers: parsed.value.headers,
    mapping: parsed.value.mapping,
    sampleRows: parsed.value.sampleRows,
    sheetName: parsed.value.sheetName,
  })
}
