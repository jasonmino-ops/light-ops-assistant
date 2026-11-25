import { NextRequest, NextResponse } from 'next/server'
import { inventoryPerson, requireInventoryOwner } from '@/lib/native-inventory/access'
import { nativeInventoryAvailable } from '@/lib/native-inventory/rollout'
import { InventoryError } from '@/lib/native-inventory/input'
import { controlIntent, salesControlState, setSalesControl } from '@/lib/native-inventory/sales-control'

const headers = { 'cache-control': 'no-store' }
function failure(error: unknown, writing = false, id?: string) {
  if (error instanceof InventoryError) return NextResponse.json({ outcome: 'FAILED', error: error.code }, { status: error.status, headers })
  return NextResponse.json({ outcome: writing ? 'UNKNOWN' : 'FAILED', error: writing ? 'CHECK_OPERATION_STATUS' : 'CONTROL_UNAVAILABLE', id }, { status: 503, headers })
}
export async function GET(req: NextRequest) {
  try {
    if (!nativeInventoryAvailable()) throw new InventoryError('NATIVE_INVENTORY_DISABLED', 403)
    const person = await inventoryPerson(req)
    return NextResponse.json({ outcome: 'SUCCESS', data: await salesControlState(person) }, { headers })
  } catch (error) { return failure(error) }
}
export async function PUT(req: NextRequest) {
  let writing = false
  let id: string | undefined
  try {
    if (!nativeInventoryAvailable()) throw new InventoryError('NATIVE_INVENTORY_DISABLED', 403)
    const person = await inventoryPerson(req)
    requireInventoryOwner(person)
    const origin = req.headers.get('origin')
    const site = req.headers.get('sec-fetch-site')
    const host = req.headers.get('host') ?? req.nextUrl.host
    if (site === 'cross-site' || (origin && site !== 'same-origin' && origin !== req.nextUrl.origin && origin !== `${req.nextUrl.protocol}//${host}`)) {
      throw new InventoryError('ORIGIN_MISMATCH', 403)
    }
    let payload: unknown
    try { payload = await req.json() } catch { throw new InventoryError('INVALID_JSON', 400) }
    const { intent, resolve } = controlIntent(payload)
    id = intent.id
    writing = true
    const result = await setSalesControl(person, intent, resolve)
    return NextResponse.json({ outcome: 'SUCCESS', data: result }, { headers })
  } catch (error) { return failure(error, writing, id) }
}
