import { PRODUCT_IMPORT_FIELDS, type ProductImportColumnMapping } from './product-spreadsheet'

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5-20251001'

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>
  error?: { message?: string }
}

function boundedText(value: unknown, max: number): string {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max)
}

/**
 * 仅识别第三方表格列含义；返回的是建议映射，绝不读写业务数据库。
 */
export async function analyzeProductColumnMapping(
  headers: string[],
  sampleRows: string[][],
): Promise<ProductImportColumnMapping> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI_NOT_CONFIGURED')
  const safeHeaders = headers.slice(0, 40).map((header) => boundedText(header, 120))
  const safeSamples = sampleRows.slice(0, 8).map((row) => row.slice(0, safeHeaders.length).map((cell) => boundedText(cell, 120)))
  const prompt = `你是商品表格列映射助手。根据表头和少量样例，推断哪些列对应以下字段：${PRODUCT_IMPORT_FIELDS.join(', ')}。

只输出严格 JSON 对象，key 为字段名，value 为从 0 开始的列序号；不能确定的字段不要输出。不要输出 Markdown 或解释。

限制：不要猜测不存在的列；nameZh/nameEn/nameKm 分别表示中文、英文、高棉文名称；sellPrice 为销售单价；imageUrl 为主图；imageUrls 为多图列表；category1/category2 为分类层级。

表头：${JSON.stringify(safeHeaders)}
样例：${JSON.stringify(safeSamples)}`
  let response: Response
  try {
    response = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  } catch {
    throw new Error('AI_NETWORK_ERROR')
  }
  if (!response.ok) {
    let detail = ''
    try {
      detail = ((await response.json()) as AnthropicResponse).error?.message ?? ''
    } catch { /* ignore provider response parse failure */ }
    throw new Error(`AI_API_${response.status}${detail ? `:${detail.slice(0, 160)}` : ''}`)
  }
  let body: AnthropicResponse
  try {
    body = await response.json() as AnthropicResponse
  } catch {
    throw new Error('AI_RESPONSE_PARSE_ERROR')
  }
  const raw = body.content?.find((block) => block.type === 'text')?.text ?? ''
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim())
  } catch {
    throw new Error('AI_JSON_PARSE_ERROR')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('AI_MAPPING_INVALID')
  const result: ProductImportColumnMapping = {}
  for (const [field, index] of Object.entries(parsed as Record<string, unknown>)) {
    if (!PRODUCT_IMPORT_FIELDS.includes(field as typeof PRODUCT_IMPORT_FIELDS[number])) continue
    if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < safeHeaders.length) {
      result[field as typeof PRODUCT_IMPORT_FIELDS[number]] = index
    }
  }
  return result
}
