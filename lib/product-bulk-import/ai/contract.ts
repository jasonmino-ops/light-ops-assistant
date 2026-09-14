import type {
  ProductImportFieldMapping,
  SpreadsheetInspectionSheet,
} from '../contract'

export type ProductImportAiSpreadsheetMapping = {
  sheetIndex: number
  selected: boolean
  headerRowNumber: number
  mapping: ProductImportFieldMapping
  confidence: number
  warnings: string[]
}

export type ProductImportAiPdfBlock = {
  pageNumber: number
  blockIndex: number
  sourceBox: [number, number, number, number]
  name: string
  barcode: string | null
  sku: string | null
  price: number | null
  category1: string | null
  category2: string | null
  description: string | null
  spec: string | null
  nearbyImageDescription: string | null
  confidence: number
  warnings: string[]
}

export type ProductImportAiCategoryCandidate = {
  rowIdentity: string
  categoryId: string | null
  confidence: number
  reason: string
}

export interface ProductImportAiProvider {
  readonly providerId: string
  readonly modelId: string
  mapSpreadsheet(sheets: SpreadsheetInspectionSheet[]): Promise<ProductImportAiSpreadsheetMapping[]>
  recognizePdf(pdf: Buffer): Promise<ProductImportAiPdfBlock[]>
  suggestCategories(input: {
    rows: Array<{ rowIdentity: string; name: string; category1: string | null; category2: string | null }>
    categories: Array<{ id: string; name: string; parentId: string | null }>
  }): Promise<ProductImportAiCategoryCandidate[]>
}
