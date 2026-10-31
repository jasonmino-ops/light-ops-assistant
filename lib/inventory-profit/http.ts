import { NextResponse } from 'next/server'
import { InventoryProfitExternalError } from './external-google-provider'
import { isSnapshotStale, type ExternalSnapshot } from './contract'

export const INVENTORY_PROFIT_UNAVAILABLE_MESSAGE = '数据暂时无法更新'

export function externalFailure(error: unknown) {
  const code = error instanceof InventoryProfitExternalError ? error.code : 'UNAVAILABLE'
  return NextResponse.json({
    ok: false,
    state: code,
    message: INVENTORY_PROFIT_UNAVAILABLE_MESSAGE,
  }, {
    status: 503,
    headers: { 'cache-control': 'no-store' },
  })
}

export function freshSnapshot<T>(snapshot: ExternalSnapshot<T>) {
  if (isSnapshotStale(snapshot.asOf)) {
    return { ok: false as const, response: NextResponse.json({
      ok: false,
      state: 'STALE',
      message: INVENTORY_PROFIT_UNAVAILABLE_MESSAGE,
    }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    }) }
  }
  return { ok: true as const, snapshot }
}
