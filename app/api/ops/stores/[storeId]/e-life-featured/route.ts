/**
 * PATCH /api/ops/stores/[storeId]/e-life-featured
 * Body: { eLifeFeatured?: boolean, eLifeFeaturedSort?: number }
 *
 * OPS 后台设置/取消某门店为 E-Life 首页推荐位。
 * 权限：OPS 任意角色均可（BD 也可），只有 SUPER_ADMIN / OPS_ADMIN 才能改 tenant tier，但推荐位属于运营配置。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ storeId: string }> },
) {
  const role = await checkOpsAuth(req)
  if (!role) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { storeId } = await params

  let body: { eLifeFeatured?: boolean; eLifeFeaturedSort?: number }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const data: { eLifeFeatured?: boolean; eLifeFeaturedSort?: number } = {}

  if (typeof body.eLifeFeatured === 'boolean') data.eLifeFeatured = body.eLifeFeatured
  if (typeof body.eLifeFeaturedSort === 'number' && isFinite(body.eLifeFeaturedSort)) {
    data.eLifeFeaturedSort = Math.round(body.eLifeFeaturedSort)
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'NO_CHANGE' }, { status: 400 })
  }

  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } })
  if (!store) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  await prisma.store.update({ where: { id: storeId }, data })
  return NextResponse.json({ ok: true, ...data })
}
