/**
 * GET /api/dine-in/eligibility?storeCode=…
 *
 * Read-only answer for the cashier entry button. It grants nothing: every dine-in
 * endpoint runs its own gate.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authorizeDiningOperator, diningScope, loadDiningStore, newBusinessBlockers } from '@/lib/dine-in/eligibility'
import { hasActiveMeals } from '@/lib/dine-in/commands'
import { errorResponse, json, storeCodeFrom } from '@/lib/dine-in/http'

export async function GET(req: NextRequest) {
  try {
    const store = await loadDiningStore(storeCodeFrom(req))
    const authorization = await authorizeDiningOperator(req, store)
    const reasons = await newBusinessBlockers(req, store)
    const recoveryAvailable = store.status === 'ACTIVE'
    return json({
      eligible: reasons.length === 0,
      reasons,
      recoveryAvailable,
      hasActiveMeals: recoveryAvailable ? await hasActiveMeals(prisma, diningScope(store)) : false,
      role: authorization.role,
      operatorSource: authorization.source,
      store: { code: store.code, name: store.name, currencyCode: store.currencyCode, printKitchenTicket: store.printKitchenTicket },
    })
  } catch (error) { return errorResponse(error) }
}
