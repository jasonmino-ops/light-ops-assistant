import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryProfitAccess } from '@/lib/inventory-profit/access'
import { inventoryAlert, matchesInventorySearch } from '@/lib/inventory-profit/contract'
import { externalFailure, freshSnapshot } from '@/lib/inventory-profit/http'
import { getInventoryProfitProvider } from '@/lib/inventory-profit/provider'

export async function GET(req: NextRequest) {
  const access = await requireInventoryProfitAccess(req)
  if (!access.ok) return access.response
  const query = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  const alertsOnly = req.nextUrl.searchParams.get('all') !== '1'

  try {
    const provider = getInventoryProfitProvider()
    const fresh = freshSnapshot(await provider.listInventory(access.access.ctx.storeId, { query, alertsOnly }))
    if (!fresh.ok) return fresh.response
    const items = fresh.snapshot.data
      .filter((item) => matchesInventorySearch(item, query))
      .map((item) => ({
        productId: item.productId,
        sku: item.sku,
        barcode: item.barcode,
        name: item.name,
        currentStock: item.currentStock,
        minimumStock: item.minimumStock,
        alert: inventoryAlert(item),
        updatedAt: item.updatedAt,
      }))
      .filter((item) => !alertsOnly || item.alert !== null)
    return NextResponse.json({ ok: true, asOf: fresh.snapshot.asOf, items }, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return externalFailure(error)
  }
}

export async function PATCH(req: NextRequest) {
  const access = await requireInventoryProfitAccess(req)
  if (!access.ok) return access.response
  let body: { minimumStock?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 })
  }
  const minimumStock = Number(body.minimumStock)
  if (!Number.isInteger(minimumStock) || minimumStock < 0 || minimumStock > 1_000_000) {
    return NextResponse.json({ ok: false, error: 'INVALID_MINIMUM_STOCK' }, { status: 400 })
  }
  try {
    const fresh = freshSnapshot(await getInventoryProfitProvider().setMinimumStock(access.access.ctx.storeId, minimumStock))
    if (!fresh.ok) return fresh.response
    return NextResponse.json({ ok: true, asOf: fresh.snapshot.asOf, data: fresh.snapshot.data }, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return externalFailure(error)
  }
}
