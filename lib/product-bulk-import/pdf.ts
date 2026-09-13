import type { ProductImportAiPdfBlock } from './ai'
import type { ParsedProductImportRow, ProductImportIssue, ProductImportParseResult } from './contract'
import { stableRowIdentity } from './barcode'

function quantizedSourceBox(sourceBox: ProductImportAiPdfBlock['sourceBox']) {
  return sourceBox.map((coordinate) => Math.round(coordinate / 10))
}

export function pdfBlocksToRows(blocks: ProductImportAiPdfBlock[]): ProductImportParseResult {
  const coordinateOccurrences = new Map<string, number>()
  const rows: ParsedProductImportRow[] = blocks.map((block, index) => {
    const issues: ProductImportIssue[] = []
    const coordinateKey = `${block.pageNumber}:${block.blockIndex}`
    const coordinateOccurrence = coordinateOccurrences.get(coordinateKey) ?? 0
    coordinateOccurrences.set(coordinateKey, coordinateOccurrence + 1)
    if (!block.name.trim()) issues.push({ code: 'MISSING_NAME', field: 'name', message: '商品名不能为空', blocking: true })
    if (!(block.price && block.price > 0)) issues.push({ code: 'INVALID_PRICE', field: 'sellPrice', message: 'PDF 中未识别到有效售价', blocking: true })
    const images = block.nearbyImageDescription
      ? [{ kind: 'PDF_CANDIDATE' as const, source: block.nearbyImageDescription, mediaType: null }]
      : []
    if (images.length > 0) {
      issues.push({
        code: 'PDF_IMAGE_REQUIRES_CONFIRMATION',
        field: 'images',
        message: 'PDF 中检测到相邻图片候选，但 V0.1 无法可靠物化；请在 Preview 中人工确认或移除',
        blocking: true,
      })
    }
    return {
      sourceOrdinal: index + 1,
      stableSourceRowIdentity: stableRowIdentity(['pdf-block-v2', block.pageNumber, ...quantizedSourceBox(block.sourceBox), coordinateOccurrence]),
      coordinate: { pageNumber: block.pageNumber, blockIndex: block.blockIndex },
      sourcePayload: { ...block },
      product: {
        barcode: block.barcode?.trim() || null,
        sku: block.sku?.trim() || null,
        name: block.name.trim(),
        nameZh: block.name.trim(),
        nameEn: null,
        nameKm: null,
        descZh: block.description,
        descEn: null,
        descKm: null,
        spec: block.spec,
        sellPrice: block.price ?? 0,
        status: 'ACTIVE',
        statusProvided: false,
        category1: block.category1,
        category2: block.category2,
        categoryId: null,
      },
      images,
      issues,
      aiMetadata: {
        providerCapability: 'PRODUCT_IMPORT_PDF_PRODUCT_BLOCKS_V1',
        confidence: block.confidence,
        warnings: block.warnings,
      },
    }
  })
  for (const [coordinate, count] of coordinateOccurrences) {
    if (count < 2) continue
    const [pageNumber, blockIndex] = coordinate.split(':').map(Number)
    for (const row of rows.filter((candidate) => candidate.coordinate.pageNumber === pageNumber && candidate.coordinate.blockIndex === blockIndex)) {
      row.issues.push({
        code: 'AI_MAPPING_FAILED',
        message: `PDF AI 返回重复商品块坐标：第 ${pageNumber} 页 block ${blockIndex}`,
        blocking: true,
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
    for (const row of duplicates) {
      row.issues.push({
        code: 'DUPLICATE_BARCODE_IN_FILE',
        field: 'barcode',
        message: `PDF 内条码 ${barcode} 重复`,
        blocking: true,
      })
    }
  }
  return { rows, sheets: [], warnings: [] }
}
