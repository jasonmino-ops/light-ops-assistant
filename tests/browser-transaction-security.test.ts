import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NextRequest } from 'next/server'
import { getContext } from '../lib/context'
import {
  requiresCashierManualPaymentConfirmation,
  resolveCashierPaymentIntentStatus,
} from '../lib/cashier-payment-confirmation'
import { GET as shinhanCallbackGet } from '../app/api/payments/shinhan/callback/route'

const mutableEnv = process.env as unknown as Record<string, string | undefined>
const originalNodeEnv = mutableEnv.NODE_ENV

async function main() {
  const forgedDevHeaders = {
    'x-tenant-id': 'forged-tenant',
    'x-user-id': 'forged-user',
    'x-store-id': 'forged-store',
    'x-role': 'OWNER',
  }

  mutableEnv.NODE_ENV = 'production'
  const productionContext = await getContext(new NextRequest('https://example.test/api/cashier/sales', {
    headers: forgedDevHeaders,
  }))
  assert.equal(productionContext, null, 'production must reject forged x-* identity headers')

  mutableEnv.NODE_ENV = 'test'
  const testContext = await getContext(new NextRequest('https://example.test/api/cashier/sales', {
    headers: forgedDevHeaders,
  }))
  assert.deepEqual(testContext, {
    tenantId: 'forged-tenant',
    userId: 'forged-user',
    storeId: 'forged-store',
    role: 'OWNER',
  }, 'non-production test helpers may keep their explicit dev-header fallback')

  assert.equal(resolveCashierPaymentIntentStatus('CASH', false), 'PAID')
  assert.equal(resolveCashierPaymentIntentStatus('KHQR', false), 'PENDING')
  assert.equal(resolveCashierPaymentIntentStatus('KHQR', true), 'PAID')
  assert.equal(requiresCashierManualPaymentConfirmation('KHQR', false), true)
  assert.equal(requiresCashierManualPaymentConfirmation('KHQR', true), false)

  const cashierSource = readFileSync(resolve(process.cwd(), 'app/cashier/page.tsx'), 'utf8')
  const salesRouteSource = readFileSync(resolve(process.cwd(), 'app/api/cashier/sales/route.ts'), 'utf8')
  assert.match(cashierSource, /manualPaymentConfirmed:\s*apiPayment === 'KHQR'/,
    'the existing final confirmation action must explicitly declare manual KHQR confirmation')
  assert.match(salesRouteSource, /requiresCashierManualPaymentConfirmation\(paymentMethod, manualPaymentConfirmed === true\)/,
    'the cashier write route must reject KHQR without that explicit confirmation')
  assert.match(salesRouteSource, /resolveCashierPaymentIntentStatus\([\s\S]*manualPaymentConfirmed === true/,
    'the persisted PaymentIntent status must use the explicit confirmation decision')

  const getResponse = shinhanCallbackGet()
  assert.equal(getResponse.status, 405, 'GET callback must never mutate payment state')
  assert.equal(getResponse.headers.get('allow'), 'POST')
}

main()
  .then(() => {
    console.log('browser transaction security focused checks passed')
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
  if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV
  else mutableEnv.NODE_ENV = originalNodeEnv
  })
