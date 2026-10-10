/**
 * POST /api/dine-in/sessions?storeCode=…   open a table (new-business conditions)
 * Body: { tableId, guestCount, note?, requestKey }
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { diningActor, diningScope, loadDiningStore, newBusinessBlockers, requireRecoveryGate } from '@/lib/dine-in/eligibility'
import { openMeal } from '@/lib/dine-in/commands'
import { errorResponse, json, readBody, storeCodeFrom } from '@/lib/dine-in/http'

export async function POST(req: NextRequest) {
  try {
    const store = await loadDiningStore(storeCodeFrom(req))
    // Authorisation first; the new-business conditions are applied inside the command,
    // after the request-key lookup, so a committed request can always be replayed.
    const authorization = await requireRecoveryGate(req, store)
    const input = await readBody(req)
    const result = await openMeal(prisma, diningScope(store), diningActor(authorization), {
      tableId: input.tableId, guestCount: input.guestCount, note: input.note, requestKey: input.requestKey,
      newBusinessBlockers: await newBusinessBlockers(req, store),
    })
    return json(result, result.replayed ? 200 : 201)
  } catch (error) { return errorResponse(error) }
}
