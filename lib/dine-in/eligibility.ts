import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authorizeDesktopPosRequest, type DesktopPosAuthorization } from '@/lib/desktop-pos-auth'
import { isDesktopPosRequest } from '@/lib/desktop-network-print'
import { DiningCommandError, type DiningActor, type DiningScope } from './types'

export type DiningStore = {
  id: string
  tenantId: string
  code: string
  name: string
  status: 'ACTIVE' | 'DISABLED'
  businessType: string
  currencyCode: string
  printKitchenTicket: boolean
}

export type DiningNewBusinessReason =
  | 'STORE_NOT_ACTIVE'
  | 'BUSINESS_TYPE_NOT_FOOD'
  | 'STORE_NOT_IN_TRIAL'
  | 'V3_LOCAL_MODE_REQUIRED'
  | 'DESKTOP_REQUEST_REQUIRED'

export function diningScope(store: DiningStore): DiningScope {
  return { tenantId: store.tenantId, storeId: store.id }
}

export function diningActor(authorization: DesktopPosAuthorization): DiningActor {
  return { userId: authorization.operatorUserId, role: authorization.role }
}

/** Trial list: comma-separated store codes in DINE_IN_TRIAL_STORE_CODES. Empty means nobody. */
export function isDiningTrialStore(storeCode: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.DINE_IN_TRIAL_STORE_CODES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(storeCode)
}

export async function loadDiningStore(storeCode: string | null | undefined): Promise<DiningStore> {
  const code = storeCode?.trim()
  if (!code) throw new DiningCommandError('MISSING_STORE_CODE', 400)
  const store = await prisma.store.findUnique({
    where: { code },
    select: { id: true, tenantId: true, code: true, name: true, status: true, businessType: true, currencyCode: true, printKitchenTicket: true },
  })
  if (!store) throw new DiningCommandError('STORE_NOT_FOUND', 404)
  return store
}

/** Operator authentication. Identical to the Desktop cashier: no store-code fallback. */
async function authorize(req: NextRequest, store: DiningStore): Promise<DesktopPosAuthorization> {
  const authorization = await authorizeDesktopPosRequest(
    req,
    { tenantId: store.tenantId, storeId: store.id, storeCode: store.code },
    { allowStoreCodeFallback: false },
  )
  if (!authorization) throw new DiningCommandError('POS_DEVICE_UNAUTHORIZED', 403)
  return authorization
}

/**
 * Why this store cannot start new dine-in business right now. Every condition is
 * something the server can check; the Desktop marker is a request header and only
 * keeps ordinary browsers out, it is not a security boundary.
 */
export async function newBusinessBlockers(req: NextRequest, store: DiningStore): Promise<DiningNewBusinessReason[]> {
  const reasons: DiningNewBusinessReason[] = []
  if (store.status !== 'ACTIVE') reasons.push('STORE_NOT_ACTIVE')
  if (store.businessType !== 'FOOD') reasons.push('BUSINESS_TYPE_NOT_FOOD')
  if (!isDiningTrialStore(store.code)) reasons.push('STORE_NOT_IN_TRIAL')
  const controlPlane = await prisma.v3PrintControlPlane.findUnique({
    where: { storeId: store.id },
    select: { tenantId: true, mode: true },
  })
  if (!controlPlane || controlPlane.tenantId !== store.tenantId || controlPlane.mode !== 'V3_ACTIVE') {
    reasons.push('V3_LOCAL_MODE_REQUIRED')
  }
  if (!isDesktopPosRequest(req)) reasons.push('DESKTOP_REQUEST_REQUIRED')
  return reasons
}

/** Gate for opening a table and placing or adding an order. */
export async function requireNewBusinessGate(req: NextRequest, store: DiningStore): Promise<DesktopPosAuthorization> {
  const authorization = await authorize(req, store)
  const reasons = await newBusinessBlockers(req, store)
  if (reasons.length > 0) throw new DiningCommandError('DINE_IN_NEW_BUSINESS_UNAVAILABLE', 403, { reasons })
  return authorization
}

/**
 * Gate for everything that settles business already started: viewing, voiding,
 * settling, clearing, and kitchen notice handling. It deliberately ignores the
 * business type, the trial list and the print mode, so a bill can always be closed.
 */
export async function requireRecoveryGate(req: NextRequest, store: DiningStore): Promise<DesktopPosAuthorization> {
  const authorization = await authorize(req, store)
  if (store.status !== 'ACTIVE') throw new DiningCommandError('STORE_NOT_ACTIVE', 403)
  return authorization
}

/**
 * OWNER-only actions: void a line, void an empty meal, maintain tables.
 * Desktop running on device authorization is always OWNER (existing identity
 * model); the STAFF restriction only bites when the operator chose a STAFF account.
 */
export function requireOwner(authorization: DesktopPosAuthorization): void {
  if (authorization.role !== 'OWNER') throw new DiningCommandError('OWNER_REQUIRED', 403)
}

export { authorize as authorizeDiningOperator }
