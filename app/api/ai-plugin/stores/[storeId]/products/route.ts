/**
 * GET /api/ai-plugin/stores/:storeId/products
 *
 * 灵烁 AI 客服回查商品的唯一只读端点（第一阶段）。
 *
 * 必带 Header（由 lib/ai-support/verify-incoming.ts 校验）：
 *   X-AI-Client-Id, X-AI-Timestamp, X-AI-Signature, X-AI-Session-Id
 *
 * 数据范围：严格按 sessionId 绑定的 tenantId 过滤；
 * URL :storeId 必须等于 session.storeId（不同则 401）。
 *
 * 返回字段白名单（显式 select）：
 *   id, barcode, name, spec, sellPrice, categoryId,
 *   imageUrl, descZh, descEn, descKm
 * 绝不返回：cost、supplier、internalRemark、imageStorageKey*、imageUrls JSON 原文。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  verifyIncomingAiRequest,
  aiPluginErrorResponse,
} from '@/lib/ai-support/verify-incoming'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await params

  try {
    const verified = await verifyIncomingAiRequest(req, '', {
      expectedStoreId: storeId,
    })

    const limitRaw = Number(req.nextUrl.searchParams.get('limit'))
    const limit = Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
      : DEFAULT_LIMIT

    // 解析门店所属 tenantId — 必须等于 session 的 tenantId（双保险）
    const store = await prisma.store.findFirst({
      where: { id: storeId, tenantId: verified.tenantId, status: 'ACTIVE' },
      select: { id: true, tenantId: true, code: true, name: true },
    })
    if (!store) {
      return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
    }

    const products = await prisma.product.findMany({
      where: { tenantId: store.tenantId, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      take: limit,
      select: {
        id: true,
        barcode: true,
        name: true,
        spec: true,
        sellPrice: true,
        categoryId: true,
        imageUrl: true,
        descZh: true,
        descEn: true,
        descKm: true,
      },
    })

    return NextResponse.json({
      sessionId: verified.sessionId,
      store: { id: store.id, code: store.code, name: store.name },
      count: products.length,
      products: products.map((p) => ({
        id: p.id,
        barcode: p.barcode,
        name: p.name,
        spec: p.spec ?? null,
        price: p.sellPrice.toNumber(),
        categoryId: p.categoryId ?? null,
        imageUrl: p.imageUrl ?? null,
        desc: {
          zh: p.descZh ?? null,
          en: p.descEn ?? null,
          km: p.descKm ?? null,
        },
      })),
    })
  } catch (err) {
    return aiPluginErrorResponse(err)
  }
}
