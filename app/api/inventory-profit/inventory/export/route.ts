import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryProfitAccess } from '@/lib/inventory-profit/access'
import { inventoryAlert } from '@/lib/inventory-profit/contract'
import { externalFailure, freshSnapshot } from '@/lib/inventory-profit/http'
import { getInventoryProfitProvider } from '@/lib/inventory-profit/provider'

function csvCell(value: string | number | null) {
  if (value === null) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export async function GET(req: NextRequest) {
  const access = await requireInventoryProfitAccess(req, { telegramPresence: true })
  if (!access.ok) return access.response
  try {
    const fresh = freshSnapshot(await getInventoryProfitProvider().listInventory(access.access.ctx.storeId, { alertsOnly: false }))
    if (!fresh.ok) return fresh.response
    const header = ['商品ID', 'SKU', '条码', '商品名', '当前库存', '最低库存', '预警', '平均成本', '库存价值', '更新时间']
    const rows = fresh.snapshot.data.map((item) => [
      item.productId,
      item.sku,
      item.barcode,
      item.name,
      item.currentStock,
      item.minimumStock,
      inventoryAlert(item),
      item.averageCost,
      item.inventoryValue,
      item.updatedAt,
    ].map(csvCell).join(','))
    const csv = `\uFEFF${header.join(',')}\r\n${rows.join('\r\n')}\r\n`
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="inventory.csv"',
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    return externalFailure(error)
  }
}
