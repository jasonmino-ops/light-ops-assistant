import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryProfitAccess } from '@/lib/inventory-profit/access'
import { externalFailure, freshSnapshot } from '@/lib/inventory-profit/http'
import { getInventoryProfitProvider } from '@/lib/inventory-profit/provider'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const REQUEST_KEY_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/

function validDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export async function POST(req: NextRequest) {
  const access = await requireInventoryProfitAccess(req, { telegramPresence: true })
  if (!access.ok) return access.response
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 })
  }

  const requestKey = typeof body.requestKey === 'string' ? body.requestKey.trim() : ''
  const productId = typeof body.productId === 'string' ? body.productId.trim() : ''
  const quantity = typeof body.quantity === 'number' ? body.quantity : Number.NaN
  const unitCost = typeof body.unitCost === 'number' ? body.unitCost : Number.NaN
  const date = typeof body.date === 'string' ? body.date.trim() : ''
  if (!REQUEST_KEY_PATTERN.test(requestKey)) {
    return NextResponse.json({ ok: false, error: 'INVALID_REQUEST_KEY' }, { status: 400 })
  }
  if (!productId || productId.length > 128) {
    return NextResponse.json({ ok: false, error: 'INVALID_PRODUCT' }, { status: 400 })
  }
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
    return NextResponse.json({ ok: false, error: 'INVALID_QUANTITY' }, { status: 400 })
  }
  if (!Number.isFinite(unitCost) || unitCost < 0 || unitCost > 1_000_000_000) {
    return NextResponse.json({ ok: false, error: 'INVALID_UNIT_COST' }, { status: 400 })
  }
  if (!validDate(date)) {
    return NextResponse.json({ ok: false, error: 'INVALID_DATE' }, { status: 400 })
  }

  try {
    const fresh = freshSnapshot(await getInventoryProfitProvider().recordReceiving(access.access.ctx.storeId, {
      requestKey,
      productId,
      quantity,
      unitCost,
      date,
    }))
    if (!fresh.ok) return fresh.response
    return NextResponse.json({ ok: true, asOf: fresh.snapshot.asOf, data: fresh.snapshot.data }, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return externalFailure(error)
  }
}
