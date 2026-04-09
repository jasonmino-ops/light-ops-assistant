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

// ─── 模糊行解析（半结构化识别） ────────────────────────────────────────────────

/**
 * 字段标签关键词正则（长的放前面，防止被短词提前截断）
 * 用于从行内剥离 "条码：" / "barcode" / "价格：" 等引导词。
 */
const LABEL_PATTERN = /商品名称|商品|品名|名称|条码|barcode|售价|单价|价格|price/gi

/** 条码最短位数：≥ 5 位纯数字认定为条码候选 */
const BARCODE_MIN_LEN = 5

type FuzzyResult =
  | { ok: true;  name: string; barcode: string; sellPrice: number }
  | { ok: false; reason: string }

/**
 * 半结构化单行解析。
 * 识别规则：
 *   · ≥ BARCODE_MIN_LEN 位纯数字 → 取最长者作为条码
 *   · 小数（含小数点）→ 售价（优先）
 *   · ≤ 4 位短整数 → 售价（fallback）
 *   · 其余 token → 拼接为商品名称
 * 支持任意字段顺序、中英文标签、管道/逗号/冒号等分隔符。
 * 商品名称支持任意 Unicode（含柬语）。
 */
function parseFuzzyLine(raw: string): FuzzyResult {
  // 1. 归一化：分隔符→空格，剥离字段标签
  const line = raw
    .replace(/[|｜，,、:：]/g, ' ')
    .replace(new RegExp(LABEL_PATTERN.source, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!line) return { ok: false, reason: '行内容为空' }

  const tokens = line.split(' ').filter(Boolean)
  const claimed = new Set<number>()

  // 2. 识别条码：取最长的 ≥ BARCODE_MIN_LEN 位纯数字 token
  let barcodeIdx = -1
  let barcodeMaxLen = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (/^\d+$/.test(t) && t.length >= BARCODE_MIN_LEN && t.length > barcodeMaxLen) {
      barcodeIdx = i
      barcodeMaxLen = t.length
    }
  }
  if (barcodeIdx >= 0) claimed.add(barcodeIdx)
  const barcode = barcodeIdx >= 0 ? tokens[barcodeIdx] : undefined

  // 3. 识别售价：优先取第一个小数，其次取第一个 ≤ 4 位整数
  let priceIdx = -1
  for (let i = 0; i < tokens.length; i++) {
    if (claimed.has(i)) continue
    if (/^\d+\.\d+$/.test(tokens[i])) { priceIdx = i; break }
  }
  if (priceIdx < 0) {
    for (let i = 0; i < tokens.length; i++) {
      if (claimed.has(i)) continue
      if (/^\d{1,4}$/.test(tokens[i])) { priceIdx = i; break }
    }
  }
  if (priceIdx >= 0) claimed.add(priceIdx)
  const sellPrice = priceIdx >= 0 ? parseFloat(tokens[priceIdx]) : undefined

  // 4. 商品名称：剩余 token 拼接
  const name = tokens.filter((_, i) => !claimed.has(i)).join(' ').trim() || undefined

  // 5. 校验完整性
  const missing: string[] = []
  if (!name)   missing.push('商品名称')
  if (!barcode) missing.push(`条码（需 ${BARCODE_MIN_LEN} 位以上纯数字）`)
  if (sellPrice === undefined || isNaN(sellPrice) || sellPrice <= 0) missing.push('售价')

  if (missing.length > 0) {
    return { ok: false, reason: `缺少：${missing.join('、')}` }
  }

  return { ok: true, name: name!, barcode: barcode!, sellPrice: sellPrice! }
}

// ─── 文本行解析（半结构化模糊输入） ─────────────────────────────────────────

/**
 * 解析用户通过 Telegram 发送的商品文本。
 * 每行一个商品，支持多种写法（见 parseFuzzyLine）。
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
    const parsed = parseFuzzyLine(raw)

    if (!parsed.ok) {
      fieldErrors.push({ line: i + 1, raw, reason: parsed.reason })
      continue
    }

    const { name, barcode, sellPrice } = parsed

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
 * 中英文表头别名（含旧表常见写法），精确匹配优先，次之包含匹配。
 * 商品名称支持柬语等任意 Unicode，不受表头语言限制。
 */
const NAME_ALIASES = [
  '商品名称', '名称', '商品名', '品名', '货品名称', '货品名', '商品',
  'product name', 'product', 'name', 'item name', 'item', 'description',
  'goods name', 'goods', 'sku name',
]
const BARCODE_ALIASES = [
  '条码', '商品条码', '条形码', '商品编号', '编码', '货号', '商品码',
  'barcode', 'bar code', 'barcode no', 'code', 'item code', 'product code',
  'ean', 'upc', 'sku',
]
const PRICE_ALIASES = [
  '售价', '单价', '价格', '零售价', '出售价', '卖价', '销售价', '金额',
  'price', 'sale price', 'retail price', 'unit price', 'selling price', 'sell price',
]

/** 前 N 行扫描上限 */
const HEADER_SCAN_ROWS = 10

function matchCol(headers: string[], aliases: string[]): number {
  const norm = headers.map((h) => String(h).trim().toLowerCase())
  // 精确匹配
  for (const alias of aliases) {
    const idx = norm.indexOf(alias.toLowerCase())
    if (idx !== -1) return idx
  }
  // 包含匹配（兼容带空格/前缀/后缀的表头，如"商品名称（必填）"）
  for (const alias of aliases) {
    const idx = norm.findIndex((h) => h.includes(alias.toLowerCase()))
    if (idx !== -1) return idx
  }
  return -1
}

/**
 * 解析 xlsx / csv 文件 Buffer。
 * - 遍历所有 Sheet，选第一个能找到完整表头的 Sheet
 * - 扫描每个 Sheet 前 HEADER_SCAN_ROWS 行，自动定位表头（兼容标题行、说明行、空行）
 * - 表头别名覆盖常见中英文旧表写法
 * - 缺失必须字段时返回 FileParseError，含具体缺失说明
 * - 返回与 parseProductTextLines 相同的 TgParseResult，可直接送入 preview/confirm 流程
 * - 限制处理前 500 行数据（不含表头）
 */
export function parseProductFile(buffer: Buffer, filename: string): FileParseResult {
  let wb: ReturnType<typeof XLSX.read>
  try {
    wb = XLSX.read(buffer, { type: 'buffer' })
  } catch {
    return { type: 'PARSE_FAILED', missing: ['无法解析文件，请确认是有效的 .xlsx 或 .csv 格式'] }
  }

  if (!wb.SheetNames.length) {
    return { type: 'MISSING_COLS', missing: ['文件不包含任何 Sheet'] }
  }

  // ── 遍历 Sheet，前 HEADER_SCAN_ROWS 行扫描表头 ──────────────────────────────
  type Found = {
    rows: unknown[][]
    headerRowIdx: number
    nameCol: number
    barcodeCol: number
    priceCol: number
  }
  let found: Found | null = null

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    let rows: unknown[][]
    try {
      rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
    } catch {
      continue
    }
    if (rows.length < 2) continue

    const scanLimit = Math.min(HEADER_SCAN_ROWS, rows.length)
    for (let rowIdx = 0; rowIdx < scanLimit; rowIdx++) {
      const headers = (rows[rowIdx] as unknown[]).map((h) => String(h ?? '').trim())
      const nameCol    = matchCol(headers, NAME_ALIASES)
      const barcodeCol = matchCol(headers, BARCODE_ALIASES)
      const priceCol   = matchCol(headers, PRICE_ALIASES)
      if (nameCol !== -1 && barcodeCol !== -1 && priceCol !== -1) {
        found = { rows, headerRowIdx: rowIdx, nameCol, barcodeCol, priceCol }
        break
      }
    }
    if (found) break
  }

  if (!found) {
    // 诊断：用第一个 Sheet 的第一非空行报告缺少哪些字段
    const diagRows = (() => {
      try {
        return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
      } catch { return [] }
    })()
    const diagHeaders = (diagRows[0] as unknown[] | undefined ?? []).map((h) => String(h ?? '').trim())
    const missing: string[] = []
    if (matchCol(diagHeaders, NAME_ALIASES)    === -1) missing.push('商品名称（可用：商品名称 / 名称 / 货品名 / name / product name）')
    if (matchCol(diagHeaders, BARCODE_ALIASES) === -1) missing.push('条码（可用：条码 / 商品编号 / 货号 / barcode / sku / ean）')
    if (matchCol(diagHeaders, PRICE_ALIASES)   === -1) missing.push('售价（可用：售价 / 单价 / 零售价 / price / retail price）')
    if (!missing.length) missing.push(`已扫描前 ${HEADER_SCAN_ROWS} 行仍未找到完整表头，请确认列名`)
    return { type: 'MISSING_COLS', missing }
  }

  const { rows, headerRowIdx, nameCol, barcodeCol, priceCol } = found

  // 解析数据行（表头后，最多 500 行）
  const dataRows = rows.slice(headerRowIdx + 1, headerRowIdx + 501)

  const fieldErrors: TgParseResult['fieldErrors'] = []
  const inFileDupes: TgParseResult['inFileDupes'] = []
  const candidates: Array<{ row: TgImportRow; line: number }> = []
  const barcodeLines = new Map<string, number[]>()
  let nonBlankCount = 0

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i] as unknown[]
    const name     = String(row[nameCol]    ?? '').trim()
    const barcode  = String(row[barcodeCol] ?? '').trim()
    const priceStr = String(row[priceCol]   ?? '').trim()

    // 跳过空行
    if (!name && !barcode && !priceStr) continue
    nonBlankCount++

    // 行号 = 表头行(1-based) + 数据偏移 + 1
    const lineNum = headerRowIdx + i + 2
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
