/**
 * lib/product-import.ts
 *
 * 共享商品导入解析逻辑。
 * 供 Telegram 文本导入、Excel/CSV 文件导入（webhook）复用，后续 Web 端导入也可调用。
 */

import * as XLSX from 'xlsx'

// ─── 通用类型 ─────────────────────────────────────────────────────────────────

export type TgImportRow = {
  name: string
  barcode: string
  sellPrice: number
  raw: string
}

export type TgParseResult = {
  total: number
  valid: TgImportRow[]
  fieldErrors: Array<{ line: number; raw: string; reason: string }>
  inFileDupes: Array<{ line: number; barcode: string; reason: string }>
}

export type FileParseError = {
  type: 'MISSING_COLS' | 'PARSE_FAILED'
  missing: string[]   // 缺失的字段说明列表
}

export type FileParseResult = TgParseResult | FileParseError

export function isFileParseError(r: FileParseResult): r is FileParseError {
  return 'type' in r
}

// ─── 文本行解析（管道分隔格式） ───────────────────────────────────────────────

/**
 * 解析用户通过 Telegram 发送的商品文本。
 * 每行格式：商品名称 | 条码 | 售价
 * 商品名称支持任意 Unicode（含柬语）。
 */
export function parseProductTextLines(text: string): TgParseResult {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const total = lines.length

  const fieldErrors: TgParseResult['fieldErrors'] = []
  const inFileDupes: TgParseResult['inFileDupes'] = []
  const candidates: Array<{ row: TgImportRow; line: number }> = []
  const barcodeLines = new Map<string, number[]>()

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const parts = raw.split('|').map((p) => p.trim())

    if (parts.length < 3) {
      fieldErrors.push({ line: i + 1, raw, reason: '格式错误（需 3 个字段，用 | 分隔）' })
      continue
    }

    const [name, barcode, priceStr] = parts

    if (!name) {
      fieldErrors.push({ line: i + 1, raw, reason: '商品名称不能为空' })
      continue
    }
    if (!barcode) {
      fieldErrors.push({ line: i + 1, raw, reason: '条码不能为空' })
      continue
    }

    const sellPrice = parseFloat(priceStr)
    if (isNaN(sellPrice) || sellPrice <= 0) {
      fieldErrors.push({ line: i + 1, raw, reason: `售价无效：${priceStr || '（空）'}` })
      continue
    }

    if (!barcodeLines.has(barcode)) barcodeLines.set(barcode, [])
    barcodeLines.get(barcode)!.push(i + 1)
    candidates.push({ row: { name, barcode, sellPrice, raw }, line: i + 1 })
  }

  const dupeBarcodes = new Set<string>()
  for (const [bc, lineNums] of barcodeLines) {
    if (lineNums.length > 1) dupeBarcodes.add(bc)
  }

  const valid: TgImportRow[] = []
  for (const { row, line } of candidates) {
    if (dupeBarcodes.has(row.barcode)) {
      inFileDupes.push({ line, barcode: row.barcode, reason: `条码 ${row.barcode} 在本次导入中重复` })
    } else {
      valid.push(row)
    }
  }

  return { total, valid, fieldErrors, inFileDupes }
}

// ─── Excel / CSV 文件解析 ─────────────────────────────────────────────────────

/**
 * 常见中英文表头别名，优先精确匹配，次之包含匹配。
 * 商品名称支持柬语等任意 Unicode，不受表头语言限制。
 */
const NAME_ALIASES   = ['商品名称', '名称', '商品名', '品名', 'product name', 'product', 'name']
const BARCODE_ALIASES = ['条码', '商品条码', 'barcode', 'bar code', 'code']
const PRICE_ALIASES  = ['售价', '单价', '价格', 'price', 'sale price']

function matchCol(headers: string[], aliases: string[]): number {
  const norm = headers.map((h) => String(h).trim().toLowerCase())
  // 精确匹配
  for (const alias of aliases) {
    const idx = norm.indexOf(alias.toLowerCase())
    if (idx !== -1) return idx
  }
  // 包含匹配（兼容带空格/前缀的表头）
  for (const alias of aliases) {
    const idx = norm.findIndex((h) => h.includes(alias.toLowerCase()))
    if (idx !== -1) return idx
  }
  return -1
}

/**
 * 解析 xlsx / csv 文件 Buffer。
 * - 自动识别中英文常见表头（见 NAME_ALIASES / BARCODE_ALIASES / PRICE_ALIASES）
 * - 缺失必须字段时返回 FileParseError，含具体缺失说明
 * - 返回与 parseProductTextLines 相同的 TgParseResult，可直接送入 preview/confirm 流程
 * - 限制处理前 500 行数据（不含表头）
 */
export function parseProductFile(buffer: Buffer, filename: string): FileParseResult {
  // xlsx 库同时支持 .xlsx 和 .csv
  let rows: unknown[][]
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
  } catch {
    return { type: 'PARSE_FAILED', missing: ['无法解析文件，请确认是有效的 .xlsx 或 .csv 格式'] }
  }

  if (rows.length < 2) {
    return { type: 'MISSING_COLS', missing: ['文件无数据行（需至少包含表头和一行数据）'] }
  }

  const headerRow = (rows[0] as unknown[]).map((h) => String(h ?? '').trim())

  const nameCol    = matchCol(headerRow, NAME_ALIASES)
  const barcodeCol = matchCol(headerRow, BARCODE_ALIASES)
  const priceCol   = matchCol(headerRow, PRICE_ALIASES)

  const missing: string[] = []
  if (nameCol   === -1) missing.push('商品名称（可用：商品名称 / 名称 / name / product name）')
  if (barcodeCol === -1) missing.push('条码（可用：条码 / barcode / code）')
  if (priceCol  === -1) missing.push('售价（可用：售价 / 单价 / price / sale price）')

  if (missing.length > 0) {
    return { type: 'MISSING_COLS', missing }
  }

  // 解析数据行（跳过表头，最多 500 行）
  const dataRows = rows.slice(1, 501)

  const fieldErrors: TgParseResult['fieldErrors'] = []
  const inFileDupes: TgParseResult['inFileDupes'] = []
  const candidates: Array<{ row: TgImportRow; line: number }> = []
  const barcodeLines = new Map<string, number[]>()
  let nonBlankCount = 0

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i] as unknown[]
    const name      = String(row[nameCol]    ?? '').trim()
    const barcode   = String(row[barcodeCol] ?? '').trim()
    const priceStr  = String(row[priceCol]   ?? '').trim()

    // 跳过空行
    if (!name && !barcode && !priceStr) continue
    nonBlankCount++

    const lineNum = i + 2 // +1 for 0-index, +1 for header row
    const raw = `${name} | ${barcode} | ${priceStr}`

    if (!name) {
      fieldErrors.push({ line: lineNum, raw, reason: '商品名称不能为空' })
      continue
    }
    if (!barcode) {
      fieldErrors.push({ line: lineNum, raw, reason: '条码不能为空' })
      continue
    }

    const sellPrice = parseFloat(priceStr)
    if (isNaN(sellPrice) || sellPrice <= 0) {
      fieldErrors.push({ line: lineNum, raw, reason: `售价无效：${priceStr || '（空）'}` })
      continue
    }

    if (!barcodeLines.has(barcode)) barcodeLines.set(barcode, [])
    barcodeLines.get(barcode)!.push(lineNum)
    candidates.push({ row: { name, barcode, sellPrice, raw }, line: lineNum })
  }

  // 检测文件内重复条码
  const dupeBarcodes = new Set<string>()
  for (const [bc, lineNums] of barcodeLines) {
    if (lineNums.length > 1) dupeBarcodes.add(bc)
  }

  const valid: TgImportRow[] = []
  for (const { row, line } of candidates) {
    if (dupeBarcodes.has(row.barcode)) {
      inFileDupes.push({ line, barcode: row.barcode, reason: `条码 ${row.barcode} 在文件中重复` })
    } else {
      valid.push(row)
    }
  }

  return { total: nonBlankCount, valid, fieldErrors, inFileDupes }
}
