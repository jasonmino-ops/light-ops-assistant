import { posix as path } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { Unzip, UnzipInflate, strFromU8 } from 'fflate'
import * as XLSX from 'xlsx'
import {
  PRODUCT_IMPORT_MAX_IMAGES,
  type ParsedProductImportRow,
  type ProductImportField,
  type ProductImportFieldMapping,
  type ProductImportFormat,
  type ProductImportImageCandidate,
  type ProductImportIssue,
  type ProductImportParseResult,
  type SpreadsheetInspectionSheet,
} from './contract'
import { stableRowIdentity } from './barcode'

const MAX_ZIP_ENTRIES = 10_000
const MAX_ZIP_ENTRY_BYTES = 32 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 192 * 1024 * 1024
const MAX_HEADER_SCAN_ROWS = 10
const MAX_WORKSHEET_ROWS = 500_000
const MAX_WORKSHEET_COLUMNS = 512
const MAX_WORKSHEET_CELL_AREA = 5_000_000
const MAX_WORKBOOK_SHEETS = 64
const MAX_WORKBOOK_CELL_AREA = 10_000_000

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
})

const FIELD_ALIASES: Record<ProductImportField, string[]> = {
  barcode: ['barcode', '条码', '商品条码', '条形码', 'product barcode', 'ean', 'ean13'],
  sku: ['sku', '商品编码', '货号', 'item code', 'product code'],
  nameZh: ['name_zh', '中文名', '名称_中文', 'name', '商品名', '商品名称', '名称', '品名'],
  nameEn: ['name_en', '英文名', '名称_英文', 'english name', 'product name'],
  nameKm: ['name_km', '柬文名', '名称_柬文', 'khmer name', 'ឈ្មោះទំនិញ'],
  descZh: ['desc_zh', 'description', '描述', '商品描述', '中文描述'],
  descEn: ['desc_en', '英文描述', 'english description'],
  descKm: ['desc_km', '柬文描述', 'khmer description'],
  spec: ['spec', '规格', '型号', 'size', 'unit'],
  sellPrice: ['sell_price', 'sellprice', '售价', '价格', '单价', '销售单价', 'price', 'retail price'],
  status: ['status', '状态'],
  imageUrl: ['image_url', 'imageurl', 'image', 'photo_url', 'main_image_url', 'mainimageurl', '图片', '商品图片', '主图', '图片链接', '图片地址', '主图地址', '商品主图'],
  category1: ['category1', 'cat1', '一级分类', '大类', '分类', 'category', 'main category'],
  category2: ['category2', 'cat2', '二级分类', '小类', '子分类', 'subcategory', 'sub category'],
}

export type OfficeEntries = Map<string, Uint8Array>
type DrawingImageMap = Map<string, ProductImportImageCandidate[]>
export type SpreadsheetParseCursor = { sheetIndex: number; rowIndex: number }
export type SpreadsheetBatchParseResult = ProductImportParseResult & {
  nextCursor: SpreadsheetParseCursor | null
  complete: boolean
}

function arrays<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function normalizeHeader(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('und').replace(/[\s_-]+/g, '')
}

function isSafeZipPath(name: string): boolean {
  const normalized = name.replace(/\\/g, '/')
  return !normalized.startsWith('/') && !normalized.split('/').includes('..')
}

function isRelevantOfficeEntry(name: string): boolean {
  return name.endsWith('.xml') || name.endsWith('.rels') || name.startsWith('xl/media/') || name.startsWith('xl/embeddings/')
}

function concatChunks(chunks: Uint8Array[], length: number): Uint8Array {
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

/** Bounded streaming extraction prevents a compressed workbook from expanding without limits. */
export function unzipOfficeEntries(buffer: Buffer): OfficeEntries {
  const entries: OfficeEntries = new Map()
  let entryCount = 0
  let extractedBytes = 0
  let failure: Error | null = null

  const unzipper = new Unzip((file) => {
    entryCount += 1
    if (failure) return
    if (entryCount > MAX_ZIP_ENTRIES) {
      failure = new Error('XLSX_ZIP_ENTRY_LIMIT')
      return
    }
    if (!isSafeZipPath(file.name)) {
      failure = new Error('XLSX_ZIP_PATH_INVALID')
      return
    }
    const relevant = isRelevantOfficeEntry(file.name)
    if (file.originalSize != null && file.originalSize > MAX_ZIP_ENTRY_BYTES) {
      failure = new Error('XLSX_ZIP_ENTRY_TOO_LARGE')
      return
    }

    const chunks: Uint8Array[] = []
    let length = 0
    file.ondata = (error, chunk, final) => {
      if (failure) return
      if (error) {
        failure = new Error('XLSX_ZIP_DECOMPRESSION_FAILED')
        file.terminate()
        return
      }
      length += chunk.length
      extractedBytes += chunk.length
      if (length > MAX_ZIP_ENTRY_BYTES || extractedBytes > MAX_EXTRACTED_BYTES) {
        failure = new Error('XLSX_ZIP_DECOMPRESSED_LIMIT')
        file.terminate()
        return
      }
      if (relevant) chunks.push(chunk)
      if (final && relevant) entries.set(file.name, concatChunks(chunks, length))
    }
    file.start()
  })
  unzipper.register(UnzipInflate)
  try {
    unzipper.push(new Uint8Array(buffer), true)
  } catch {
    if (!failure) failure = new Error('XLSX_ZIP_DECOMPRESSION_FAILED')
  }
  if (failure) throw failure
  return entries
}

function parseXml(entries: OfficeEntries, entryPath: string): Record<string, unknown> | null {
  const bytes = entries.get(entryPath)
  if (!bytes) return null
  if (bytes.length > MAX_ZIP_ENTRY_BYTES) throw new Error('XLSX_XML_TOO_LARGE')
  const xml = strFromU8(bytes)
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XLSX_XML_ENTITY_UNSUPPORTED')
  return xmlParser.parse(xml) as Record<string, unknown>
}

function relationshipMap(entries: OfficeEntries, relsPath: string, baseDir: string): Map<string, string> {
  const parsed = parseXml(entries, relsPath) as { Relationships?: { Relationship?: unknown } } | null
  const result = new Map<string, string>()
  for (const relation of arrays(parsed?.Relationships?.Relationship as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    const id = String(relation['@_Id'] ?? relation['@_id'] ?? '')
    const target = String(relation['@_Target'] ?? relation['@_target'] ?? '')
    const targetMode = String(relation['@_TargetMode'] ?? relation['@_targetMode'] ?? '')
    if (!id || !target || targetMode.toLowerCase() === 'external') continue
    const normalized = path.normalize(path.join(baseDir, target)).replace(/^\.\//, '')
    if (isSafeZipPath(normalized)) result.set(id, normalized)
  }
  return result
}

function mediaTypeForPath(mediaPath: string): string | null {
  const ext = path.extname(mediaPath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff'
  if (ext === '.avif') return 'image/avif'
  if (ext === '.emf') return 'image/emf'
  if (ext === '.wmf') return 'image/wmf'
  return null
}

function cellValue(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node === 'object' && '#text' in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>)['#text'] ?? '')
  }
  return ''
}

function drawingImages(entries: OfficeEntries, sheetCount: number): DrawingImageMap {
  const result: DrawingImageMap = new Map()
  const workbook = parseXml(entries, 'xl/workbook.xml') as {
    workbook?: { sheets?: { sheet?: unknown } }
  } | null
  const workbookRels = relationshipMap(entries, 'xl/_rels/workbook.xml.rels', 'xl')
  const workbookSheets = arrays(workbook?.workbook?.sheets?.sheet as Record<string, unknown> | Record<string, unknown>[] | undefined)

  for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
    const workbookSheet = workbookSheets[sheetIndex]
    const relId = workbookSheet ? String(workbookSheet['@_id'] ?? workbookSheet['@_r:id'] ?? '') : ''
    const worksheetPath = workbookRels.get(relId) ?? `xl/worksheets/sheet${sheetIndex + 1}.xml`
    const worksheet = parseXml(entries, worksheetPath) as { worksheet?: { drawing?: Record<string, unknown> } } | null
    const drawingRelId = String(worksheet?.worksheet?.drawing?.['@_id'] ?? worksheet?.worksheet?.drawing?.['@_r:id'] ?? '')
    if (!drawingRelId) continue

    const worksheetRelsPath = path.join(path.dirname(worksheetPath), '_rels', `${path.basename(worksheetPath)}.rels`)
    const worksheetRels = relationshipMap(entries, worksheetRelsPath, path.dirname(worksheetPath))
    const drawingPath = worksheetRels.get(drawingRelId)
    if (!drawingPath) continue

    const drawing = parseXml(entries, drawingPath) as { wsDr?: Record<string, unknown> } | null
    const drawingRelsPath = path.join(path.dirname(drawingPath), '_rels', `${path.basename(drawingPath)}.rels`)
    const drawingRels = relationshipMap(entries, drawingRelsPath, path.dirname(drawingPath))
    const anchors = [
      ...arrays(drawing?.wsDr?.oneCellAnchor as Record<string, unknown> | Record<string, unknown>[] | undefined),
      ...arrays(drawing?.wsDr?.twoCellAnchor as Record<string, unknown> | Record<string, unknown>[] | undefined),
    ]

    for (const anchor of anchors) {
      const from = anchor.from as Record<string, unknown> | undefined
      const rowZeroBased = Number(cellValue(from?.row))
      const picture = anchor.pic as Record<string, unknown> | undefined
      const fill = picture?.blipFill as Record<string, unknown> | undefined
      const blip = fill?.blip as Record<string, unknown> | undefined
      const imageRelId = String(blip?.['@_embed'] ?? blip?.['@_r:embed'] ?? '')
      const mediaPath = drawingRels.get(imageRelId)
      if (!Number.isInteger(rowZeroBased) || rowZeroBased < 0 || !mediaPath) continue
      const key = `${sheetIndex}:${rowZeroBased + 1}`
      const candidates = result.get(key) ?? []
      candidates.push({
        kind: 'XLSX_EMBEDDED',
        source: mediaPath,
        mediaType: mediaTypeForPath(mediaPath),
        relationshipId: imageRelId,
      })
      result.set(key, candidates)
    }
  }
  return result
}

const MAX_CELL_CHARS = 4_096
const MAX_SOURCE_PAYLOAD_CHARS = 64 * 1_024

function boundedCellText(value: string, barcode: boolean): string {
  const limit = barcode ? 128 : MAX_CELL_CHARS
  return value.slice(0, limit + 1).trim().slice(0, limit)
}

function safeCellString(sheet: XLSX.WorkSheet, row: number, column: number, barcode = false): string {
  if (column < 0) return ''
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined
  if (!cell || cell.v == null) return ''
  if (barcode && typeof cell.v === 'number' && Number.isFinite(cell.v)) {
    const formatted = typeof cell.w === 'string' ? boundedCellText(cell.w, true) : ''
    if (formatted && !/[eE][+-]?\d+/.test(formatted)) return formatted
    return boundedCellText(Number.isInteger(cell.v) ? cell.v.toFixed(0) : String(cell.v), true)
  }
  if (typeof cell.w === 'string') return boundedCellText(cell.w, barcode)
  return boundedCellText(String(cell.v), barcode)
}

function safeWorksheetRange(sheet: XLSX.WorkSheet): XLSX.Range | null {
  if (!sheet['!ref']) return null
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const rowCount = range.e.r - range.s.r + 1
  const columnCount = range.e.c - range.s.c + 1
  if (
    rowCount <= 0
    || columnCount <= 0
    || rowCount > MAX_WORKSHEET_ROWS
    || columnCount > MAX_WORKSHEET_COLUMNS
    || range.e.c + 1 > MAX_WORKSHEET_COLUMNS
    || rowCount * columnCount > MAX_WORKSHEET_CELL_AREA
  ) {
    throw new Error('XLSX_WORKSHEET_DIMENSION_LIMIT')
  }
  return range
}

function worksheetRowValues(sheet: XLSX.WorkSheet, row: number, range: XLSX.Range): string[] {
  // Preserve absolute worksheet column indexes. An imported table may start
  // in column B or later, while both deterministic and AI mappings use the
  // real zero-based worksheet column index.
  const values: string[] = Array.from({ length: range.e.c + 1 }, () => '')
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    values[column] = safeCellString(sheet, row, column)
  }
  return values
}

function deterministicMapping(headers: string[]): ProductImportFieldMapping | null {
  const normalized = headers.map(normalizeHeader)
  const mapping: ProductImportFieldMapping = {}
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as Array<[ProductImportField, string[]]>) {
    const aliasSet = new Set(aliases.map(normalizeHeader))
    const matches = normalized
      .map((header, index) => aliasSet.has(header) ? index : -1)
      .filter((index) => index >= 0)
    if (matches.length === 1) mapping[field] = matches[0]
  }
  const hasName = mapping.nameZh != null || mapping.nameEn != null || mapping.nameKm != null
  return hasName && mapping.sellPrice != null ? mapping : null
}

function inspectSheet(sheet: XLSX.WorkSheet, sheetIndex: number, sheetName: string): SpreadsheetInspectionSheet {
  const range = safeWorksheetRange(sheet)
  let best: { row: number; headers: string[]; mapping: ProductImportFieldMapping; score: number } | null = null
  let fallback: { row: number; headers: string[] } | null = null
  const candidateRows: SpreadsheetInspectionSheet['candidateRows'] = []
  const scanEnd = range ? Math.min(range.e.r, range.s.r + MAX_HEADER_SCAN_ROWS - 1) : -1
  for (let row = range?.s.r ?? 0; row <= scanEnd; row += 1) {
    const headers = worksheetRowValues(sheet, row, range!)
    candidateRows.push({
      rowNumber: row + 1,
      cells: headers.flatMap((value, columnIndex) => value.trim() ? [{ columnIndex, value }] : []),
    })
    if (!fallback && headers.some((value) => value.trim())) fallback = { row, headers }
    const mapping = deterministicMapping(headers)
    if (!mapping) continue
    const score = Object.keys(mapping).length
    if (!best || score > best.score) best = { row, headers, mapping, score }
  }
  const fallbackHeaders = fallback?.headers ?? []
  const headerRow = best?.row ?? fallback?.row ?? -1
  const sampleRows: string[][] = []
  if (range && headerRow >= 0) {
    for (let row = headerRow + 1; row <= Math.min(range.e.r, headerRow + 3); row += 1) {
      sampleRows.push(worksheetRowValues(sheet, row, range))
    }
  }
  return {
    sheetIndex,
    sheetName,
    maxRowNumber: range ? range.e.r + 1 : 0,
    maxColumnIndex: range ? range.e.c : -1,
    headerRowNumber: headerRow >= 0 ? headerRow + 1 : null,
    headers: best?.headers ?? fallbackHeaders,
    sampleRows,
    candidateRows,
    deterministicMapping: best?.mapping ?? null,
  }
}

function inspectWorkbook(workbook: XLSX.WorkBook) {
  if (workbook.SheetNames.length > MAX_WORKBOOK_SHEETS) throw new Error('XLSX_WORKBOOK_SHEET_LIMIT')
  let totalCellArea = 0
  return workbook.SheetNames.map((sheetName, sheetIndex) => {
    const sheet = workbook.Sheets[sheetName]
    const range = safeWorksheetRange(sheet)
    if (range) {
      totalCellArea += (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1)
      if (totalCellArea > MAX_WORKBOOK_CELL_AREA) throw new Error('XLSX_WORKBOOK_CELL_LIMIT')
    }
    return inspectSheet(sheet, sheetIndex, sheetName)
  })
}

function optional(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function parsePrice(value: string): number {
  const normalized = value.normalize('NFKC').replace(/[,\s$៛€£¥]/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0
}

function unsupportedImageIssue(candidate: ProductImportImageCandidate): ProductImportIssue | null {
  if (candidate.mediaType && !['image/emf', 'image/wmf'].includes(candidate.mediaType)) return null
  return {
    code: 'UNSUPPORTED_IMAGE_FORMAT',
    field: 'images',
    message: `不支持的内嵌图片格式：${candidate.source}`,
    blocking: true,
  }
}

export function inspectSpreadsheetBuffer(buffer: Buffer, format: Exclude<ProductImportFormat, 'PDF'>) {
  // Preflight OOXML before SheetJS sees the archive. The streaming pass bounds
  // every entry (including unknown entries), total expansion and path names.
  if (format === 'XLSX') unzipOfficeEntries(buffer)
  const workbook = XLSX.read(buffer, { type: 'buffer', cellText: true, cellNF: true, raw: true })
  return inspectWorkbook(workbook)
}

export function parseSpreadsheetBuffer(
  buffer: Buffer,
  format: Exclude<ProductImportFormat, 'PDF'>,
  aiMappings: Partial<Record<number, { headerRowNumber: number; mapping: ProductImportFieldMapping; selected?: boolean }>> = {},
  options: {
    cursor?: SpreadsheetParseCursor | null
    maxRows?: number
    maxScannedRows?: number
    startOrdinal?: number
  } = {},
): SpreadsheetBatchParseResult {
  let entries: OfficeEntries | null = null
  if (format === 'XLSX') entries = unzipOfficeEntries(buffer)
  const workbook = XLSX.read(buffer, { type: 'buffer', cellText: true, cellNF: true, raw: true })
  const sheets = inspectWorkbook(workbook)
  let images: DrawingImageMap = new Map()
  let wpsUnsupported = false
  let officeEmbeddedUnsupported = false
  if (entries) {
    images = drawingImages(entries, workbook.SheetNames.length)
    wpsUnsupported = entries.has('xl/cellimages.xml') || [...entries.entries()].some(
      ([name, bytes]) => (name.startsWith('xl/worksheets/') || name === 'xl/sharedStrings.xml') && strFromU8(bytes).includes('DISPIMG'),
    )
    officeEmbeddedUnsupported = [...entries.keys()].some((name) => name.startsWith('xl/embeddings/'))
      || [...entries.entries()].some(
        ([name, bytes]) => name.startsWith('xl/worksheets/') && /<(?:\w+:)?oleObjects?\b/i.test(strFromU8(bytes)),
      )
  }

  const rows: ParsedProductImportRow[] = []
  const warnings: ProductImportIssue[] = []
  let sourceOrdinal = options.startOrdinal ?? 0
  const maxRows = options.maxRows ?? Number.MAX_SAFE_INTEGER
  const maxScannedRows = options.maxScannedRows ?? Number.MAX_SAFE_INTEGER
  let scannedRows = 0
  let nextCursor: SpreadsheetParseCursor | null = null
  let complete = true
  parseSheets:
  for (const inspection of sheets) {
    if (options.cursor && inspection.sheetIndex < options.cursor.sheetIndex) continue
    const sheet = workbook.Sheets[inspection.sheetName]
    const aiMapping = aiMappings[inspection.sheetIndex]
    if (aiMapping?.selected === false) {
      warnings.push({
        code: 'SHEET_SKIPPED',
        message: `工作表「${inspection.sheetName}」未被选为商品数据表，不会导入`,
        blocking: false,
      })
      continue
    }
    const headerRowNumber = aiMapping?.headerRowNumber ?? inspection.headerRowNumber
    const mapping = aiMapping?.mapping ?? inspection.deterministicMapping
    if (!headerRowNumber || !mapping) {
      if (inspection.headers.length > 0) {
        warnings.push({
          code: 'AI_MAPPING_REQUIRED',
          message: `工作表「${inspection.sheetName}」需要 AI 确认表头映射`,
          blocking: true,
        })
      }
      continue
    }
    const range = safeWorksheetRange(sheet)
    if (!range) continue
    const headerRowIndex = headerRowNumber - 1
    if (headerRowIndex < range.s.r || headerRowIndex > range.e.r) {
      warnings.push({
        code: 'AI_MAPPING_FAILED',
        message: `工作表「${inspection.sheetName}」的表头行超出有效范围`,
        blocking: true,
      })
      continue
    }
    const headers = worksheetRowValues(sheet, headerRowIndex, range)
    const firstRowIndex = options.cursor?.sheetIndex === inspection.sheetIndex
      ? Math.max(headerRowIndex + 1, options.cursor.rowIndex)
      : headerRowIndex + 1
    for (let rowIndex = firstRowIndex; rowIndex <= range.e.r; rowIndex += 1) {
      if (rows.length >= maxRows || scannedRows >= maxScannedRows) {
        nextCursor = { sheetIndex: inspection.sheetIndex, rowIndex }
        complete = false
        break parseSheets
      }
      scannedRows += 1
      const get = (field: ProductImportField, barcode = false) => {
        const column = mapping[field]
        return column == null ? '' : safeCellString(sheet, rowIndex, column, barcode)
      }
      let sourcePayloadBudget = MAX_SOURCE_PAYLOAD_CHARS
      const sourceValues = headers.reduce<Record<string, unknown>>((result, header, column) => {
        if (sourcePayloadBudget <= 0) return result
        const key = header.trim() || `column_${column + 1}`
        const value = safeCellString(sheet, rowIndex, column).slice(0, sourcePayloadBudget)
        sourcePayloadBudget -= Math.min(sourcePayloadBudget, key.length + value.length)
        result[key.slice(0, 512)] = value
        return result
      }, {})
      const rawBarcode = optional(get('barcode', true))
      const nameZh = optional(get('nameZh'))
      const nameEn = optional(get('nameEn'))
      const nameKm = optional(get('nameKm'))
      const name = nameZh ?? nameEn ?? nameKm ?? ''
      const priceText = get('sellPrice')
      const sellPrice = parsePrice(priceText)
      const sku = optional(get('sku'))
      if (!rawBarcode && !sku && !name && !priceText.trim()) continue

      sourceOrdinal += 1
      const rowNumber = rowIndex + 1
      const rowImages = [...(images.get(`${inspection.sheetIndex}:${rowNumber}`) ?? [])]
      const externalImage = optional(get('imageUrl'))
      if (externalImage) rowImages.push({ kind: 'EXTERNAL_URL', source: externalImage, mediaType: null })
      const issues: ProductImportIssue[] = []
      if (!name) issues.push({ code: 'MISSING_NAME', field: 'name', message: '商品名不能为空', blocking: true })
      if (!(sellPrice > 0)) issues.push({ code: 'INVALID_PRICE', field: 'sellPrice', message: `售价无效：${priceText}`, blocking: true })
      for (const image of rowImages) {
        const issue = unsupportedImageIssue(image)
        if (issue) issues.push(issue)
      }
      if (rowImages.length > PRODUCT_IMPORT_MAX_IMAGES) {
        issues.push({ code: 'TOO_MANY_IMAGES', field: 'images', message: `每个商品最多 ${PRODUCT_IMPORT_MAX_IMAGES} 张图片`, blocking: true })
      }
      if (wpsUnsupported) {
        issues.push({
          code: 'UNSUPPORTED_IMAGE_FORMAT',
          field: 'images',
          message: '检测到 WPS cellimages.xml / DISPIMG，V0.1 不支持该图片合同',
          blocking: true,
        })
      }
      if (officeEmbeddedUnsupported) {
        issues.push({
          code: 'UNSUPPORTED_IMAGE_FORMAT',
          field: 'images',
          message: '检测到 Office OLE / embedded object，V0.1 不支持该图片合同',
          blocking: true,
        })
      }

      const statusText = get('status').trim().toUpperCase()
      rows.push({
        sourceOrdinal,
        stableSourceRowIdentity: stableRowIdentity(['spreadsheet-row-v1', inspection.sheetIndex, rowNumber]),
        coordinate: { sheetIndex: inspection.sheetIndex, sheetName: inspection.sheetName, rowNumber },
        sourcePayload: sourceValues,
        product: {
          barcode: rawBarcode,
          sku,
          name,
          nameZh,
          nameEn,
          nameKm,
          descZh: optional(get('descZh')),
          descEn: optional(get('descEn')),
          descKm: optional(get('descKm')),
          spec: optional(get('spec')),
          sellPrice,
          status: statusText === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
          statusProvided: !!statusText,
          category1: optional(get('category1')),
          category2: optional(get('category2')),
          categoryId: null,
        },
        images: rowImages.slice(0, PRODUCT_IMPORT_MAX_IMAGES),
        issues,
      })
    }
  }

  const barcodeRows = new Map<string, ParsedProductImportRow[]>()
  for (const row of rows) {
    if (!row.product.barcode) continue
    const matches = barcodeRows.get(row.product.barcode) ?? []
    matches.push(row)
    barcodeRows.set(row.product.barcode, matches)
  }
  for (const [barcode, duplicates] of barcodeRows) {
    if (duplicates.length < 2) continue
    const coordinates = duplicates.map((row) => row.coordinate.rowNumber ?? row.sourceOrdinal).join(', ')
    for (const row of duplicates) {
      row.issues.push({
        code: 'DUPLICATE_BARCODE_IN_FILE',
        field: 'barcode',
        message: `文件内条码 ${barcode} 重复（行 ${coordinates}）`,
        blocking: true,
      })
    }
  }

  if (wpsUnsupported) {
    warnings.push({
      code: 'UNSUPPORTED_IMAGE_FORMAT',
      message: '检测到 WPS cellimages.xml / DISPIMG；V0.1 必须改用标准 XLSX Drawing 图片或人工处理',
      blocking: true,
    })
  }
  if (officeEmbeddedUnsupported) {
    warnings.push({
      code: 'UNSUPPORTED_IMAGE_FORMAT',
      message: '检测到 Office OLE / embedded object；V0.1 必须改用标准 XLSX Drawing 图片或人工处理',
      blocking: true,
    })
  }
  return { rows, sheets, warnings, nextCursor, complete }
}

export function extractEmbeddedImage(entries: OfficeEntries, sourcePath: string): Buffer {
  const bytes = entries.get(sourcePath)
  if (!bytes) throw new Error('EMBEDDED_IMAGE_NOT_FOUND')
  return Buffer.from(bytes)
}
