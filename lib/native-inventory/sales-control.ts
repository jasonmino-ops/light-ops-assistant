import { prisma } from '@/lib/prisma'
import { InventoryError, object, operationId } from './input'
import type { InventoryPerson } from './service'

export type SalesControlState = {
  available: boolean; ready: boolean; enabled: boolean; epoch: string | null
  version: string; canControl: boolean; h5Refund: false; checkedAt: string
}
export type SalesControlIntent = {
  id: string; enabled: boolean; expectedVersion: string; expectedEpoch: string | null
  confirmations: { terminalsRefreshed: boolean; offlineQueueEmpty: boolean; noCheckout: boolean }
}
export type SalesControlResult = {
  id: string; actorId: string; at: string; outcome: 'APPLIED' | 'REJECTED' | 'NOT_APPLIED'; error: string | null
  beforeEnabled: boolean; beforeEpoch: string | null; afterEnabled: boolean; afterEpoch: string | null; version: string
}

export function controlIntent(value: unknown): { intent: SalesControlIntent; resolve: boolean } {
  const body = object(value)
  const allowed = ['id', 'enabled', 'expectedVersion', 'expectedEpoch', 'confirmations', 'resolve']
  if (Object.keys(body).some(key => !allowed.includes(key)) || typeof body.enabled !== 'boolean' ||
    typeof body.expectedVersion !== 'string' || !/^(0|[1-9]\d{0,14})$/.test(body.expectedVersion) ||
    (body.expectedEpoch !== null && (typeof body.expectedEpoch !== 'string' ||
      !Number.isFinite(Date.parse(body.expectedEpoch)) || new Date(body.expectedEpoch).toISOString() !== body.expectedEpoch)) ||
    (body.resolve !== undefined && typeof body.resolve !== 'boolean')) throw new InventoryError('INVALID_CONTROL_REQUEST', 400)
  const confirmations = object(body.confirmations)
  const keys = ['terminalsRefreshed', 'offlineQueueEmpty', 'noCheckout'] as const
  if (Object.keys(confirmations).length !== keys.length || keys.some(key => typeof confirmations[key] !== 'boolean')) {
    throw new InventoryError('INVALID_CONTROL_REQUEST', 400)
  }
  return { intent: {
    id: operationId(body.id), enabled: body.enabled, expectedVersion: body.expectedVersion,
    expectedEpoch: body.expectedEpoch as string | null,
    confirmations: { terminalsRefreshed: confirmations.terminalsRefreshed as boolean,
      offlineQueueEmpty: confirmations.offlineQueueEmpty as boolean, noCheckout: confirmations.noCheckout as boolean },
  }, resolve: body.resolve === true }
}

export async function salesControlState(person: InventoryPerson): Promise<SalesControlState> {
  const [row] = await prisma.$queryRaw<{ state: SalesControlState }[]>`
    SELECT native_inventory.sales_control_state(${person.tenantId}, ${person.storeId}, ${person.userId}) AS state
  `
  if (!row?.state) throw new InventoryError('STORE_ACCESS_DENIED', 403)
  return { ...row.state, epoch: row.state.epoch && new Date(row.state.epoch).toISOString() }
}

export async function setSalesControl(person: InventoryPerson, intent: SalesControlIntent, resolve: boolean) {
  const state = await salesControlState(person)
  if (!state.available) throw new InventoryError('DIAMOND_ONLY', 403)
  // One statement atomically checks membership, serializes the epoch and
  // appends immutable evidence. Never split this across database connections.
  let rows: { result: SalesControlResult }[]
  try {
    rows = await prisma.$queryRaw`
      SELECT native_inventory.sales_control_command(${person.tenantId}, ${person.storeId}, ${person.userId},
        ${intent.id}::uuid, ${JSON.stringify(intent)}::jsonb, ${resolve}) AS result
    `
  } catch (error) {
    const meta = (error as { meta?: { code?: string; message?: string; driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } }).meta
    const code = meta?.code ?? meta?.driverAdapterError?.cause?.originalCode
    const message = meta?.message ?? meta?.driverAdapterError?.cause?.originalMessage
    if (code === '22023' && message?.includes('CONTROL_REQUEST_CONFLICT')) throw new InventoryError('CONTROL_REQUEST_CONFLICT', 409)
    if (code === '42501' && message?.includes('OWNER_REQUIRED')) throw new InventoryError('OWNER_REQUIRED', 403)
    throw error
  }
  const [row] = rows
  if (!row?.result) throw new Error('CONTROL_RESULT_MISSING')
  return row.result
}
