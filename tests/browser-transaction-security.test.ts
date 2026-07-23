import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NextRequest } from 'next/server'
import { getContext } from '../lib/context'
import {
  requiresCashierManualPaymentConfirmation,
  resolveCashierPaymentIntentStatus,
} from '../lib/cashier-payment-confirmation'
import {
  getShinhanPaymentAvailability,
  SHINHAN_PAYMENT_FROZEN_ERROR,
} from '../lib/payments/shinhan-config'
import { GET as shinhanConfigGet } from '../app/api/public/payments/shinhan/config/route'
import { POST as createShinhanPayment } from '../app/api/public/orders/[orderId]/payments/shinhan/create/route'
import {
  GET as shinhanCallbackGet,
  POST as shinhanCallbackPost,
} from '../app/api/payments/shinhan/callback/route'
import { POST as shinhanInquiryPost } from '../app/api/payments/shinhan/inquiry/route'

const mutableEnv = process.env as unknown as Record<string, string | undefined>
const originalNodeEnv = mutableEnv.NODE_ENV
const originalShinhanEnabled = mutableEnv.SHINHAN_PAYMENT_ENABLED
const originalShinhanMockMode = mutableEnv.SHINHAN_PAYMENT_MOCK_MODE

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
  assert.match(salesRouteSource, /requiresCashierManualPaymentConfirmation\(paymentMethod, manualPaymentConfirmed\)/,
    'the cashier write route must reject KHQR without that explicit confirmation')
  assert.match(salesRouteSource, /resolveCashierPaymentIntentStatus\(paymentMethod, manualPaymentConfirmed\)/,
    'the persisted PaymentIntent status must use the explicit confirmation decision')
  assert.match(cashierSource, /cashierSaleIdempotencyRef/,
    'cashier retry state must keep one stable idempotency key for a checkout attempt')
  assert.match(cashierSource, /'Idempotency-Key': idempotencyKey/,
    'browser cashier sales must send the stable idempotency key to the server')
  assert.match(cashierSource, /autoPrintedReceiptKeyRef\.current === receiptKey/,
    'a replayed order response must not trigger a second automatic receipt print')
  assert.match(salesRouteSource, /CashierSaleIdempotency/,
    'cashier sales must use a dedicated idempotency record rather than an audit log')
  assert.match(salesRouteSource, /ON CONFLICT \("tenantId", "storeId", "actorType", "actorId", "operation", "idempotencyKey"\)/,
    'same-key concurrent requests must have a database uniqueness gate')
  assert.match(salesRouteSource, /IDEMPOTENCY_KEY_PAYLOAD_MISMATCH/,
    'same-key payload changes must fail closed')
  const schemaSource = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')
  const idempotencyMigration = readFileSync(resolve(process.cwd(), 'prisma/migrations/20260724100000_ep_txn_idemp_01_cashier_sale_idempotency/migration.sql'), 'utf8')
  assert.match(schemaSource, /model CashierSaleIdempotency/,
    'cashier idempotency must have a dedicated persisted model')
  assert.match(schemaSource, /@@unique\(\[tenantId, storeId, actorType, actorId, operation, idempotencyKey\]\)/,
    'the idempotency model must make an actor-scoped operation unique')
  assert.match(idempotencyMigration, /CREATE TABLE "CashierSaleIdempotency"/,
    'the idempotency migration must be additive')

  const getResponse = shinhanCallbackGet()
  assert.equal(getResponse.status, 405, 'GET callback must never mutate payment state')
  assert.equal(getResponse.headers.get('allow'), 'POST')

  delete mutableEnv.SHINHAN_PAYMENT_ENABLED
  delete mutableEnv.SHINHAN_PAYMENT_MOCK_MODE
  assert.deepEqual(getShinhanPaymentAvailability(), { enabled: false, frozen: true },
    'the server-owned default must keep Shinhan frozen')
  assert.deepEqual(getShinhanPaymentAvailability({
    enabled: true,
    mockMode: true,
    baseUrl: 'https://uat.example.test',
    apiKey: 'test-key',
    secretKey: 'test-secret',
    merchantId: 'merchant',
    merchantName: 'merchant',
    callbackBaseUrl: 'https://app.example.test',
  }), { enabled: false, frozen: true },
  'mock configuration must not reopen the frozen payment capability')

  const configResponse = shinhanConfigGet(new NextRequest(
    'https://example.test/api/public/payments/shinhan/config?enabled=true&frozen=false',
  ))
  assert.equal(configResponse.status, 200)
  assert.deepEqual(await configResponse.json(), { enabled: false, frozen: true },
    'the public config endpoint must ignore client query values and keep the entry hidden')

  const createResponse = await createShinhanPayment(
    new NextRequest('https://example.test/api/public/orders/forged/payments/shinhan/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currency: 'USD' }),
    }),
    { params: Promise.resolve({ orderId: 'forged' }) },
  )
  assert.equal(createResponse.status, 503, 'frozen Shinhan must reject creation before any order or payment lookup')
  assert.equal((await createResponse.json()).error, SHINHAN_PAYMENT_FROZEN_ERROR)

  const callbackResponse = await shinhanCallbackPost(
    new NextRequest('https://example.test/api/payments/shinhan/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trxId: 'forged', respondCode: '200', paymentAmount: '1.00' }),
    }),
  )
  assert.equal(callbackResponse.status, 503, 'frozen callback must not advance a forged payment to PAID')
  assert.equal((await callbackResponse.json()).error, SHINHAN_PAYMENT_FROZEN_ERROR)

  const inquiryResponse = await shinhanInquiryPost(
    new NextRequest('https://example.test/api/payments/shinhan/inquiry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trxId: 'forged' }),
    }),
  )
  assert.equal(inquiryResponse.status, 503, 'frozen inquiry must not trigger a payment-status transition')
  assert.equal((await inquiryResponse.json()).error, SHINHAN_PAYMENT_FROZEN_ERROR)

  const menuSource = readFileSync(resolve(process.cwd(), 'app/menu/page.tsx'), 'utf8')
  const ordersSource = readFileSync(resolve(process.cwd(), 'app/menu/orders/page.tsx'), 'utf8')
  assert.match(menuSource, /const \[shinhanEnabled, setShinhanEnabled\] = useState\(false\)/,
    'checkout must default to no Shinhan payment entry')
  assert.match(menuSource, /\{shinhanEnabled && \(/,
    'checkout Shinhan button must be structurally gated rather than CSS-hidden')
  assert.match(ordersSource, /const \[shinhanEnabled, setShinhanEnabled\] = useState\(false\)/,
    'order history must default to no Shinhan action entry')
  assert.match(ordersSource, /\{shinhanEnabled && order\.paymentStatus !== 'PAID'/,
    'order-history Shinhan actions must be structurally gated while paid history remains readable')
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
  if (originalShinhanEnabled === undefined) delete mutableEnv.SHINHAN_PAYMENT_ENABLED
  else mutableEnv.SHINHAN_PAYMENT_ENABLED = originalShinhanEnabled
  if (originalShinhanMockMode === undefined) delete mutableEnv.SHINHAN_PAYMENT_MOCK_MODE
  else mutableEnv.SHINHAN_PAYMENT_MOCK_MODE = originalShinhanMockMode
  })
