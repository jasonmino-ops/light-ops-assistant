export const PRODUCT_IMPORT_MAX_IMAGES = 3
export const PRODUCT_IMPORT_ANALYZE_BATCH_SIZE = 200
// Four rows keep the worst-case 3-image external fetch + Storage upload path
// below the 300-second route lifetime while retaining resumable throughput.
export const PRODUCT_IMPORT_CONFIRM_BATCH_SIZE = 4
export const PRODUCT_IMPORT_MAX_SOURCE_BYTES = 50 * 1024 * 1024

export type ProductImportFormat = 'XLSX' | 'CSV' | 'PDF'
export type ProductImportBarcodeOrigin = 'SOURCE' | 'GENERATED'
export type ProductImportAction = 'CREATE' | 'UPDATE'

export type ProductImportIssueCode =
  | 'MISSING_NAME'
  | 'INVALID_PRICE'
  | 'DUPLICATE_BARCODE_IN_FILE'
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_AMBIGUOUS'
  | 'UNSUPPORTED_IMAGE_FORMAT'
  | 'IMAGE_FETCH_FAILED'
  | 'TOO_MANY_IMAGES'
  | 'PDF_IMAGE_REQUIRES_CONFIRMATION'
  | 'AI_MAPPING_REQUIRED'
  | 'AI_MAPPING_FAILED'
  | 'UNSUPPORTED_GROUPED_VARIANT_SOURCE'
  | 'SHEET_SKIPPED'

export type ProductImportIssue = {
  code: ProductImportIssueCode
  field?: string
  message: string
  blocking: boolean
}

export type ProductImportImageCandidate = {
  kind: 'XLSX_EMBEDDED' | 'EXTERNAL_URL' | 'PDF_CANDIDATE'
  source: string
  mediaType: string | null
  relationshipId?: string
  imageHash?: string
}

export type ProductImportSourceCoordinate = {
  sheetIndex?: number
  sheetName?: string
  rowNumber?: number
  pageNumber?: number
  blockIndex?: number
}

export type ProductImportNormalizedProduct = {
  barcode: string | null
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
  category1: string | null
  category2: string | null
  categoryId: string | null
}

export type ParsedProductImportRow = {
  sourceOrdinal: number
  stableSourceRowIdentity: string
  coordinate: ProductImportSourceCoordinate
  sourcePayload: Record<string, unknown>
  product: ProductImportNormalizedProduct
  images: ProductImportImageCandidate[]
  issues: ProductImportIssue[]
  aiMetadata?: Record<string, unknown>
}

export type SpreadsheetInspectionSheet = {
  sheetIndex: number
  sheetName: string
  maxRowNumber: number
  maxColumnIndex: number
  headerRowNumber: number | null
  headers: string[]
  sampleRows: string[][]
  candidateRows: Array<{
    rowNumber: number
    cells: Array<{ columnIndex: number; value: string }>
  }>
  deterministicMapping: ProductImportFieldMapping | null
}

export type ProductImportField =
  | 'barcode'
  | 'sku'
  | 'nameZh'
  | 'nameEn'
  | 'nameKm'
  | 'descZh'
  | 'descEn'
  | 'descKm'
  | 'spec'
  | 'sellPrice'
  | 'status'
  | 'imageUrl'
  | 'category1'
  | 'category2'

export type ProductImportFieldMapping = Partial<Record<ProductImportField, number>>

export type ProductImportParseResult = {
  rows: ParsedProductImportRow[]
  sheets: SpreadsheetInspectionSheet[]
  warnings: ProductImportIssue[]
}

export type ProductImportPreviewPayload = ProductImportNormalizedProduct & {
  imageCount: number
}

export type ProductImportImagePlan = {
  candidates: ProductImportImageCandidate[]
}

export type ProductImportImageResult = {
  uploadIntentKeys?: string[]
  uploadedUrls?: string[]
  uploadedKeys?: string[]
  compensationPendingKeys?: string[]
  oldKeysPendingCleanup?: string[]
  lastError?: string
  cleanupAttempts?: number
}

export type ProductImportJobSummary = {
  jobId: string
  status: string
  total: number
  ready: number
  invalid: number
  confirmed: number
  failed: number
  hasMore: boolean
}

export function isSupportedImportFormat(value: string): value is ProductImportFormat {
  return value === 'XLSX' || value === 'CSV' || value === 'PDF'
}

export function importFormatFromFile(fileName: string, mimeType: string): ProductImportFormat | null {
  const lower = fileName.trim().toLowerCase()
  if (lower.endsWith('.xlsx') || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'XLSX'
  if (lower.endsWith('.csv') || mimeType === 'text/csv' || mimeType === 'application/csv') return 'CSV'
  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') return 'PDF'
  return null
}

export function isBlockingIssue(issue: ProductImportIssue) {
  return issue.blocking
}
