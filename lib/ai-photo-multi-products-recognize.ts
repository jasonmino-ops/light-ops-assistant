/**
 * 多商品拍照识别 Beta：只提取图中疑似商品的视觉文本特征。
 *
 * 安全契约：
 * - 不返回 productId / price / quantity
 * - 不识别人脸、支付码、票据隐私
 * - 只输出 JSON
 * - 调用方负责把 aiHint 匹配到当前 tenant 商品库
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
export const AI_PHOTO_MULTI_MODEL = 'claude-haiku-4-5-20251001'
export const AI_PHOTO_MULTI_PROVIDER = 'anthropic'
const TIMEOUT_MS = 8000
const MAX_TOKENS = 1024

export type AiPhotoMultiHint = {
  name: string | null
  brand: string | null
  spec: string | null
  category: string | null
  color: string | null
  packageText: string | null
  confidence: number
}

const PROMPT = `你是门店收银拍照识别助手。请识别图片中视觉上可见的多个疑似商品，并输出严格 JSON 对象，不要 markdown，不要解释，只输出 JSON。

输出格式：
{
  "items": [
    {
      "name": "疑似商品名或 null",
      "brand": "品牌或 null",
      "spec": "规格/容量/重量或 null",
      "category": "品类或 null",
      "color": "包装主色或 null",
      "packageText": "包装上可见文字摘录，最多 80 字符",
      "confidence": 0.0
    }
  ]
}

规则：
1. 最多输出 3 个商品项，优先选择清晰、完整、最像商品包装的物体
2. 不识别人脸；图中有人脸时忽略人脸，只看商品；如果商品不清晰则 items=[]
3. 不识别支付二维码、银行卡、票据、收据、隐私信息；这些内容不要输出
4. 不输出价格，不输出数量，不输出 productId、id、stock、barcode
5. 不确定就填 null；不要编造
6. 图中没有清晰商品则 items=[]
7. 只输出 JSON 对象`

type AnthropicResp = {
  content?: Array<{ type: string; text?: string }>
  error?: { message?: string }
}

export async function recognizeMultipleProducts(
  imageBase64: string,
  mediaType: string,
  maxItems: number,
): Promise<AiPhotoMultiHint[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI_NOT_CONFIGURED')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let resp: Response
  try {
    resp = await fetch(ANTHROPIC_API, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_PHOTO_MULTI_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('AI_TIMEOUT')
    throw new Error('AI_NETWORK_ERROR')
  } finally {
    clearTimeout(timer)
  }

  if (!resp.ok) {
    let errText = ''
    try {
      const errBody = await resp.json() as AnthropicResp
      errText = errBody?.error?.message ?? ''
    } catch { /* ignore */ }
    throw new Error(`AI_API_${resp.status}${errText ? `:${errText.slice(0, 120)}` : ''}`)
  }

  let body: AnthropicResp
  try {
    body = await resp.json() as AnthropicResp
  } catch {
    throw new Error('AI_RESP_PARSE_ERROR')
  }

  const textBlock = body.content?.find((c) => c.type === 'text')
  const raw = textBlock?.text ?? ''
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  if (!cleaned) throw new Error('AI_EMPTY')

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('AI_JSON_PARSE_ERROR')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI_JSON_PARSE_ERROR')
  }

  const itemsRaw = (parsed as { items?: unknown }).items
  if (!Array.isArray(itemsRaw)) return []
  return itemsRaw
    .slice(0, Math.max(1, maxItems))
    .map(normalizeHint)
    .filter((item) => item.confidence > 0 && hasAnyText(item))
}

const STR_FIELDS = ['name', 'brand', 'spec', 'category', 'color', 'packageText'] as const

function normalizeHint(input: unknown): AiPhotoMultiHint {
  const o = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const out: AiPhotoMultiHint = {
    name: null,
    brand: null,
    spec: null,
    category: null,
    color: null,
    packageText: null,
    confidence: 0,
  }
  for (const k of STR_FIELDS) {
    const v = o[k]
    if (typeof v === 'string') {
      const trimmed = v.trim()
      out[k] = trimmed === ''
        ? null
        : (k === 'packageText' ? trimmed.slice(0, 80) : trimmed.slice(0, 80))
    }
  }
  const c = o.confidence
  if (typeof c === 'number' && Number.isFinite(c)) {
    out.confidence = Math.max(0, Math.min(1, c))
  }
  return out
}

function hasAnyText(item: AiPhotoMultiHint): boolean {
  return Boolean(item.name || item.brand || item.spec || item.category || item.color || item.packageText)
}
