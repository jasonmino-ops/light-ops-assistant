/**
 * GET  /api/dine-in/tables?storeCode=…   tables with the meal currently on each, plus the first page of ended
 *                                        meals that still have a void notice to send
 * GET  /api/dine-in/tables?storeCode=…&recoverCursor=…   the next page of that list only
 * POST /api/dine-in/tables?storeCode=…   OWNER table maintenance (add / rename / hall-room / order / enable-disable)
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { diningActor, diningScope, loadDiningStore, requireNewBusinessGate, requireOwner, requireRecoveryGate } from '@/lib/dine-in/eligibility'
import { listRecoverableMeals, listTables, saveTable } from '@/lib/dine-in/commands'
import { errorResponse, json, readBody, storeCodeFrom } from '@/lib/dine-in/http'

export async function GET(req: NextRequest) {
  try {
    const store = await loadDiningStore(storeCodeFrom(req))
    await requireRecoveryGate(req, store)
    const scope = diningScope(store)
    const cursor = req.nextUrl.searchParams.get('recoverCursor')
    // A following page of the recovery list: nothing else is read, and a bad cursor is an error the page sees.
    if (cursor) return json({ recoverable: await listRecoverableMeals(prisma, scope, { cursor }) })
    const tables = await listTables(prisma, scope)
    // The table list must not fail because the recovery list could not be read; null tells the page it is unknown.
    const recoverable = await listRecoverableMeals(prisma, scope).catch((error) => { console.error('[dine-in] recoverable meals unavailable', error); return null })
    return json({ tables, recoverable })
  } catch (error) { return errorResponse(error) }
}

export async function POST(req: NextRequest) {
  try {
    const store = await loadDiningStore(storeCodeFrom(req))
    // Table maintenance prepares new business, so it sits behind the same gate.
    const authorization = await requireNewBusinessGate(req, store)
    requireOwner(authorization)
    const input = await readBody(req)
    const table = await saveTable(prisma, diningScope(store), diningActor(authorization), {
      tableId: input.tableId, name: input.name, areaKind: input.areaKind, sortOrder: input.sortOrder, isActive: input.isActive,
    })
    return json({ table }, input.tableId === undefined ? 201 : 200)
  } catch (error) { return errorResponse(error) }
}
