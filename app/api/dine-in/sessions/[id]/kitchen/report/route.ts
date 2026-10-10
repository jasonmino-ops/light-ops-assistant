/**
 * POST /api/dine-in/sessions/[id]/kitchen/report?storeCode=…
 * Body: { batchId, outcome }
 *
 * Step 3 of a kitchen notice: the page records what the print bridge answered to
 * its single submit. Stored once, shown as a hint; execution evidence is read from
 * the existing print job rows instead.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { diningActor, diningScope, loadDiningStore, requireRecoveryGate } from '@/lib/dine-in/eligibility'
import { reportNotice } from '@/lib/dine-in/commands'
import { errorResponse, json, readBody, storeCodeFrom } from '@/lib/dine-in/http'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const store = await loadDiningStore(storeCodeFrom(req))
    const authorization = await requireRecoveryGate(req, store)
    const input = await readBody(req)
    const { id } = await params
    return json(await reportNotice(prisma, diningScope(store), diningActor(authorization), { mealId: id, batchId: input.batchId, outcome: input.outcome }))
  } catch (error) { return errorResponse(error) }
}
