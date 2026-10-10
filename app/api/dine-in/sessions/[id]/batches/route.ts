/**
 * POST /api/dine-in/sessions/[id]/batches?storeCode=…
 *   { type: 'ORDER', requestKey, items: [{ barcode, quantity }] }                       new-business conditions
 *   { type: 'VOID',  requestKey, lines: [{ saleRecordId, quantity }], reason,
 *     kitchenConfirmed? }                                                               recovery gate, OWNER
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { diningActor, diningScope, loadDiningStore, newBusinessBlockers, requireOwner, requireRecoveryGate } from '@/lib/dine-in/eligibility'
import { addOrderBatch, voidLines } from '@/lib/dine-in/commands'
import { errorResponse, json, readBody, storeCodeFrom } from '@/lib/dine-in/http'
import { DiningCommandError } from '@/lib/dine-in/types'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let context: { tenantId: string; storeId: string; userId: string } | undefined
  try {
    const store = await loadDiningStore(storeCodeFrom(req))
    const input = await readBody(req)
    const { id } = await params
    if (input.type === 'ORDER') {
      // As for opening: authorise, replay by request key, then the new-business conditions.
      const authorization = await requireRecoveryGate(req, store)
      const result = await addOrderBatch(prisma, diningScope(store), diningActor(authorization), {
        store: { code: store.code, printKitchenTicket: store.printKitchenTicket },
        mealId: id, requestKey: input.requestKey, items: input.items,
        newBusinessBlockers: await newBusinessBlockers(req, store),
      })
      return json(result, result.replayed ? 200 : 201)
    }
    if (input.type === 'VOID') {
      const authorization = await requireRecoveryGate(req, store)
      requireOwner(authorization)
      context = { ...diningScope(store), userId: authorization.operatorUserId }
      const result = await voidLines(prisma, diningScope(store), diningActor(authorization), {
        mealId: id, requestKey: input.requestKey, lines: input.lines, reason: input.reason, kitchenConfirmed: input.kitchenConfirmed,
      })
      return json(result, result.replayed ? 200 : 201)
    }
    throw new DiningCommandError('BATCH_TYPE_INVALID', 400)
  } catch (error) { return errorResponse(error, context) }
}
