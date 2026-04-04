/**
 * GET  /api/products/import  — 下载导入模板
 * POST /api/products/import  — 批量导入商品
 *
 * OWNER only.
 *
 * 导入规则（v0 最小版）：
 *   - barcode 不存在 → 新增
 *   - barcode 已存在 → 报重复，不覆盖
 *   - 文件内同 barcode 出现多次 → 全部报错
 *   - 错误行返回 { row, barcode, reason }
 */

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

// ── Template ────────────────────────────────────────────────────────────────────

const TEMPLATE_HEADER = ['barcode', 'sku', 'name', 'spec', 'sellPrice', 'status']
const TEMPLATE_SAMPLE = ['1234567890123', 'SKU001', '可口可乐', '330ml', '3.50', 'ACTIVE']
const TEMPLATE_COL_WIDTHS = [
  { wch: 18 }, // barcode
  { wch: 14 }, // sku
  { wch: 22 }, // name
  { wch: 12 }, // spec
  { wch: 12 }, // sellPrice
  { wch: 10 }, // status
]

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADER, TEMPLATE_SAMPLE])
  ws['!cols'] = TEMPLATE_COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, '商品导入模板')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as any
  const blob = new Blob([Buffer.from(rawBuf)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

  return new NextResponse(blob, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="products_template.xlsx"',
    },
  })
}

// ── Import ──────────────────────────────────────────────────────────────────────

type ErrorRow = { row: number; barcode: string; reason: string }

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '只有老板可以导入商品' },
      { status: 403 },
    )
  }

  // ── Parse multipart ──────────────────────────────────────────────────────────
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'INVALID_FORM', message: '请上传 Excel 文件' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'NO_FILE', message: '未收到文件' }, { status: 400 })
  }
  if (file.size > 2 * 1024 * 1024) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE', message: '文件不能超过 2MB' }, { status: 400 })
  }

  // ── Parse Excel ──────────────────────────────────────────────────────────────
  const buf = Buffer.from(await file.arrayBuffer())
  let rows: unknown[][]
  try {
    const wb = XLSX.read(buf, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
  } catch {
    return NextResponse.json({ error: 'PARSE_ERROR', message: '无法解析 Excel 文件，请使用模板格式' }, { status: 400 })
  }

  if (rows.length < 2) {
    return NextResponse.json({ error: 'EMPTY_FILE', message: '文件中无数据行（需包含表头+至少一行数据）' }, { status: 400 })
  }

  // ── Locate columns from header row ──────────────────────────────────────────
  const headerRow = (rows[0] as unknown[]).map((h) => String(h).trim().toLowerCase())
  const col = {
    barcode:   headerRow.indexOf('barcode'),
    sku:       headerRow.indexOf('sku'),
    name:      headerRow.indexOf('name'),
    spec:      headerRow.indexOf('spec'),
    sellPrice: headerRow.indexOf('sellprice'),
    status:    headerRow.indexOf('status'),
  }

  const missing = (['barcode', 'name', 'sellPrice'] as const).filter(
    (k) => col[k] === -1,
  )
  if (missing.length > 0) {
    return NextResponse.json(
      { error: 'INVALID_HEADER', message: `缺少必需列：${missing.join(', ')}` },
      { status: 400 },
    )
  }

  // ── Parse & validate data rows ───────────────────────────────────────────────
  type ParsedRow = {
    rowNum: number
    barcode: string
    sku: string | null
    name: string
    spec: string | null
    sellPrice: number
    status: 'ACTIVE' | 'DISABLED'
  }

  const validRows: ParsedRow[] = []
  const errors: ErrorRow[] = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    const rowNum = i + 1

    const barcode   = String(row[col.barcode]   ?? '').trim()
    const name      = String(row[col.name]       ?? '').trim()
    const priceRaw  = String(row[col.sellPrice]  ?? '').trim()
    const sku       = col.sku       !== -1 ? (String(row[col.sku]   ?? '').trim() || null) : null
    const spec      = col.spec      !== -1 ? (String(row[col.spec]  ?? '').trim() || null) : null
    const statusRaw = col.status    !== -1 ? String(row[col.status] ?? '').trim().toUpperCase() : 'ACTIVE'

    // skip blank rows
    if (!barcode && !name && !priceRaw) continue

    if (!barcode) { errors.push({ row: rowNum, barcode: '—', reason: '条码不能为空' }); continue }
    if (!name)    { errors.push({ row: rowNum, barcode, reason: '商品名不能为空' }); continue }

    const sellPrice = parseFloat(priceRaw)
    if (isNaN(sellPrice) || sellPrice <= 0) {
      errors.push({ row: rowNum, barcode, reason: `售价无效：${priceRaw}` })
      continue
    }

    const status: 'ACTIVE' | 'DISABLED' = statusRaw === 'DISABLED' ? 'DISABLED' : 'ACTIVE'
    validRows.push({ rowNum, barcode, sku, name, spec, sellPrice, status })
  }

  if (validRows.length === 0 && errors.length === 0) {
    return NextResponse.json({ error: 'EMPTY_FILE', message: '文件中无数据行' }, { status: 400 })
  }

  // ── Dedup within file ────────────────────────────────────────────────────────
  const barcodeCount = new Map<string, number>()
  for (const r of validRows) barcodeCount.set(r.barcode, (barcodeCount.get(r.barcode) ?? 0) + 1)

  const inFileDupes = new Set<string>()
  for (const [bc, cnt] of barcodeCount) if (cnt > 1) inFileDupes.add(bc)

  const dedupedRows: ParsedRow[] = []
  for (const r of validRows) {
    if (inFileDupes.has(r.barcode)) {
      errors.push({ row: r.rowNum, barcode: r.barcode, reason: '文件内条码重复' })
    } else {
      dedupedRows.push(r)
    }
  }

  // ── Check DB for existing barcodes ───────────────────────────────────────────
  const existing = await prisma.product.findMany({
    where: { tenantId: ctx.tenantId, barcode: { in: dedupedRows.map((r) => r.barcode) } },
    select: { barcode: true },
  })
  const existingSet = new Set(existing.map((p) => p.barcode))

  const toCreate: ParsedRow[] = []
  for (const r of dedupedRows) {
    if (existingSet.has(r.barcode)) {
      errors.push({ row: r.rowNum, barcode: r.barcode, reason: '条码已存在（请手动修改）' })
    } else {
      toCreate.push(r)
    }
  }

  // ── Bulk insert ──────────────────────────────────────────────────────────────
  let imported = 0
  if (toCreate.length > 0) {
    const result = await prisma.product.createMany({
      data: toCreate.map((r) => ({
        tenantId:  ctx.tenantId,
        barcode:   r.barcode,
        sku:       r.sku,
        name:      r.name,
        spec:      r.spec,
        sellPrice: String(r.sellPrice),
        status:    r.status,
      })),
      skipDuplicates: true,
    })
    imported = result.count
  }

  // Sort errors by row number for readability
  errors.sort((a, b) => a.row - b.row)

  return NextResponse.json({ imported, failed: errors.length, errors })
}
