/**
 * POST /api/products/import-ai/recognize  — AI 菜单识别（OWNER）
 *
 * 接收单张菜单图片 → 调 Anthropic 视觉模型识别 → 返回 PreviewRow[]，
 * 不直接写库。后续仍由 /api/products/import/confirm 完成实际导入。
 */

import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { recognizeMenuImage } from '@/lib/ai-menu-recognize'
import type { PreviewRow } from '../../import/route'

const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以导入商品' }, { status: 403 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'INVALID_FORM', message: '请上传图片' }, { status: 400 })
  }
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'NO_FILE', message: '未收到文件' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'INVALID_TYPE', message: '仅支持 JPG / PNG / WebP' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE', message: '图片不能超过 5MB' }, { status: 400 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const base64 = buf.toString('base64')

  let items
  try {
    items = await recognizeMenuImage(base64, file.type)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'AI_FAILED'
    if (msg === 'AI_NOT_CONFIGURED') {
      return NextResponse.json(
        { error: 'AI_NOT_CONFIGURED', message: '后端未配置 AI 服务，请联系管理员设置 ANTHROPIC_API_KEY' },
        { status: 500 },
      )
    }
    if (msg === 'AI_JSON_PARSE_ERROR' || msg === 'AI_NOT_ARRAY' || msg === 'AI_RESP_PARSE_ERROR') {
      return NextResponse.json(
        { error: 'AI_PARSE_ERROR', message: 'AI 返回内容无法解析，请重试或换一张更清晰的图片' },
        { status: 502 },
      )
    }
    return NextResponse.json(
      { error: 'AI_FAILED', message: '识别失败：' + msg.slice(0, 200) },
      { status: 502 },
    )
  }

  if (items.length === 0) {
    return NextResponse.json(
      { error: 'AI_EMPTY', message: '未识别到任何商品，请换一张更清晰的菜单图片', preview: [] },
      { status: 200 },
    )
  }

  // 临时条码：tenantId 内单次操作唯一即可，confirm 路由也会做最终去重
  const ts = Date.now().toString(36).toUpperCase()
  const preview: PreviewRow[] = items.map((it, i) => ({
    rowNum: i + 1,
    barcode: `AI${ts}${String(i).padStart(3, '0')}`,
    sku: null,
    name: it.name,
    spec: it.unit ?? null,
    sellPrice: it.price ?? 0,
    status: 'ACTIVE',
    category1Raw: it.category ?? '',
    category2Raw: '',
    resolvedL1: it.category ?? null,
    resolvedL2: null,
    catSource: it.category ? 'AUTO' : 'NONE',
    isDuplicate: false,
    error: null,
    confidence: it.confidence,
    warnings: it.warnings,
  }))

  return NextResponse.json({ preview })
}
