/**
 * lib/product-import.ts
 *
 * 共享商品导入解析逻辑。
 * 供 Telegram 文本导入（webhook）和后续 Excel/CSV 导入复用。
 */

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

  // 检测本次文本内重复条码
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
