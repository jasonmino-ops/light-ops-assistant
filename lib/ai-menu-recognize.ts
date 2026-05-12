/**
 * AI 菜单识别（视觉）
 *
 * 调用 Anthropic Claude Haiku 4.5 (视觉) 的 Messages API。
 * 直接 fetch，不引入 SDK 依赖。
 *
 * 输入: 图片 base64 + MIME 类型
 * 输出: 归一化后的菜单商品数组
 *
 * 失败时抛出 Error，message 字段为可读错误码。
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5-20251001'

export type AiMenuItem = {
  name: string
  category: string | null
  price: number | null
  currency: string | null
  unit: string | null
  description: string | null
  confidence: number
  warnings: string[]
}

const PROMPT = `你是菜单图片识别助手。请从图片中提取商品列表，输出严格 JSON 数组，**不要任何 markdown 标记，不要任何解释文本，只输出 JSON**。

每个商品对象字段：
- name: 商品名（必填，保留原图语言）
- category: 推断的分类（如「饮料」「主食」「凉菜」「炒菜」），不能推断填 null
- price: 单价数字（按图中数值原样填，不做任何换算），不能确定填 null
- currency: 货币代号 USD / KHR / CNY，不能确定填 null
- unit: 计价单位（如 "份" "杯" "瓶"），不能确定填 null
- description: 简短说明，无填 null
- confidence: 0..1 浮点，对该条识别的信心
- warnings: 字符串数组，如 ["价格模糊"]、["可能是套餐"]，无填 []

规则：
1. 不要把电话、地址、营业时间、广告语、店名识别为商品
2. 不要编造价格，价格不清晰就填 null
3. 中文、英文、高棉文都识别
4. 整张图无法识别任何商品时返回空数组 []
5. 只输出 JSON，禁止任何前后缀文字`

type AnthropicResp = {
  content?: Array<{ type: string; text?: string }>
  error?: { message?: string }
}

export async function recognizeMenuImage(
  imageBase64: string,
  mediaType: string,
): Promise<AiMenuItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI_NOT_CONFIGURED')

  let resp: Response
  try {
    resp = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    })
  } catch {
    throw new Error('AI_NETWORK_ERROR')
  }

  if (!resp.ok) {
    let errText = ''
    try {
      const errBody = await resp.json() as AnthropicResp
      errText = errBody?.error?.message ?? ''
    } catch {}
    throw new Error(`AI_API_${resp.status}${errText ? `:${errText.slice(0, 160)}` : ''}`)
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

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('AI_JSON_PARSE_ERROR')
  }
  if (!Array.isArray(parsed)) throw new Error('AI_NOT_ARRAY')

  const items: AiMenuItem[] = []
  for (const raw of parsed) {
    const it = normalize(raw)
    if (it) items.push(it)
  }
  return items
}

function normalize(raw: unknown): AiMenuItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (!name) return null

  const price =
    typeof o.price === 'number' && !isNaN(o.price) && o.price > 0
      ? Math.round(o.price * 100) / 100
      : null

  return {
    name,
    category:    typeof o.category    === 'string' ? (o.category.trim()    || null) : null,
    price,
    currency:    typeof o.currency    === 'string' ? (o.currency.trim().toUpperCase() || null) : null,
    unit:        typeof o.unit        === 'string' ? (o.unit.trim()        || null) : null,
    description: typeof o.description === 'string' ? (o.description.trim() || null) : null,
    confidence:  typeof o.confidence  === 'number' ? Math.max(0, Math.min(1, o.confidence)) : 0.5,
    warnings:    Array.isArray(o.warnings) ? o.warnings.filter((w): w is string => typeof w === 'string') : [],
  }
}
