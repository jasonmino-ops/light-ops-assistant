import type {
  ProductImportAiCategoryCandidate,
  ProductImportAiPdfBlock,
  ProductImportAiProvider,
  ProductImportAiSpreadsheetMapping,
} from './contract'
import type { ProductImportAiConfig } from './config'
import type { ProductImportField, ProductImportFieldMapping, SpreadsheetInspectionSheet } from '../contract'

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>
  error?: { message?: string }
}

const IMPORT_FIELDS = new Set<ProductImportField>([
  'barcode', 'sku', 'nameZh', 'nameEn', 'nameKm', 'descZh', 'descEn', 'descKm',
  'spec', 'sellPrice', 'status', 'imageUrl', 'category1', 'category2',
])

function boundedString(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.slice(0, max + 1).trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function budgetedText(value: unknown, budget: { remaining: number }, max: number): string {
  if (typeof value !== 'string' || budget.remaining <= 0) return ''
  const bounded = value.slice(0, Math.min(max, budget.remaining))
  budget.remaining -= bounded.length
  return bounded
}

function probability(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

function warnings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 300)).slice(0, 20)
    : []
}

function parseJsonArray(text: string): unknown[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('AI_JSON_PARSE_ERROR')
  }
  if (!Array.isArray(parsed)) throw new Error('AI_NOT_ARRAY')
  return parsed
}

function sourceBox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null
  const coordinates = value.map(Number)
  if (
    coordinates.some((coordinate) => !Number.isInteger(coordinate) || coordinate < 0 || coordinate > 1_000)
    || coordinates[2] <= coordinates[0]
    || coordinates[3] <= coordinates[1]
  ) return null
  return coordinates as [number, number, number, number]
}

function quantizedSourceBox(value: [number, number, number, number]) {
  return value.map((coordinate) => Math.round(coordinate / 10))
}

export class AnthropicProductImportAiProvider implements ProductImportAiProvider {
  readonly providerId = 'anthropic'
  readonly modelId: string

  constructor(private readonly config: ProductImportAiConfig) {
    this.modelId = config.model
  }

  private async request(content: Array<Record<string, unknown>>, maxTokens = 4096): Promise<unknown[]> {
    let response: Response
    try {
      response = await fetch(this.config.baseUrl, {
        method: 'POST',
        headers: {
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: maxTokens,
          temperature: 0,
          messages: [{ role: 'user', content }],
        }),
        signal: AbortSignal.timeout(55_000),
      })
    } catch {
      throw new Error('AI_NETWORK_ERROR')
    }
    if (!response.ok) {
      let suffix = ''
      try {
        const body = await response.json() as AnthropicResponse
        suffix = body.error?.message ? `:${body.error.message.slice(0, 160)}` : ''
      } catch {}
      throw new Error(`AI_API_${response.status}${suffix}`)
    }
    let body: AnthropicResponse
    try {
      body = await response.json() as AnthropicResponse
    } catch {
      throw new Error('AI_RESP_PARSE_ERROR')
    }
    const text = body.content?.find((block) => block.type === 'text')?.text
    if (!text) throw new Error('AI_EMPTY_RESPONSE')
    return parseJsonArray(text)
  }

  async mapSpreadsheet(sheets: SpreadsheetInspectionSheet[]): Promise<ProductImportAiSpreadsheetMapping[]> {
    const budget = { remaining: 100_000 }
    const payload = sheets.slice(0, 64).map((sheet) => ({
      sheetIndex: sheet.sheetIndex,
      sheetName: budgetedText(sheet.sheetName, budget, 255),
      maxRowNumber: sheet.maxRowNumber,
      maxColumnIndex: sheet.maxColumnIndex,
      candidateHeaderRowNumber: sheet.headerRowNumber,
      candidateRows: sheet.candidateRows.slice(0, 10).map((row) => ({
        rowNumber: row.rowNumber,
        cells: row.cells.slice(0, 80).map((cell) => ({
          columnIndex: cell.columnIndex,
          value: budgetedText(cell.value, budget, 256),
        })),
      })),
    }))
    const raw = await this.request([{ type: 'text', text: `你是商品导入字段映射器。判断哪些工作表包含商品，并从 candidateRows 中选择真实表头行，将绝对 worksheet columnIndex 映射到允许字段。只输出 JSON 数组，不要 markdown。字段仅可为 barcode,sku,nameZh,nameEn,nameKm,descZh,descEn,descKm,spec,sellPrice,status,imageUrl,category1,category2。每项格式：{"sheetIndex":0,"selected":true,"headerRowNumber":1,"mapping":{"nameZh":0,"sellPrice":1},"confidence":0.9,"warnings":[]}。不得编造 candidateRows 中不存在的表头行或列。输入：${JSON.stringify(payload)}` }])
    const result: ProductImportAiSpreadsheetMapping[] = []
    for (const value of raw) {
      if (!value || typeof value !== 'object') throw new Error('AI_SCHEMA_INVALID')
      const item = value as Record<string, unknown>
      const sheetIndex = Number(item.sheetIndex)
      const headerRowNumber = Number(item.headerRowNumber)
      const sourceSheet = sheets.find((sheet) => sheet.sheetIndex === sheetIndex)
      if (!sourceSheet || typeof item.selected !== 'boolean') throw new Error('AI_SCHEMA_INVALID')
      const selected = item.selected
      if (!selected) {
        result.push({
          sheetIndex,
          selected: false,
          headerRowNumber: sourceSheet.headerRowNumber ?? 1,
          mapping: {},
          confidence: probability(item.confidence),
          warnings: warnings(item.warnings),
        })
        continue
      }
      const candidateRow = sourceSheet.candidateRows.find((row) => row.rowNumber === headerRowNumber)
      if (!Number.isInteger(headerRowNumber) || !candidateRow) {
        throw new Error('AI_SCHEMA_INVALID')
      }
      const sourceMapping = item.mapping && typeof item.mapping === 'object' ? item.mapping as Record<string, unknown> : {}
      const mapping: ProductImportFieldMapping = {}
      for (const [key, column] of Object.entries(sourceMapping)) {
        if (
          IMPORT_FIELDS.has(key as ProductImportField)
          && Number.isInteger(column)
          && candidateRow.cells.some((cell) => cell.columnIndex === Number(column))
        ) {
          mapping[key as ProductImportField] = Number(column)
        }
      }
      const hasName = mapping.nameZh != null || mapping.nameEn != null || mapping.nameKm != null
      const mappedColumns = Object.values(mapping)
      if (!hasName || mapping.sellPrice == null || new Set(mappedColumns).size !== mappedColumns.length) {
        throw new Error('AI_SCHEMA_INVALID')
      }
      result.push({
        sheetIndex,
        selected,
        headerRowNumber,
        mapping,
        confidence: probability(item.confidence),
        warnings: warnings(item.warnings),
      })
    }
    return result
  }

  async recognizePdf(pdf: Buffer): Promise<ProductImportAiPdfBlock[]> {
    const raw = await this.request([
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
      { type: 'text', text: '识别 PDF 中的商品块、原文名称、条码、SKU、价格、两级分类、描述、规格，以及相邻图片的简短描述。只输出 JSON 数组，不要 markdown。每项格式：{"pageNumber":1,"sourceBox":[100,100,900,250],"name":"","barcode":null,"sku":null,"price":null,"category1":null,"category2":null,"description":null,"spec":null,"nearbyImageDescription":null,"confidence":0.8,"warnings":[]}。sourceBox 是商品块在该页中的 [left,top,right,bottom]，必须用 0..1000 整数坐标；不得编造看不清的字段；pageNumber 从 1 开始。' },
    ], 8192)
    const result: ProductImportAiPdfBlock[] = []
    for (const value of raw) {
      if (!value || typeof value !== 'object') throw new Error('AI_SCHEMA_INVALID')
      const item = value as Record<string, unknown>
      const name = boundedString(item.name)
      const pageNumber = Number(item.pageNumber)
      const blockSourceBox = sourceBox(item.sourceBox)
      if (!name || !Number.isInteger(pageNumber) || pageNumber < 1 || !blockSourceBox) {
        throw new Error('AI_SCHEMA_INVALID')
      }
      const price = typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0
        ? Math.round(item.price * 100) / 100
        : null
      result.push({
        pageNumber,
        blockIndex: 0,
        sourceBox: blockSourceBox,
        name,
        barcode: boundedString(item.barcode, 128),
        sku: boundedString(item.sku, 128),
        price,
        category1: boundedString(item.category1),
        category2: boundedString(item.category2),
        description: boundedString(item.description, 2_000),
        spec: boundedString(item.spec),
        nearbyImageDescription: boundedString(item.nearbyImageDescription, 1_000),
        confidence: probability(item.confidence),
        warnings: warnings(item.warnings),
      })
    }
    result.sort((left, right) => (
      left.pageNumber - right.pageNumber
      || left.sourceBox[1] - right.sourceBox[1]
      || left.sourceBox[0] - right.sourceBox[0]
      || left.sourceBox[3] - right.sourceBox[3]
      || left.sourceBox[2] - right.sourceBox[2]
    ))
    const identities = new Set<string>()
    let pageNumber = -1
    let blockIndex = 0
    for (const block of result) {
      const identity = `${block.pageNumber}:${quantizedSourceBox(block.sourceBox).join(':')}`
      if (identities.has(identity)) throw new Error('AI_SCHEMA_INVALID')
      identities.add(identity)
      if (block.pageNumber !== pageNumber) {
        pageNumber = block.pageNumber
        blockIndex = 0
      }
      block.blockIndex = blockIndex
      blockIndex += 1
    }
    return result
  }

  async suggestCategories(input: Parameters<ProductImportAiProvider['suggestCategories']>[0]): Promise<ProductImportAiCategoryCandidate[]> {
    const budget = { remaining: 100_000 }
    const payload = {
      rows: input.rows.slice(0, 200).map((row) => ({
        rowIdentity: budgetedText(row.rowIdentity, budget, 128),
        name: budgetedText(row.name, budget, 512),
        category1: budgetedText(row.category1, budget, 256) || null,
        category2: budgetedText(row.category2, budget, 256) || null,
      })),
      categories: input.categories.slice(0, 2_000).map((category) => ({
        id: budgetedText(category.id, budget, 128),
        name: budgetedText(category.name, budget, 256),
        parentId: budgetedText(category.parentId, budget, 128) || null,
      })),
    }
    const raw = await this.request([{ type: 'text', text: `你是商品分类候选匹配器。只能从 categories 中选择现有 categoryId，不能创建分类。只输出 JSON 数组，每项格式：{"rowIdentity":"","categoryId":null,"confidence":0.8,"reason":""}。不确定时 categoryId 必须为 null。输入：${JSON.stringify(payload)}` }])
    const allowedIds = new Set(input.categories.map((category) => category.id))
    const allowedRows = new Set(input.rows.map((row) => row.rowIdentity))
    const result: ProductImportAiCategoryCandidate[] = []
    for (const value of raw) {
      if (!value || typeof value !== 'object') continue
      const item = value as Record<string, unknown>
      const rowIdentity = boundedString(item.rowIdentity, 128)
      if (!rowIdentity || !allowedRows.has(rowIdentity)) continue
      const proposed = boundedString(item.categoryId, 128)
      result.push({
        rowIdentity,
        categoryId: proposed && allowedIds.has(proposed) ? proposed : null,
        confidence: probability(item.confidence),
        reason: boundedString(item.reason, 500) ?? '',
      })
    }
    return result
  }
}
