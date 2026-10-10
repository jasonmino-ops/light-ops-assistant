/**
 * POST /api/dine-in/sessions/[id]/kitchen/claim?storeCode=…
 * Body: { batchId }
 *
 * Step 1 of a kitchen notice. Exactly one caller receives the printable content of
 * a batch; every later call receives the notice state and no content.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { diningActor, diningScope, loadDiningStore, requireRecoveryGate } from '@/lib/dine-in/eligibility'
import { claimNotice } from '@/lib/dine-in/commands'
import { errorResponse, json, readBody, storeCodeFrom } from '@/lib/dine-in/http'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const store = await loadDiningStore(storeCodeFrom(req))
    const authorization = await requireRecoveryGate(req, store)
    const input = await readBody(req)
    const { id } = await params
    return json(await claimNotice(prisma, diningScope(store), diningActor(authorization), { mealId: id, batchId: input.batchId }))
  } catch (error) { return errorResponse(error) }
}
