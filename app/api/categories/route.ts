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
 *
 * PATCH /api/categories — OWNER only
 * 修改分类名称或上级分类。Body: { id, name, parentId? }
 *
 * DELETE /api/categories?id=xxx — OWNER only
 * 删除空分类。分类下有商品或子分类时拒绝。
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

export async function PATCH(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以管理分类' }, { status: 403 })
  }

  let body: { id?: string; name?: string; parentId?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const id = body.id?.trim()
  const name = body.name?.trim()
  if (!id) return NextResponse.json({ error: 'MISSING_ID', message: '缺少分类 ID' }, { status: 400 })
  if (!name) return NextResponse.json({ error: 'MISSING_NAME', message: '分类名称不能为空' }, { status: 400 })

  const current = await prisma.productCategory.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { id: true, parentId: true },
  })
  if (!current) return NextResponse.json({ error: 'CATEGORY_NOT_FOUND', message: '分类不存在' }, { status: 404 })

  const parentId = body.parentId ?? null
  if (parentId === id) {
    return NextResponse.json({ error: 'INVALID_PARENT', message: '上级分类不能选择自己' }, { status: 400 })
  }

  if (parentId) {
    const parent = await prisma.productCategory.findFirst({
      where: { id: parentId, tenantId: ctx.tenantId },
      select: { parentId: true },
    })
    if (!parent) {
      return NextResponse.json({ error: 'PARENT_NOT_FOUND', message: '上级分类不存在' }, { status: 400 })
    }
    if (parent.parentId !== null) {
      return NextResponse.json(
        { error: 'TOO_DEEP', message: '只支持两级分类，不能选择二级分类作为上级' },
        { status: 400 },
      )
    }

    const childCount = await prisma.productCategory.count({
      where: { tenantId: ctx.tenantId, parentId: id },
    })
    if (childCount > 0) {
      return NextResponse.json(
        { error: 'HAS_CHILDREN', message: '该分类下有子分类，不能改为二级分类' },
        { status: 400 },
      )
    }
  }

  const updated = await prisma.productCategory.update({
    where: { id },
    data: { name, parentId },
    select: { id: true, name: true, parentId: true, sortOrder: true },
  })

  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以管理分类' }, { status: 403 })
  }

  const id = req.nextUrl.searchParams.get('id')?.trim()
  if (!id) return NextResponse.json({ error: 'MISSING_ID', message: '缺少分类 ID' }, { status: 400 })

  const category = await prisma.productCategory.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { id: true },
  })
  if (!category) return NextResponse.json({ error: 'CATEGORY_NOT_FOUND', message: '分类不存在' }, { status: 404 })

  const childCount = await prisma.productCategory.count({
    where: { tenantId: ctx.tenantId, parentId: id },
  })
  if (childCount > 0) {
    return NextResponse.json({ error: 'HAS_CHILDREN', message: '请先删除子分类' }, { status: 400 })
  }

  const productCount = await prisma.product.count({
    where: { tenantId: ctx.tenantId, categoryId: id },
  })
  if (productCount > 0) {
    return NextResponse.json({ error: 'HAS_PRODUCTS', message: '该分类下已有商品，不能删除' }, { status: 400 })
  }

  await prisma.productCategory.delete({ where: { id } })
  return NextResponse.json({ ok: true, id })
}
