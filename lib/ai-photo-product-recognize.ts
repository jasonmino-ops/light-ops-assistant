/**
 * lib/ai-photo-product-recognize.ts
 *
 * 销售拍照识别专用：单商品视觉特征提取。
 * 与 lib/ai-menu-recognize.ts 同级，但 prompt 与输出 schema 不同：
 *   - 菜单识别 → 多商品 + 价格/分类（用于"导入新商品"）
 *   - 单商品识别 → 文本特征（name/brand/spec/barcode/category/color/packageText）+
 *                  confidence；用于"在已有商品库里匹配"
 *
 * 设计契约（务必维持）：
 * 1. AI 永远不返回 productId —— 只返回视觉文本特征，由 route 服务端拼候选
 * 2. 5 秒硬超时（AbortController），超时返回 AI_TIMEOUT
 * 3. 失败抛 Error，message 为可读错误码；route 层负责转 200 + errorCode
 * 4. 不引入 SDK，直接 fetch /v1/messages
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5-20251001'
const TIMEOUT_MS = 5000
const MAX_TOKENS = 512

export type AiProductFeature = {
  name: string | null
  brand: string | null
  spec: string | null
  barcode: string | null
  category: string | null
  color: string | null
  packageText: string | null   // 包装/标签上的可见文字（中/英/高棉）
  confidence: number            // 0..1
}

const PROMPT = `你是手持商品识别助手。请识别图中**单个**商品的视觉特征，输出严格 JSON 对象，**不要任何 markdown 标记，不要任何解释文本，只输出 JSON**。

字段：
- name: 商品名（保留原图语言；不确定填 null）
- brand: 品牌（不确定填 null）
- spec: 规格/容量/重量（如 "500ml" "100g" "12 罐装"；不确定填 null）
- barcode: 包装上可见的条码数字（仅在条码清晰可读时填；不确定填 null）
- category: 品类（如 "饮料" "零食" "宠物粮" "日用品"；不确定填 null）
- color: 主色（不确定填 null）
- packageText: 包装上可见的文字摘录，最多 60 字符；可包含中文/英文/高棉文
- confidence: 0..1 浮点，对整体识别的信心

规则：
1. 只识别**主体单个商品**；图中出现多个商品时选最居中/最大的一个
2. 图中无清晰商品 → 全字段填 null，confidence = 0
3. 图中包含明显人脸 / 银行卡 / 支付码 / 票据 / 收据 → 全字段填 null，confidence = 0
4. 不要编造任何字段；不确定就 null
5. 不要返回 productId、id、price、stock 等业务字段
6. 只输出 JSON 对象（不是数组），禁止任何前后缀文字`

type AnthropicResp = {
  content?: Array<{ type: string; text?: string }>
  error?: { message?: string }
}

/**
 * 调用 Anthropic 视觉模型识别单商品。
 *
 * @throws Error.message:
 *   AI_NOT_CONFIGURED | AI_TIMEOUT | AI_NETWORK_ERROR | AI_API_<status> |
 *   AI_RESP_PARSE_ERROR | AI_JSON_PARSE_ERROR | AI_EMPTY
 */
export async function recognizeSingleProduct(
  imageBase64: string,
  mediaType: string,
): Promise<AiProductFeature> {
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
        model: MODEL,
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
  const raw: string = textBlock?.text ?? ''
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

  return normalize(parsed as Record<string, unknown>)
}

const STR_FIELDS = ['name', 'brand', 'spec', 'barcode', 'category', 'color', 'packageText'] as const

function normalize(o: Record<string, unknown>): AiProductFeature {
  const out: AiProductFeature = {
    name: null, brand: null, spec: null, barcode: null,
    category: null, color: null, packageText: null, confidence: 0,
  }
  for (const k of STR_FIELDS) {
    const v = o[k]
    if (typeof v === 'string') {
      const trimmed = v.trim()
      // packageText 最长 60 字符
      out[k] = trimmed === '' ? null : (k === 'packageText' ? trimmed.slice(0, 60) : trimmed.slice(0, 80))
    }
  }
  const c = o.confidence
  if (typeof c === 'number' && Number.isFinite(c)) {
    out.confidence = Math.max(0, Math.min(1, c))
  }
  return out
}
