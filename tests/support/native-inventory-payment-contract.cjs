'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(root, path, dependencies) {
  const filename = join(root, path)
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exported = {}
  vm.compileFunction(outputText, ['exports', 'require'], { filename })(exported, specifier => {
    assert.ok(Object.hasOwn(dependencies, specifier), `unexpected route dependency: ${specifier}`)
    return dependencies[specifier]
  })
  return exported
}

async function assertNativeInventoryPaymentContract(root) {
  const orderLock = load(root, 'lib/order-settlement-lock.ts', {})
  const intent = { id: 'intent', tenantId: 'tenant', storeId: 'selected-store', orderNo: 'order', status: 'PENDING' }

  for (const action of ['confirm', 'cancel']) {
    const targetStatus = action === 'confirm' ? 'PAID' : 'CANCELLED'

    async function run({ pending = 1, state = 'PENDING', role = 'OWNER', actorStore = intent.storeId,
      saleStores = ['actual-store'], hidden = false, rollback = false } = {}) {
      const actor = { tenantId: intent.tenantId, storeId: actorStore, role }
      const calls = []
      const queued = []
      const wakes = []
      const expectedScope = { tenantId: intent.tenantId, storeId: saleStores[0], orderNo: intent.orderNo }
      const scopeMatches = where => {
        for (const [key, value] of Object.entries(expectedScope)) assert.equal(where[key], value, key)
      }
      let inTransaction = false
      let committed = false
      const tx = {
        async $queryRaw(strings, key) {
          assert.ok(inTransaction)
          assert.match(strings.join(''), /pg_advisory_xact_lock\(hashtextextended/)
          assert.equal(key, JSON.stringify(['pos-order-settlement', intent.tenantId, intent.orderNo]))
          calls.push('lock')
        },
        paymentIntent: {
          async findUniqueOrThrow(query) {
            assert.deepEqual(calls.slice(-1), ['lock'])
            assert.equal(query.where.id, intent.id)
            calls.push('recheck')
            return { status: state }
          },
          async update({ where, data }) {
            assert.ok(inTransaction && calls.includes('scope'))
            assert.equal(where.id, intent.id)
            assert.equal(data.status, targetStatus)
            calls.push('payment')
          },
        },
        saleRecord: {
          async findMany({ where }) {
            assert.deepEqual(calls.slice(-1), ['recheck'])
            assert.equal(where.tenantId, intent.tenantId)
            assert.equal(where.orderNo, intent.orderNo)
            calls.push('scope')
            return saleStores.map(storeId => ({ storeId }))
          },
          async count({ where }) {
            assert.ok(inTransaction)
            assert.equal(action, 'cancel')
            scopeMatches(where)
            assert.equal(where.status, 'PENDING_PAYMENT')
            calls.push('count')
            return pending
          },
          async updateMany({ where, data }) {
            assert.ok(inTransaction && calls.includes('payment'))
            scopeMatches(where)
            assert.equal(where.status, action === 'confirm' ? 'PENDING_PAYMENT' : undefined)
            assert.equal(data.status, action === 'confirm' ? 'COMPLETED' : 'CANCELLED')
            calls.push('sale')
            if (rollback) throw new Error('simulated transaction rollback')
            return { count: pending }
          },
        },
      }
      const prisma = {
        paymentIntent: {
          async findFirst({ where }) {
            assert.equal(where.id, intent.id)
            assert.equal(where.tenantId, actor.tenantId)
            assert.equal(where.storeId, undefined)
            return hidden ? null : intent
          },
        },
        async $transaction(body) {
          assert.equal(typeof body, 'function')
          inTransaction = true
          try {
            const result = await body(tx)
            committed = true
            return result
          } finally {
            inTransaction = false
          }
        },
      }
      const route = load(root, `app/api/payments/[paymentId]/${action}/route.ts`, {
        'next/server': {
          after(fn) { assert.ok(committed && !inTransaction); queued.push(fn) },
          NextResponse: { json(body, init) { return { body, status: init?.status ?? 200 } } },
        },
        '@/lib/prisma': { prisma },
        '@/lib/order-settlement-lock': orderLock,
        '@/lib/context': { async getContext() { return actor } },
        '@/lib/cashier-realtime-notify': {
          notifyCashierGateway(payload) {
            assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
              tenantId: intent.tenantId, storeId: saleStores[0], type: 'pending_orders_changed',
            })
            wakes.push(payload)
            // A synchronous await would prevent the business response from completing.
            return { then() { throw new Error('gateway must not be awaited by the business response') } }
          },
        },
      })
      const request = route.POST({}, { params: Promise.resolve({ paymentId: intent.id }) })
      let response
      if (rollback) {
        await assert.rejects(request, /simulated transaction rollback/)
        assert.equal(committed, false)
      } else {
        response = await request
      }
      assert.equal(wakes.length, 0)
      for (const callback of queued) callback()
      return { status: response?.status, calls, wakes: wakes.length }
    }

    assert.deepEqual(await run(), {
      status: 200,
      calls: ['lock', 'recheck', 'scope', ...(action === 'cancel' ? ['count'] : []), 'payment', 'sale'],
      wakes: 1,
    })
    const noPending = await run({ pending: 0 })
    assert.equal(noPending.status, 200)
    assert.equal(noPending.wakes, 0)
    for (const state of ['PAID', 'CANCELLED']) {
      assert.deepEqual(await run({ state }), { status: 422, calls: ['lock', 'recheck', 'scope'], wakes: 0 })
    }
    const ownStore = await run({ role: 'STAFF', actorStore: 'actual-store' })
    assert.equal(ownStore.status, 200)
    assert.equal(ownStore.wakes, 1)
    for (const state of ['PENDING', 'PAID', 'CANCELLED']) {
      assert.deepEqual(await run({ role: 'STAFF', state }), { status: 404, calls: ['lock', 'recheck', 'scope'], wakes: 0 })
    }
    assert.deepEqual(await run({ saleStores: ['actual-store', 'other-store'] }), {
      status: 409, calls: ['lock', 'recheck', 'scope'], wakes: 0,
    })
    assert.deepEqual(await run({ hidden: true, role: 'STAFF' }), { status: 404, calls: [], wakes: 0 })
    assert.equal((await run({ rollback: true })).wakes, 0)
  }
}

module.exports = { assertNativeInventoryPaymentContract }
