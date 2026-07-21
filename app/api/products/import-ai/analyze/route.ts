import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { analyzeProductColumnMapping } from '@/lib/ai-product-column-mapping'

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  let body: { headers?: unknown; sampleRows?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }
  if (!Array.isArray(body.headers) || !Array.isArray(body.sampleRows)) {
    return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 })
  }
  const headers = body.headers.slice(0, 40).map((value) => String(value ?? ''))
  const sampleRows = body.sampleRows.slice(0, 8).map((row) => Array.isArray(row) ? row.slice(0, headers.length).map((value) => String(value ?? '')) : [])
  if (headers.length === 0) return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 })
  try {
    const mapping = await analyzeProductColumnMapping(headers, sampleRows)
    return NextResponse.json({ mapping })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'AI_FAILED'
    if (code === 'AI_NOT_CONFIGURED') {
      return NextResponse.json({ error: 'AI_NOT_CONFIGURED', message: 'AI 辅助未配置；你仍可手动映射字段并继续导入。' }, { status: 503 })
    }
    return NextResponse.json({ error: 'AI_FAILED', message: 'AI 未能识别字段；你仍可手动映射字段并继续导入。' }, { status: 502 })
  }
}
