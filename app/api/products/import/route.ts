/**
 * GET  /api/products/import  — 下载导入模板
 * POST /api/products/import  — 解析 Excel，返回导入预览（不写库）
 *
 * 仅 OWNER 可用。
 *
 * 模板字段：barcode, sku, name, spec, sellPrice, status, category1（一级分类）, category2（二级分类）
 * 表头识别支持中英文别名（如「一级分类」或「category1」均可）。
 *
 * POST 返回 { preview: PreviewRow[] }，不直接入库。
 * 确认入库请调用 POST /api/products/import/confirm。
 */

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { hintCategory } from '@/lib/product-category-hint'

// ── 模板定义 ──────────────────────────────────────────────────────────────────

const TEMPLATE_HEADER = ['barcode', 'sku', 'name', 'spec', 'sellPrice', 'status', 'category1', 'category2']
const TEMPLATE_SAMPLE = ['1234567890123', 'SKU001', '可口可乐', '330ml', '3.50', 'ACTIVE', '饮料', '碳酸饮料']
const TEMPLATE_SAMPLE2 = ['9876543210987', '', '矿泉水', '500ml', '2.00', 'ACTIVE', '饮料', '水']
const TEMPLATE_SAMPLE3 = ['1111111111111', '', '猫粮', '1.5kg', '45.00', 'ACTIVE', '', '']
const TEMPLATE_COL_WIDTHS = [
  { wch: 18 }, // barcode
  { wch: 12 }, // sku
  { wch: 22 }, // name
  { wch: 12 }, // spec
  { wch: 10 }, // sellPrice
  { wch: 10 }, // status
  { wch: 14 }, // category1
  { wch: 14 }, // category2
]

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADER, TEMPLATE_SAMPLE, TEMPLATE_SAMPLE2, TEMPLATE_SAMPLE3])
  ws['!cols'] = TEMPLATE_COL_WIDTHS
  XLSX.utils.book_append_sheet(wb, ws, '商品导入模板')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as any
  const blob = new Blob([Buffer.from(rawBuf)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  return new NextResponse(blob, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="products_template.xlsx"',
    },
  })
}

// ── 预览数据类型 ──────────────────────────────────────────────────────────────

export type PreviewRow = {
  rowNum: number
  barcode: string
  sku: string | null
  name: string
  spec: string | null
  sellPrice: number
  status: 'ACTIVE' | 'DISABLED'
  category1Raw: string      // 表格原始值
  category2Raw: string      // 表格原始值
  resolvedL1: string | null // 最终使用的一级分类名
  resolvedL2: string | null // 最终使用的二级分类名
  catSource: 'MANUAL' | 'AUTO' | 'NONE'  // 表格填写 / 系统识别 / 未识别
  isDuplicate: boolean      // 数据库中条码已存在
  error: string | null      // 行级别错误（导入时此行将被跳过）
}

// ── 表头多别名识别 ────────────────────────────────────────────────────────────

function findCol(header: string[], ...aliases: string[]): number {
  for (const alias of aliases) {
    const idx = header.indexOf(alias.toLowerCase())
    if (idx !== -1) return idx
  }
  return -1
}

// ── POST：解析预览 ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以导入商品' }, { status: 403 })
  }

  // 解析 multipart
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'INVALID_FORM', message: '请上传 Excel 文件' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'NO_FILE', message: '未收到文件' }, { status: 400 })
  if (file.size > 2 * 1024 * 1024) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE', message: '文件不能超过 2MB' }, { status: 400 })
  }

  // 解析 Excel
  const buf = Buffer.from(await file.arrayBuffer())
  let rows: unknown[][]
  try {
    const wb = XLSX.read(buf, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
  } catch {
    return NextResponse.json({ error: 'PARSE_ERROR', message: '无法解析文件，请使用模板格式' }, { status: 400 })
  }

  if (rows.length < 2) {
    return NextResponse.json({ error: 'EMPTY_FILE', message: '文件中无数据行（需包含表头+至少一行数据）' }, { status: 400 })
  }

  // 识别表头列位置（支持中英文别名）
  const headerRow = (rows[0] as unknown[]).map((h) => String(h).trim().toLowerCase())
  const col = {
    barcode:   findCol(headerRow, 'barcode', '条码', '商品条码', '条形码'),
    sku:       findCol(headerRow, 'sku'),
    name:      findCol(headerRow, 'name', '商品名', '商品名称', '名称'),
    spec:      findCol(headerRow, 'spec', '规格'),
    sellPrice: findCol(headerRow, 'sellprice', '售价', '价格', '单价'),
    status:    findCol(headerRow, 'status', '状态'),
    category1: findCol(headerRow, 'category1', 'cat1', '一级分类', '大类', '分类'),
    category2: findCol(headerRow, 'category2', 'cat2', '二级分类', '小类', '子分类'),
  }

  const missing = (['barcode', 'name', 'sellPrice'] as const).filter((k) => col[k] === -1)
  if (missing.length > 0) {
    return NextResponse.json(
      { error: 'INVALID_HEADER', message: `缺少必需列：${missing.join(', ')}（支持中英文列名）` },
      { status: 400 },
    )
  }

  // 逐行解析
  const preview: PreviewRow[] = []
  const seenBarcodes = new Map<string, number>() // barcode → 第一次出现的行号

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    const rowNum = i + 1

    const barcode    = String(row[col.barcode]   ?? '').trim()
    const name       = String(row[col.name]       ?? '').trim()
    const priceRaw   = String(row[col.sellPrice]  ?? '').trim()
    const sku        = col.sku       >= 0 ? (String(row[col.sku]    ?? '').trim() || null) : null
    const spec       = col.spec      >= 0 ? (String(row[col.spec]   ?? '').trim() || null) : null
    const statusRaw  = col.status    >= 0 ? String(row[col.status]  ?? '').trim().toUpperCase() : 'ACTIVE'
    const cat1Raw    = col.category1 >= 0 ? String(row[col.category1] ?? '').trim() : ''
    const cat2Raw    = col.category2 >= 0 ? String(row[col.category2] ?? '').trim() : ''

    // 跳过完全空行
    if (!barcode && !name && !priceRaw) continue

    // 行级错误校验
    let rowError: string | null = null
    if (!barcode) {
      rowError = '条码不能为空'
    } else if (!name) {
      rowError = '商品名不能为空'
    } else if (seenBarcodes.has(barcode)) {
      rowError = `文件内条码重复（第 ${seenBarcodes.get(barcode)} 行）`
    } else {
      const price = parseFloat(priceRaw)
      if (isNaN(price) || price <= 0) rowError = `售价无效：${priceRaw}`
    }

    if (barcode && !seenBarcodes.has(barcode)) seenBarcodes.set(barcode, rowNum)

    const sellPrice = parseFloat(priceRaw) || 0
    const status: 'ACTIVE' | 'DISABLED' = statusRaw === 'DISABLED' ? 'DISABLED' : 'ACTIVE'

    // 分类解析：表格 → 自动识别 → 无
    let resolvedL1: string | null = null
    let resolvedL2: string | null = null
    let catSource: 'MANUAL' | 'AUTO' | 'NONE' = 'NONE'

    if (cat1Raw) {
      // 表格有填写
      resolvedL1 = cat1Raw
      resolvedL2 = cat2Raw || null
      catSource = 'MANUAL'
    } else if (name) {
      // 尝试关键词自动识别
      const hint = hintCategory(name)
      if (hint) {
        resolvedL1 = hint.l1
        resolvedL2 = hint.l2
        catSource = 'AUTO'
      }
    }

    preview.push({
      rowNum,
      barcode,
      sku,
      name,
      spec,
      sellPrice,
      status,
      category1Raw: cat1Raw,
      category2Raw: cat2Raw,
      resolvedL1,
      resolvedL2,
      catSource,
      isDuplicate: false, // 下面批量查库后更新
      error: rowError,
    })
  }

  if (preview.length === 0) {
    return NextResponse.json({ error: 'EMPTY_FILE', message: '文件中无有效数据行' }, { status: 400 })
  }

  // 批量查库：标记已存在的条码
  const validBarcodes = preview.filter((r) => !r.error).map((r) => r.barcode)
  if (validBarcodes.length > 0) {
    const existing = await prisma.product.findMany({
      where: { tenantId: ctx.tenantId, barcode: { in: validBarcodes } },
      select: { barcode: true },
    })
    const existingSet = new Set(existing.map((p) => p.barcode))
    for (const row of preview) {
      if (!row.error && existingSet.has(row.barcode)) {
        row.isDuplicate = true
        row.error = '条码已存在（请手动修改）'
      }
    }
  }

  return NextResponse.json({ preview })
}
