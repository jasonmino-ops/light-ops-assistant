import * as XLSX from 'xlsx'

export const PRODUCT_IMPORT_FIELDS = [
  'barcode', 'sku', 'nameZh', 'nameEn', 'nameKm',
  'descZh', 'descEn', 'descKm', 'spec', 'sellPrice', 'status',
  'imageUrl', 'imageUrls', 'category1', 'category2',
] as const

export type ProductImportField = typeof PRODUCT_IMPORT_FIELDS[number]
export type ProductImportColumnMapping = Partial<Record<ProductImportField, number | null>>

export type ProductImportPreviewRow = {
  rowNum: number
  barcode: string
  sku: string | null
  name: string
  nameZh: string | null
  nameEn: string | null
  nameKm: string | null
  descZh: string | null
  descEn: string | null
  descKm: string | null
  spec: string | null
  sellPrice: number
  status: 'ACTIVE' | 'DISABLED'
  statusProvided: boolean
  imageUrl: string | null
  imageUrls: string[]
  category1Raw: string
  category2Raw: string
  resolvedL1: string | null
  resolvedL2: string | null
  catSource: 'MANUAL' | 'AUTO' | 'NONE'
  isDuplicate: boolean
  duplicateAction: 'CREATE' | 'UPDATE' | 'SKIP'
  error: string | null
  warnings: string[]
  confidence?: number
}

export type ProductSpreadsheetPreview = {
  sheetName: string
  headerRowIndex: number
  headers: string[]
  mapping: ProductImportColumnMapping
  sampleRows: string[][]
  preview: ProductImportPreviewRow[]
}

export type ProductSpreadsheetParseResult =
  | { ok: true; value: ProductSpreadsheetPreview }
  | { ok: false; error: 'PARSE_ERROR' | 'EMPTY_FILE' | 'INVALID_HEADER'; message: string }

const FIELD_ALIASES: Record<ProductImportField, string[]> = {
  barcode: ['barcode', 'ean', 'upc', '条码', '商品条码', '条形码', '商品编号', '产品编码', '货号', '编码', 'បាកូដ'],
  sku: ['sku', '商品sku', '商品 sku', 'stockkeepingunit', '货号', '商品编码', '产品编号', 'លេខកូដ'],
  nameZh: ['namezh', 'name_zh', '中文名', '中文名称', '名称中文', '商品名称中文', '商品名', '商品名称', '名称', '品名', 'name', 'productname', 'itemname', '产品名称', 'ឈ្មោះទំនិញ', 'ឈ្មោះ'],
  nameEn: ['nameen', 'name_en', '英文名', '英文名称', '名称英文', '商品名称英文', 'englishname', 'productnameen'],
  nameKm: ['namekm', 'name_km', '柬文名', '高棉文名', '名称柬文', '商品名称柬文', 'khmername', 'productnamekm'],
  descZh: ['desczh', 'desc_zh', '中文描述', '商品描述', '描述', 'description', '备注', '说明'],
  descEn: ['descen', 'desc_en', '英文描述', 'descriptionen'],
  descKm: ['desckm', 'desc_km', '柬文描述', '高棉文描述', 'descriptionkm'],
  spec: ['spec', '规格', '规格型号', '型号', '单位规格', 'size', 'volume', 'unit'],
  sellPrice: ['sellprice', 'sell_price', 'price', 'retailprice', '售价', '销售价', '销售单价', '零售价', '单价', '价格', '价钱', 'តម្លៃលក់', 'តម្លៃ'],
  status: ['status', '状态', '商品状态', '启用状态', '有效状态', 'ស្ថានភាព'],
  imageUrl: ['imageurl', 'image_url', 'image', 'photo', 'photourl', 'mainimage', 'mainimageurl', '图片', '图片链接', '图片地址', '主图', '主图地址', '商品图片', 'រូបភាព'],
  imageUrls: ['imageurls', 'image_urls', 'images', 'gallery', 'galleryurls', '图片列表', '多图', '图片集', '图库'],
  category1: ['category1', 'cat1', '一级分类', '大类', '主分类', '分类', 'category', '分类一', 'ប្រភេទធំ'],
  category2: ['category2', 'cat2', '二级分类', '小类', '子分类', '分类二', 'subcategory', 'ប្រភេទរង'],
}

function normalized(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_\-()（）【】\[\]：:./\\]/g, '')
}

function nonEmpty(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text || null
}

function firstMatchingColumn(headers: string[], aliases: string[]): number | null {
  const aliasesNormalized = aliases.map(normalized)
  const normalizedHeaders = headers.map(normalized)
  const exact = normalizedHeaders.findIndex((header) => aliasesNormalized.includes(header))
  if (exact >= 0) return exact
  const includes = normalizedHeaders.findIndex((header) => header && aliasesNormalized.some((alias) => header.includes(alias) || alias.includes(header)))
  return includes >= 0 ? includes : null
}

export function detectProductColumnMapping(headers: string[]): ProductImportColumnMapping {
  const mapping: ProductImportColumnMapping = {}
  for (const field of PRODUCT_IMPORT_FIELDS) mapping[field] = firstMatchingColumn(headers, FIELD_ALIASES[field])
  // “图片列表/多图”会包含“图片”这个通用别名；优先把它解释成图库列，避免同一列被读两次。
  if (typeof mapping.imageUrl === 'number' && mapping.imageUrl === mapping.imageUrls) {
    const header = normalized(headers[mapping.imageUrl])
    if (header.includes('列表') || header.includes('多图') || header.includes('图库') || header.includes('gallery') || header.includes('images')) {
      mapping.imageUrl = null
    } else {
      mapping.imageUrls = null
    }
  }
  return mapping
}

export function sanitizeProductColumnMapping(
  mapping: ProductImportColumnMapping | undefined,
  headers: string[],
): ProductImportColumnMapping {
  const detected = detectProductColumnMapping(headers)
  if (!mapping) return detected
  const result: ProductImportColumnMapping = { ...detected }
  for (const field of PRODUCT_IMPORT_FIELDS) {
    const value = mapping[field]
    if (value === null) {
      result[field] = null
    } else if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < headers.length) {
      result[field] = value
    }
  }
  return result
}

function valueAt(row: unknown[], mapping: ProductImportColumnMapping, field: ProductImportField): string | null {
  const index = mapping[field]
  if (typeof index !== 'number') return null
  return nonEmpty(row[index])
}

function parseStatus(value: string | null): { status: 'ACTIVE' | 'DISABLED'; provided: boolean } {
  if (!value) return { status: 'ACTIVE', provided: false }
  const normalizedStatus = normalized(value)
  if (['disabled', 'inactive', '0', 'false', '停用', '禁用', '关闭', '已停用'].includes(normalizedStatus)) {
    return { status: 'DISABLED', provided: true }
  }
  return { status: 'ACTIVE', provided: true }
}

function parseImageUrls(primary: string | null, gallery: string | null): string[] {
  const values = [primary, ...(gallery ? gallery.split(/[|;；\n]/g) : [])]
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const url = String(value ?? '').trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    result.push(url)
    if (result.length === 3) break
  }
  return result
}

function rowHasContent(row: unknown[]): boolean {
  return row.some((cell) => String(cell ?? '').trim() !== '')
}

function findWorksheet(workbook: XLSX.WorkBook): { sheetName: string; rows: unknown[][]; headerRowIndex: number; headers: string[] } | null {
  let best: { sheetName: string; rows: unknown[][]; headerRowIndex: number; headers: string[]; score: number; columnCount: number } | null = null
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '', raw: false })
    const scanLimit = Math.min(rows.length, 20)
    for (let index = 0; index < scanLimit; index++) {
      const headers = (rows[index] as unknown[]).map((value) => String(value ?? '').trim())
      if (!rowHasContent(headers)) continue
      const mapping = detectProductColumnMapping(headers)
      const hasName = mapping.nameZh !== null || mapping.nameEn !== null || mapping.nameKm !== null
      const hasCode = mapping.barcode !== null || mapping.sku !== null
      const hasPrice = mapping.sellPrice !== null
      const score = [hasName, hasCode, hasPrice].filter(Boolean).length
      const columnCount = headers.filter((header) => !!header).length
      // 无法自动识别的第三方表格仍要进入可编辑映射界面；选择识别分数最高、列数最多的一行。
      if (!best || score > best.score || (score === best.score && columnCount > best.columnCount)) {
        best = { sheetName, rows, headerRowIndex: index, headers, score, columnCount }
      }
    }
  }
  return best
}

function invalidHeaderMessage(mapping: ProductImportColumnMapping): string {
  const missing: string[] = []
  if (mapping.nameZh === null && mapping.nameEn === null && mapping.nameKm === null) missing.push('商品名称')
  if (mapping.barcode === null && mapping.sku === null) missing.push('条码或 SKU')
  if (mapping.sellPrice === null) missing.push('售价')
  return `请映射必填字段：${missing.join('、')}`
}

export function parseProductSpreadsheet(
  buffer: Buffer,
  requestedMapping?: ProductImportColumnMapping,
): ProductSpreadsheetParseResult {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', raw: false })
  } catch {
    return { ok: false, error: 'PARSE_ERROR', message: '无法解析文件，请上传有效的 Excel 或 CSV 文件' }
  }
  const found = findWorksheet(workbook)
  if (!found) return { ok: false, error: 'EMPTY_FILE', message: '文件中没有可识别的表头或数据' }

  const mapping = sanitizeProductColumnMapping(requestedMapping, found.headers)
  const hasName = mapping.nameZh !== null || mapping.nameEn !== null || mapping.nameKm !== null
  const hasCode = mapping.barcode !== null || mapping.sku !== null
  const incompleteMappingMessage = !hasName || !hasCode || mapping.sellPrice === null ? invalidHeaderMessage(mapping) : null

  const preview: ProductImportPreviewRow[] = []
  const seenBarcodes = new Map<string, number>()
  const dataRows = found.rows.slice(found.headerRowIndex + 1, found.headerRowIndex + 501)
  for (let offset = 0; offset < dataRows.length; offset++) {
    const row = dataRows[offset] as unknown[]
    if (!rowHasContent(row)) continue
    const rowNum = found.headerRowIndex + offset + 2
    const sku = valueAt(row, mapping, 'sku')
    const barcode = valueAt(row, mapping, 'barcode') || sku || ''
    const nameZh = valueAt(row, mapping, 'nameZh')
    const nameEn = valueAt(row, mapping, 'nameEn')
    const nameKm = valueAt(row, mapping, 'nameKm')
    const name = nameZh || nameEn || nameKm || ''
    const rawPrice = valueAt(row, mapping, 'sellPrice')
    const sellPrice = rawPrice ? Number.parseFloat(rawPrice.replace(/[,\s]/g, '')) : 0
    const imageUrls = parseImageUrls(valueAt(row, mapping, 'imageUrl'), valueAt(row, mapping, 'imageUrls'))
    const parsedStatus = parseStatus(valueAt(row, mapping, 'status'))
    const category1Raw = valueAt(row, mapping, 'category1') || ''
    const category2Raw = valueAt(row, mapping, 'category2') || ''
    const warnings: string[] = []
    let error: string | null = null
    if (incompleteMappingMessage) error = incompleteMappingMessage
    else if (!barcode) error = '条码或 SKU 不能为空'
    else if (!name) error = '商品名不能为空'
    else if (!Number.isFinite(sellPrice) || sellPrice <= 0) error = `售价无效：${rawPrice ?? ''}`
    else if (seenBarcodes.has(barcode)) error = `文件内条码重复（第 ${seenBarcodes.get(barcode)} 行）`
    if (barcode && !seenBarcodes.has(barcode)) seenBarcodes.set(barcode, rowNum)
    if (imageUrls.length === 3 && (valueAt(row, mapping, 'imageUrls') || '').split(/[|;；\n]/g).filter(Boolean).length > 2) {
      warnings.push('最多保留 3 张商品图片')
    }
    preview.push({
      rowNum,
      barcode,
      sku,
      name,
      nameZh,
      nameEn,
      nameKm,
      descZh: valueAt(row, mapping, 'descZh'),
      descEn: valueAt(row, mapping, 'descEn'),
      descKm: valueAt(row, mapping, 'descKm'),
      spec: valueAt(row, mapping, 'spec'),
      sellPrice: Number.isFinite(sellPrice) ? sellPrice : 0,
      status: parsedStatus.status,
      statusProvided: parsedStatus.provided,
      imageUrl: imageUrls[0] ?? null,
      imageUrls,
      category1Raw,
      category2Raw,
      resolvedL1: category1Raw || null,
      resolvedL2: category2Raw || null,
      catSource: category1Raw ? 'MANUAL' : 'NONE',
      isDuplicate: false,
      duplicateAction: 'CREATE',
      error,
      warnings,
    })
  }
  if (preview.length === 0) return { ok: false, error: 'EMPTY_FILE', message: '文件中没有可导入的数据行' }
  return {
    ok: true,
    value: {
      sheetName: found.sheetName,
      headerRowIndex: found.headerRowIndex,
      headers: found.headers,
      mapping,
      sampleRows: dataRows.slice(0, 8).filter((row) => rowHasContent(row as unknown[])).map((row) => (row as unknown[]).map((cell) => String(cell ?? '').slice(0, 120))),
      preview,
    },
  }
}

export const PRODUCT_TEMPLATE_HEADERS = [
  'barcode', 'sku', 'name_zh', 'name_en', 'name_km',
  'desc_zh', 'desc_en', 'desc_km', 'spec', 'sell_price', 'status',
  'image_url', 'image_urls', 'category1', 'category2',
]

export function createProductTemplateWorkbook(): Buffer {
  const rows = [
    PRODUCT_TEMPLATE_HEADERS,
    ['1234567890123', 'SKU001', '冰美式', 'Iced Americano', 'អាមេរិកាណូ', '浓缩咖啡加冰水', 'Strong espresso with ice', '', 'Large', '4.50', 'ACTIVE', 'https://example.com/iced-americano.jpg', 'https://example.com/iced-americano.jpg|https://example.com/iced-americano-detail.jpg', '咖啡', '冰咖啡'],
    ['9876543210987', 'SKU002', '抹茶拿铁', 'Matcha Latte', 'ម៉ាចា', '', '', '', '', '5.00', 'ACTIVE', '', '', '咖啡', '特色饮品'],
  ]
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  worksheet['!cols'] = PRODUCT_TEMPLATE_HEADERS.map((header) => ({ wch: Math.max(12, Math.min(48, header.length + 8)) }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '商品导入模板')
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
}
