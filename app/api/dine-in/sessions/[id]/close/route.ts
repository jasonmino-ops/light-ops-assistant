/**
 * POST /api/dine-in/sessions/[id]/close?storeCode=…
 * Body: { requestKey } — clear the table of a paid meal.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { diningActor, diningScope, loadDiningStore, requireRecoveryGate } from '@/lib/dine-in/eligibility'
import { clearMeal } from '@/lib/dine-in/commands'
import { errorResponse, json, readBody, storeCodeFrom } from '@/lib/dine-in/http'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const store = await loadDiningStore(storeCodeFrom(req))
    const authorization = await requireRecoveryGate(req, store)
    const input = await readBody(req)
    const { id } = await params
    return json(await clearMeal(prisma, diningScope(store), diningActor(authorization), { mealId: id, requestKey: input.requestKey }))
  } catch (error) { return errorResponse(error) }
}
