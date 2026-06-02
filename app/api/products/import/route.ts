/**
 * GET  /api/products/import  — 下载导入模板
 * POST /api/products/import  — 解析 Excel，返回导入预览（不写库）
 *
 * 仅 OWNER 可用。
 *
 * 模板字段（v2）：barcode, sku, name_zh, name_en, name_km,
 *   desc_zh, desc_en, desc_km, spec, sell_price, status, image_url, category1, category2
 * 兼容旧模板：name 列 → nameZh；sellPrice 列 → sell_price
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

const TEMPLATE_HEADER = [
  'barcode', 'sku', 'name_zh', 'name_en', 'name_km',
  'desc_zh', 'desc_en', 'desc_km',
  'spec', 'sell_price', 'status', 'image_url', 'category1', 'category2',
]
const TEMPLATE_SAMPLE = [
  '1234567890123', 'SKU001', '冰美式', 'Iced Americano', 'អាមេរិកាណូ',
  '浓缩咖啡加冰水', 'Strong espresso with ice', '',
  'Large', '4.50', 'ACTIVE', 'https://example.com/img.jpg', '咖啡', '冰咖啡',
]
const TEMPLATE_SAMPLE2 = [
  '9876543210987', 'SKU002', '抹茶拿铁', 'Matcha Latte', 'ម៉ាចា',
  '', '', '',
  '', '5.00', 'ACTIVE', '', '咖啡', '特色饮品',
]
const TEMPLATE_SAMPLE3 = [
  '1111111111111', '', '矿泉水', 'Water', '',
  '', '', '',
  '500ml', '1.00', 'ACTIVE', '', '', '',
]
const TEMPLATE_COL_WIDTHS = [
  { wch: 18 }, // barcode
  { wch: 10 }, // sku
  { wch: 18 }, // name_zh
  { wch: 22 }, // name_en
  { wch: 20 }, // name_km
  { wch: 20 }, // desc_zh
  { wch: 24 }, // desc_en
  { wch: 20 }, // desc_km
  { wch: 12 }, // spec
  { wch: 10 }, // sell_price
  { wch: 10 }, // status
  { wch: 50 }, // image_url
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
  name: string          // 写入 Product.name 的主名（nameZh ?? nameEn ?? nameKm）
  nameZh: string | null
  nameEn: string | null
  nameKm: string | null
  descZh: string | null
  descEn: string | null
  descKm: string | null
  spec: string | null
  sellPrice: number
  status: 'ACTIVE' | 'DISABLED'
  statusProvided?: boolean
  imageUrl: string | null
  category1Raw: string
  category2Raw: string
  resolvedL1: string | null
  resolvedL2: string | null
  catSource: 'MANUAL' | 'AUTO' | 'NONE'
  isDuplicate: boolean
  error: string | null
  confidence?: number   // AI 识别专用
  warnings?: string[]   // AI 识别专用
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
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE', message: '文件不能超过 5MB' }, { status: 400 })
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

  // 识别表头列位置（新旧模板均支持）
  const headerRow = (rows[0] as unknown[]).map((h) => String(h).trim().toLowerCase())
  const col = {
    barcode:   findCol(headerRow, 'barcode', '条码', '商品条码', '条形码'),
    sku:       findCol(headerRow, 'sku'),
    // 新模板优先，旧模板 name 列兼容为 nameZh
    nameZh:    findCol(headerRow, 'name_zh', '中文名', '名称_中文', 'name', '商品名', '商品名称', '名称'),
    nameEn:    findCol(headerRow, 'name_en', '英文名', '名称_英文'),
    nameKm:    findCol(headerRow, 'name_km', '柬文名', '名称_柬文'),
    descZh:    findCol(headerRow, 'desc_zh', 'description', '描述', '商品描述', '中文描述'),
    descEn:    findCol(headerRow, 'desc_en', '英文描述'),
    descKm:    findCol(headerRow, 'desc_km', '柬文描述'),
    spec:      findCol(headerRow, 'spec', '规格'),
    sellPrice: findCol(headerRow, 'sell_price', 'sellprice', '售价', '价格', '单价', '销售单价'),
    status:    findCol(headerRow, 'status', '状态'),
    imageUrl:  findCol(headerRow, 'image_url', 'imageurl', 'image', 'photo_url', 'main_image_url', 'mainimageurl', '图片', '商品图片', '主图', '图片链接', '图片地址', '主图地址', '商品主图'),
    category1: findCol(headerRow, 'category1', 'cat1', '一级分类', '大类', '分类'),
    category2: findCol(headerRow, 'category2', 'cat2', '二级分类', '小类', '子分类'),
  }

  // barcode 和 sellPrice 必须存在；name 至少一个语言版本必须存在
  const hasName = col.nameZh >= 0 || col.nameEn >= 0 || col.nameKm >= 0
  if (col.barcode === -1 || col.sellPrice === -1 || !hasName) {
    const missing: string[] = []
    if (col.barcode === -1) missing.push('barcode（条码）')
    if (col.sellPrice === -1) missing.push('sell_price（售价）')
    if (!hasName) missing.push('name_zh / name_en / name_km（至少一个名称列）')
    return NextResponse.json(
      { error: 'INVALID_HEADER', message: `缺少必需列：${missing.join('、')}` },
      { status: 400 },
    )
  }

  // 逐行解析
  const preview: PreviewRow[] = []
  const seenBarcodes = new Map<string, number>()

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    const rowNum = i + 1

    const rawBarcode = String(row[col.barcode] ?? '').trim()
    const sku        = col.sku >= 0 ? String(row[col.sku] ?? '').trim() || null : null
    const barcode    = rawBarcode || sku || `GEN-${Date.now().toString(36).toUpperCase()}-${i}`
    const priceRaw = String(row[col.sellPrice] ?? '').trim()
    const nameZh   = col.nameZh  >= 0 ? String(row[col.nameZh]  ?? '').trim() || null : null
    const nameEn   = col.nameEn  >= 0 ? String(row[col.nameEn]  ?? '').trim() || null : null
    const nameKm   = col.nameKm  >= 0 ? String(row[col.nameKm]  ?? '').trim() || null : null
    const descZh   = col.descZh  >= 0 ? String(row[col.descZh]  ?? '').trim() || null : null
    const descEn   = col.descEn  >= 0 ? String(row[col.descEn]  ?? '').trim() || null : null
    const descKm   = col.descKm  >= 0 ? String(row[col.descKm]  ?? '').trim() || null : null
    const spec     = col.spec     >= 0 ? String(row[col.spec]    ?? '').trim() || null : null
    const imageUrl = col.imageUrl >= 0 ? String(row[col.imageUrl]?? '').trim() || null : null
    const statusCell = col.status >= 0 ? String(row[col.status] ?? '').trim() : ''
    const statusRaw = statusCell ? statusCell.toUpperCase() : 'ACTIVE'
    const statusProvided = !!statusCell
    const cat1Raw  = col.category1 >= 0 ? String(row[col.category1] ?? '').trim() : ''
    const cat2Raw  = col.category2 >= 0 ? String(row[col.category2] ?? '').trim() : ''

    // 主名（Product.name）= 最优先的非空语言
    const primaryName = nameZh || nameEn || nameKm || ''

    // 跳过完全空行
    if (!barcode && !primaryName && !priceRaw) continue

    // 行级错误校验
    let rowError: string | null = null
    if (!primaryName) {
      rowError = '商品名不能为空（需要 name_zh / name_en / name_km 其中之一）'
    } else if (seenBarcodes.has(barcode)) {
      rowError = `文件内条码重复（第 ${seenBarcodes.get(barcode)} 行）`
    } else {
      const price = parseFloat(priceRaw)
      if (isNaN(price) || price <= 0) rowError = `售价无效：${priceRaw}`
    }

    if (barcode && !seenBarcodes.has(barcode)) seenBarcodes.set(barcode, rowNum)

    const sellPrice = parseFloat(priceRaw) || 0
    const status: 'ACTIVE' | 'DISABLED' = statusRaw === 'DISABLED' ? 'DISABLED' : 'ACTIVE'

    // 分类解析：表格手填 → 自动识别 → 无
    let resolvedL1: string | null = null
    let resolvedL2: string | null = null
    let catSource: 'MANUAL' | 'AUTO' | 'NONE' = 'NONE'

    if (cat1Raw) {
      resolvedL1 = cat1Raw
      resolvedL2 = cat2Raw || null
      catSource = 'MANUAL'
    } else if (primaryName) {
      const hint = hintCategory(primaryName)
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
      name:    primaryName,
      nameZh,
      nameEn,
      nameKm,
      descZh,
      descEn,
      descKm,
      spec,
      sellPrice,
      status,
      statusProvided,
      imageUrl,
      category1Raw: cat1Raw,
      category2Raw: cat2Raw,
      resolvedL1,
      resolvedL2,
      catSource,
      isDuplicate: false,
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
        // no error — confirm step will UPDATE existing product instead of creating
      }
    }
  }

  return NextResponse.json({ preview })
}
