/**
 * POST /api/dine-in/sessions/[id]/batches/[batchId]/renotify?storeCode=…
 * Body: { requestKey, reason, duplicateRiskAccepted? }
 *
 * A person asks for one more kitchen notice. It becomes a new batch with a new
 * print identity; the original identity is never submitted again. After the meal
 * has been paid, cleared or voided only a void notice can be sent again.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { diningActor, diningScope, loadDiningStore, requireRecoveryGate } from '@/lib/dine-in/eligibility'
import { renotifyBatch } from '@/lib/dine-in/commands'
import { errorResponse, json, readBody, storeCodeFrom } from '@/lib/dine-in/http'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; batchId: string }> }) {
  let context: { tenantId: string; storeId: string; userId: string } | undefined
  try {
    const store = await loadDiningStore(storeCodeFrom(req))
    const authorization = await requireRecoveryGate(req, store)
    context = { ...diningScope(store), userId: authorization.operatorUserId }
    const input = await readBody(req)
    const { id, batchId } = await params
    const result = await renotifyBatch(prisma, diningScope(store), diningActor(authorization), {
      mealId: id, refBatchId: batchId, requestKey: input.requestKey, reason: input.reason, duplicateRiskAccepted: input.duplicateRiskAccepted,
    })
    return json(result, result.replayed ? 200 : 201)
  } catch (error) { return errorResponse(error, context) }
}
