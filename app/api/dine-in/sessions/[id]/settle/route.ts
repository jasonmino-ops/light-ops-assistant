/**
 * POST /api/dine-in/sessions/[id]/settle?storeCode=…
 * Body: { requestKey, paymentMethod: 'CASH'|'KHQR', expectedAmount, expectedVersion, manualPaymentConfirmed? }
 *
 * Records that the cashier has collected exactly `expectedAmount` for this bill.
 * Kitchen notices never hold a payment back; what the kitchen has not been told
 * comes back in `kitchenWarnings`.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { diningActor, diningScope, loadDiningStore, requireRecoveryGate } from '@/lib/dine-in/eligibility'
import { settleMeal } from '@/lib/dine-in/commands'
import { errorResponse, json, readBody, storeCodeFrom } from '@/lib/dine-in/http'
import { findKhqrConfig } from '@/lib/merchant-config'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let context: { tenantId: string; storeId: string; userId: string } | undefined
  try {
    const store = await loadDiningStore(storeCodeFrom(req))
    const authorization = await requireRecoveryGate(req, store)
    context = { ...diningScope(store), userId: authorization.operatorUserId }
    const input = await readBody(req)
    const { id } = await params
    const khqr = input.paymentMethod === 'KHQR' ? await findKhqrConfig(store.tenantId, store.id) : null
    return json(await settleMeal(prisma, diningScope(store), diningActor(authorization), {
      store: { currencyCode: store.currencyCode },
      mealId: id,
      requestKey: input.requestKey,
      paymentMethod: input.paymentMethod,
      expectedAmount: input.expectedAmount,
      expectedVersion: input.expectedVersion,
      manualPaymentConfirmed: input.manualPaymentConfirmed,
      khqrConfig: khqr ? { provider: khqr.provider ?? null, merchantConfigId: khqr.id } : null,
    }))
  } catch (error) { return errorResponse(error, context) }
}
