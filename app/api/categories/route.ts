import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

/**
 * GET /api/categories
 * 返回当前商户的全部分类（扁平列表，含 parentId，按 sortOrder / name 排序）。
 * STAFF 也可读取（顾客端商品页将来只读使用）。
 *
 * POST /api/categories — OWNER only
 * 创建一级或二级分类。Body: { name, parentId? }
 */

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  const cats = await prisma.productCategory.findMany({
    where: { tenantId: ctx.tenantId },
    select: { id: true, name: true, parentId: true, sortOrder: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })

  return NextResponse.json(cats)
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以管理分类' }, { status: 403 })
  }

  let body: { name?: string; parentId?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const name = body.name?.trim()
  if (!name) {
    return NextResponse.json({ error: 'MISSING_NAME', message: '分类名称不能为空' }, { status: 400 })
  }

  const parentId = body.parentId ?? null

  // 校验父级分类存在且属于本商户，且为一级分类（不允许三级嵌套）
  if (parentId) {
    const parent = await prisma.productCategory.findFirst({
      where: { id: parentId, tenantId: ctx.tenantId },
      select: { parentId: true },
    })
    if (!parent) {
      return NextResponse.json({ error: 'PARENT_NOT_FOUND' }, { status: 400 })
    }
    if (parent.parentId !== null) {
      return NextResponse.json(
        { error: 'TOO_DEEP', message: '只支持两级分类，不能在二级分类下再创建子分类' },
        { status: 400 },
      )
    }
  }

  const created = await prisma.productCategory.create({
    data: { tenantId: ctx.tenantId, name, parentId },
  })

  return NextResponse.json(
    { id: created.id, name: created.name, parentId: created.parentId, sortOrder: created.sortOrder },
    { status: 201 },
  )
}
