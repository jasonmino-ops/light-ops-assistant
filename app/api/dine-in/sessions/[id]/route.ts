/**
 * GET  /api/dine-in/sessions/[id]?storeCode=…   the whole bill, with kitchen notice states
 * POST /api/dine-in/sessions/[id]?storeCode=…   { action: 'VOID', requestKey } — void a meal with no unpaid line and no payment on its bill (OWNER)
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { diningActor, diningScope, loadDiningStore, requireOwner, requireRecoveryGate } from '@/lib/dine-in/eligibility'
import { getMealView, voidMeal } from '@/lib/dine-in/commands'
import { errorResponse, json, readBody, storeCodeFrom } from '@/lib/dine-in/http'
import { DiningCommandError } from '@/lib/dine-in/types'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const store = await loadDiningStore(storeCodeFrom(req))
    await requireRecoveryGate(req, store)
    const { id } = await params
    return json({ meal: await getMealView(prisma, diningScope(store), id) })
  } catch (error) { return errorResponse(error) }
}

export async function POST(req: NextRequest, { params }: Params) {
  let context: { tenantId: string; storeId: string; userId: string } | undefined
  try {
    const store = await loadDiningStore(storeCodeFrom(req))
    const authorization = await requireRecoveryGate(req, store)
    requireOwner(authorization)
    context = { ...diningScope(store), userId: authorization.operatorUserId }
    const input = await readBody(req)
    if (input.action !== 'VOID') throw new DiningCommandError('SESSION_ACTION_INVALID', 400)
    const { id } = await params
    return json(await voidMeal(prisma, diningScope(store), diningActor(authorization), { mealId: id, requestKey: input.requestKey }))
  } catch (error) { return errorResponse(error, context) }
}
