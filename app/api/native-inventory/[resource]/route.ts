import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { inventoryPerson, requireInventoryOwner } from '@/lib/native-inventory/access'
import { InventoryError, object, operationId, requiredText, revision } from '@/lib/native-inventory/input'
import { nativeInventoryAvailable } from '@/lib/native-inventory/rollout'
import * as inventory from '@/lib/native-inventory/service'

type RouteContext = { params: Promise<{ resource: string }> }
const headers = { 'cache-control': 'no-store' }

function success(data: unknown) {
  return NextResponse.json({ outcome: 'SUCCESS', data }, { headers })
}

function failure(error: unknown, writing = false, requestId?: string) {
  if (error instanceof InventoryError) {
    return NextResponse.json({ outcome: 'FAILED', error: error.code }, { status: error.status, headers })
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return NextResponse.json({ outcome: 'FAILED', error: 'UNIQUE_CONFLICT' }, { status: 409, headers })
  }
  console.error('[native-inventory]', {
    outcome: writing ? 'UNKNOWN' : 'FAILED',
    requestId,
    code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : error instanceof Error ? error.name : 'UnknownError',
  })
  return NextResponse.json({
    outcome: writing ? 'UNKNOWN' : 'FAILED',
    error: writing ? 'CHECK_OPERATION_STATUS' : 'INVENTORY_UNAVAILABLE',
  }, { status: 503, headers })
}

function timestamp(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new InventoryError('INVALID_DATE')
  }
  const date = new Date(value)
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value) throw new InventoryError('INVALID_DATE')
  return date
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  if (!nativeInventoryAvailable()) return failure(new InventoryError('NATIVE_INVENTORY_DISABLED', 403))
  try {
    const { resource } = await params
    const person = await inventoryPerson(req)
    const query = req.nextUrl.searchParams
    const q = query.get('q')?.trim() ?? ''
    const id = query.get('id')
    if (q.length > 120) throw new InventoryError('INVALID_QUERY')

    switch (resource) {
      case 'access':
        return success({ role: person.role, currencyCode: person.currencyCode, storeName: person.storeName, storeId: person.storeId, userId: person.userId })
      case 'items':
        return success(await inventory.listItems(person, q, query.get('mode') === 'barcode', query.get('after') || undefined))
      case 'receipt-result':
        return success(await inventory.checkReceiptResult(person, operationId(id)))
      case 'receipts': {
        if (id) return success(await inventory.getReceipt(person, operationId(id)))
        const before = query.get('before')
        const beforeId = query.get('beforeId')
        return success(await inventory.listReceipts(person, before || beforeId
          ? { createdAt: timestamp(before), id: operationId(beforeId) }
          : undefined))
      }
      case 'suppliers':
        if (!id) return success(await inventory.listSuppliers(person, q))
        requireInventoryOwner(person)
        return success(await inventory.getSupplierPurchases(person, operationId(id)))
      case 'catalog':
        requireInventoryOwner(person)
        return success(await inventory.listCatalog(person, q))
      case 'movements':
        requireInventoryOwner(person)
        return success(await inventory.listMovements(person, id ? requiredText(id) : undefined))
      case 'profit': {
        requireInventoryOwner(person)
        const from = timestamp(query.get('from'))
        const until = timestamp(query.get('until'))
        if (from >= until) throw new InventoryError('INVALID_DATE_RANGE')
        return success(await inventory.listProfit(person, from, until))
      }
      default:
        throw new InventoryError('NOT_FOUND', 404)
    }
  } catch (error) {
    return failure(error)
  }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  if (!nativeInventoryAvailable()) return failure(new InventoryError('NATIVE_INVENTORY_DISABLED', 403))
  let writing = false
  let requestId: string | undefined
  try {
    const { resource } = await params
    const person = await inventoryPerson(req)
    const origin = req.headers.get('origin')
    const fetchSite = req.headers.get('sec-fetch-site')
    // Next can normalize its internal URL to localhost even when the
    // browser sends the public host or the loopback address.
    const requestHost = req.headers.get('host') ?? req.nextUrl.host
    const proto = req.nextUrl.protocol
    const sameOrigin = origin === req.nextUrl.origin || origin === `${proto}//${requestHost}`
    if (fetchSite === 'cross-site' || (origin && fetchSite !== 'same-origin' && !sameOrigin)) {
      throw new InventoryError('ORIGIN_MISMATCH', 403)
    }
    let payload: unknown
    try {
      payload = await req.json()
    } catch {
      throw new InventoryError('INVALID_JSON', 400)
    }
    const body = object(payload)
    if (resource === 'import-preview') return success(await inventory.resolveImportRows(person, body.rows))
    writing = true
    if (typeof body.id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.id)) requestId = body.id

    switch (resource) {
      case 'items':
        requireInventoryOwner(person)
        return success(await inventory.createItem(person, body))
      case 'adjustments':
        requireInventoryOwner(person)
        return success(await inventory.adjust(person, body))
      case 'suppliers':
        return success(await inventory.saveSupplier(person, body))
      case 'receipts':
        return success(await inventory.saveReceipt(person, body))
      case 'receipt-delete':
        return success(await inventory.deleteDraft(person, operationId(body.id), revision(body.revision)))
      case 'receipt-confirmation':
        return success(await inventory.confirmReceipt(person, operationId(body.id), revision(body.revision)))
      case 'receivers':
        requireInventoryOwner(person)
        if (typeof body.enabled !== 'boolean') throw new InventoryError('INVALID_ENABLED')
        await inventory.setReceiver(person, requiredText(body.userId), body.enabled)
        return success({ enabled: body.enabled })
      default:
        throw new InventoryError('NOT_FOUND', 404)
    }
  } catch (error) {
    return failure(error, writing, requestId)
  }
}
