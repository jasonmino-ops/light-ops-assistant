import { Worker } from 'node:worker_threads'
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
  stop_reason?: string | null
  usage?: { output_tokens?: number }
}

const PDF_STOP_REASONS = new Set([
  'end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'pause_turn', 'refusal', 'model_context_window_exceeded',
])
const PDF_SPLIT_MAX_BYTES = 5 * 1024 * 1024

type PdfSourceBoxFailure = 'source_box_shape' | 'source_box_coordinate' | 'source_box_area'

const IMPORT_FIELDS = new Set<ProductImportField>([
  'barcode', 'sku', 'nameZh', 'nameEn', 'nameKm', 'descZh', 'descEn', 'descKm',
  'spec', 'sellPrice', 'status', 'imageUrl', 'category1', 'category2',
  'unitNames', 'auxConversionFactor', 'auxBarcode', 'auxSellPrice',
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

function pdfNumber(value: unknown): number {
  try {
    return Number(value)
  } catch {
    return NaN
  }
}

function sourceBox(value: unknown, fail: (reason: PdfSourceBoxFailure) => never): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) return fail('source_box_shape')
  const coordinates = value.map(pdfNumber)
  if (coordinates.some((coordinate) => !Number.isInteger(coordinate) || coordinate < 0 || coordinate > 1_000)) {
    return fail('source_box_coordinate')
  }
  if (coordinates[2] <= coordinates[0] || coordinates[3] <= coordinates[1]) return fail('source_box_area')
  return coordinates as [number, number, number, number]
}

function quantizedSourceBox(value: [number, number, number, number]) {
  return value.map((coordinate) => Math.round(coordinate / 10))
}

function splitPdfPages(pdf: Buffer): Promise<Uint8Array[] | null> {
  if (pdf.length > PDF_SPLIT_MAX_BYTES) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error('AI_PDF_SPLIT_FAILED'))
    // The parser can emit source values in its warnings. Keep them out of application logs.
    let worker: Worker
    try {
      worker = new Worker(new URL('./pdf-page-worker.cjs', import.meta.url), {
        name: 'product-import-pdf-worker',
        workerData: pdf,
        stdout: true,
        stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: 96 },
      })
    } catch {
      fail()
      return
    }
    worker.stdout?.resume()
    worker.stderr?.resume()
    const deadline = setTimeout(() => {
      fail()
      void worker.terminate()
    }, 5_000)
    worker.once('message', (pages: Uint8Array[] | null | { failed: true }) => {
      if (pages === null || Array.isArray(pages)) resolve(pages)
      else fail()
    })
    worker.once('error', fail)
    worker.once('exit', () => {
      clearTimeout(deadline)
      fail()
    })
  })
}

export class AnthropicProductImportAiProvider implements ProductImportAiProvider {
  readonly providerId = 'anthropic'
  readonly modelId: string

  constructor(private readonly config: ProductImportAiConfig) {
    this.modelId = config.model
  }

  private async requestMessage(content: Array<Record<string, unknown>>, maxTokens: number, redactApiError = false) {
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
      if (redactApiError) throw new Error(`AI_API_${response.status}`)
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
    return { body, requestId: response.headers.get('request-id') }
  }

  private async request(content: Array<Record<string, unknown>>): Promise<unknown[]> {
    const { body } = await this.requestMessage(content, 4096)
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
    const raw = await this.request([{ type: 'text', text: `你是商品导入字段映射器。判断哪些工作表包含商品，并从 candidateRows 中选择真实表头行，将绝对 worksheet columnIndex 映射到允许字段。只输出 JSON 数组，不要 markdown。字段仅可为 barcode,sku,nameZh,nameEn,nameKm,descZh,descEn,descKm,spec,sellPrice,status,imageUrl,category1,category2,unitNames,auxConversionFactor,auxBarcode,auxSellPrice。每项格式：{"sheetIndex":0,"selected":true,"headerRowNumber":1,"mapping":{"nameZh":0,"sellPrice":1},"confidence":0.9,"warnings":[]}。selected=true 只允许用于可独立生成商品行、且能映射至少一个名称字段和 sellPrice 的主商品表；分类、商品多语言、规格、加料等仅供关联的辅助表必须 selected=false、mapping={}，并在 warnings 说明其角色，当前导入器不会跨表 join。映射必须同时依据表头和候选行样本值：商品名称样本以高棉文字为主时映射 nameKm，以汉字为主时映射 nameZh，以拉丁文字为主时映射 nameEn；双语表头不能覆盖样本值的实际语言。明确写 SKU/货号的列映射 sku；写编码/Code 且样本值是可扫码商品标识（包括带 # 等原样字符）时优先映射 barcode。unitNames 只能映射明确销售单位列，auxConversionFactor 只能映射源文件明确换算率，不得从规格推导。主/辅条码与主/辅售价必须按表头语义分别映射。category1/category2 只接受用于现有分类名称匹配的人类可读分类名称列；不得把分类ID或其他 opaque numeric ID 映射为分类，若同时存在“分类ID”和“分类名称”必须选择“分类名称”。只有样本单元格实际包含 HTTP/HTTPS URL 时才映射 imageUrl；图片表头下的空单元格可能是 XLSX 内嵌 Drawing，不得映射 imageUrl。不得编造 candidateRows 中不存在的表头行或列，不得把同一列映射到多个字段。输入：${JSON.stringify(payload)}` }])
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
    const pages = await splitPdfPages(pdf)
    if (!pages) return this.recognizePdfDocument(pdf)

    const results = await Promise.allSettled(pages.map((page, index) => (
      this.recognizePdfDocument(Buffer.from(page), index + 1)
    )))
    return results.flatMap((result) => {
      if (result.status === 'rejected') throw result.reason
      return result.value
    })
  }

  private async recognizePdfDocument(pdf: Buffer, sourcePageNumber?: number): Promise<ProductImportAiPdfBlock[]> {
    const { body, requestId } = await this.requestMessage([
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
      { type: 'text', text: `识别 PDF 中的商品块。按 PDF 物理页面顺序逐页处理，每页先看该页图像并确定商品表格的首末行。若同页印有页码、小计或合计，以它们核对当前页的结束边界，边界上方仍属于该页的商品行不得移到下一页。有序号列时，先读取该页实际首末序号；若序号连续，用末序号减首序号加一核对本页条数。各页行数可以不同，不得按固定行数分页。每条实际商品行各输出一项。表头、小计、合计、签收、店铺信息和页脚不属于商品。没有商品的页不输出任何项。
pageNumber 必须是商品实际出现的 PDF 物理页序号，从 1 开始。sourceBox 必须框住该页实际的商品块或表格行，格式为 [left,top,right,bottom]。每页单独从左上到右下归一化到 0..1000 的整数坐标，left < right 且 top < bottom。同页不同商品使用各自的框，不复用框。输出前逐页核对实际首末行、商品数、页码和坐标。
保留完整原文名称和原始条码字符，不翻译、不补造。只输出紧凑 JSON 数组，不要 Markdown。每项必含 pageNumber、sourceBox、name。示例：{"pageNumber":1,"sourceBox":[100,100,900,140],"name":"原文商品名"}。如来源清楚，保留 barcode（字符串）、sku、price（商品单价，数字）、category1、category2、description、spec、nearbyImageDescription、confidence 和 warnings。无来源或为空的可选字段省略。` },
    ], 8192, true)
    const stopReason = body?.stop_reason
    const responseMetadata = {
      requestId: requestId && /^req_[a-zA-Z0-9_-]{1,80}$/.test(requestId) ? requestId : null,
      stopReason: stopReason && PDF_STOP_REASONS.has(stopReason) ? stopReason : stopReason == null ? 'missing' : 'unknown',
      outputTokens: Number.isInteger(body?.usage?.output_tokens) ? body.usage?.output_tokens : null,
      sourcePageNumber,
    }
    function reject(code: string, reason: string, context?: {
      itemCount: number
      itemIndex: number
      pageNumber?: number
      conflictingItemIndex?: number
    }): never {
      console.warn(JSON.stringify({
        event: 'product_import_pdf_ai_rejected', code, reason, ...responseMetadata, ...context,
      }))
      throw new Error(code)
    }
    if (stopReason !== 'end_turn') reject('AI_RESPONSE_INCOMPLETE', 'unexpected_stop_reason')
    const textBlocks = Array.isArray(body.content) ? body.content.filter((block) => block?.type === 'text') : []
    if (textBlocks.length > 1) reject('AI_RESP_PARSE_ERROR', 'multiple_text_blocks')
    const text = textBlocks[0]?.text
    if (typeof text !== 'string' || !text) return reject('AI_EMPTY_RESPONSE', 'missing_text')
    let raw: unknown[]
    try {
      raw = parseJsonArray(text)
    } catch (error) {
      return reject(error instanceof Error ? error.message : 'AI_RESP_PARSE_ERROR', 'invalid_json_array')
    }
    const result: ProductImportAiPdfBlock[] = []
    const identities = new Map<string, number>()
    for (const [itemIndex, value] of raw.entries()) {
      const context = { itemCount: raw.length, itemIndex }
      if (!value || typeof value !== 'object') reject('AI_SCHEMA_INVALID', 'invalid_item', context)
      const item = value as Record<string, unknown>
      const name = boundedString(item.name)
      const reportedPageNumber = pdfNumber(item.pageNumber)
      if (!Number.isInteger(reportedPageNumber) || reportedPageNumber < 1
        || (sourcePageNumber !== undefined && reportedPageNumber !== 1)) {
        reject('AI_SCHEMA_INVALID', 'invalid_page_number', context)
      }
      const pageNumber = sourcePageNumber ?? reportedPageNumber
      const pageContext = { ...context, pageNumber: pageNumber <= 600 ? pageNumber : undefined }
      if (!name) return reject('AI_SCHEMA_INVALID', 'invalid_name', pageContext)
      const blockSourceBox = sourceBox(item.sourceBox, (reason) => reject('AI_SCHEMA_INVALID', reason, pageContext))
      const identity = `${pageNumber}:${quantizedSourceBox(blockSourceBox).join(':')}`
      const conflictingItemIndex = identities.get(identity)
      if (conflictingItemIndex !== undefined) {
        reject('AI_SCHEMA_INVALID', 'duplicate_source_box', { ...pageContext, conflictingItemIndex })
      }
      identities.set(identity, itemIndex)
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
    let pageNumber = -1
    let blockIndex = 0
    for (const block of result) {
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
