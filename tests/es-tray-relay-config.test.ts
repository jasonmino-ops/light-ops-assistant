import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import type { RequestContext } from '../lib/context'
import {
  handleRelayConfigRequest,
  type RelayConfigRouteDependencies,
} from '../app/api/es-tray-02/config/route'

const ownerContext: RequestContext = {
  tenantId: 'tenant-a',
  storeId: 'store-a',
  userId: 'owner-a',
  role: 'OWNER',
}

function request() {
  return new NextRequest('http://localhost/api/es-tray-02/config')
}

function dependencies(options?: {
  context?: RequestContext | null
  active?: boolean
  onScope?: (scope: { tenantId: string; storeId: string }) => void
}): RelayConfigRouteDependencies {
  return {
    async getRequestContext() {
      return options && 'context' in options ? options.context ?? null : ownerContext
    },
    async isActiveStoreScope(scope) {
      options?.onScope?.(scope)
      return options?.active ?? true
    },
  }
}

async function body(response: Response) {
  return await response.json() as Record<string, unknown>
}

let cases = 0
async function test(name: string, run: () => Promise<void>) {
  await run()
  cases += 1
  console.log(`PASS ${name}`)
}

async function main() {
await test('authenticated OWNER with an active store receives 200', async () => {
  const response = await handleRelayConfigRequest(request(), dependencies())
  assert.equal(response.status, 200)
})

await test('the Desktop compatibility marker remains fieldOnly=true', async () => {
  const response = await handleRelayConfigRequest(request(), dependencies())
  assert.equal((await body(response)).fieldOnly, true)
})

await test('an eligible authenticated store receives enabled=true', async () => {
  const response = await handleRelayConfigRequest(request(), dependencies())
  assert.equal((await body(response)).enabled, true)
})

await test('every successful gate response is non-cacheable', async () => {
  const response = await handleRelayConfigRequest(request(), dependencies())
  assert.match(response.headers.get('cache-control') ?? '', /no-store/)
})

await test('an unauthenticated request is rejected', async () => {
  const response = await handleRelayConfigRequest(request(), dependencies({ context: null }))
  assert.equal(response.status, 401)
  assert.equal((await body(response)).error, 'LOGIN_REQUIRED')
  assert.match(response.headers.get('cache-control') ?? '', /no-store/)
})

await test('a non-OWNER request is rejected by the current relay policy', async () => {
  const response = await handleRelayConfigRequest(request(), dependencies({
    context: { ...ownerContext, role: 'STAFF' },
  }))
  assert.equal(response.status, 403)
  assert.equal((await body(response)).error, 'OWNER_REQUIRED')
})

await test('tenant scope comes only from the authenticated context', async () => {
  let observedTenant = ''
  await handleRelayConfigRequest(request(), dependencies({
    onScope: (scope) => { observedTenant = scope.tenantId },
  }))
  assert.equal(observedTenant, ownerContext.tenantId)
})

await test('store scope comes only from the authenticated context', async () => {
  let observedStore = ''
  await handleRelayConfigRequest(request(), dependencies({
    onScope: (scope) => { observedStore = scope.storeId },
  }))
  assert.equal(observedStore, ownerContext.storeId)
})

await test('an inactive or invalid tenant/store scope is disabled', async () => {
  const response = await handleRelayConfigRequest(request(), dependencies({ active: false }))
  assert.equal(response.status, 200)
  assert.deepEqual(await body(response), {
    fieldOnly: true,
    productionContract: true,
    enabled: false,
  })
})

await test('the exact Desktop 0.4.7 parser selects the enqueue path', async () => {
  const response = await handleRelayConfigRequest(request(), dependencies())
  const config = await body(response)
  const cloudRelayState = config.fieldOnly === true && config.enabled === true
    ? 'enabled'
    : 'disabled'
  assert.equal(cloudRelayState, 'enabled')
})

await test('the gate does not depend on Tray or printer online state', async () => {
  let scopeChecks = 0
  const response = await handleRelayConfigRequest(request(), dependencies({
    onScope: () => { scopeChecks += 1 },
  }))
  assert.equal(response.status, 200)
  assert.equal(scopeChecks, 1)
  assert.equal((await body(response)).enabled, true)
})

await test('the response exposes no credential or claim material', async () => {
  const response = await handleRelayConfigRequest(request(), dependencies())
  const config = await body(response)
  assert.deepEqual(Object.keys(config).sort(), ['enabled', 'fieldOnly', 'productionContract'])
  assert.doesNotMatch(JSON.stringify(config), /secret|claimToken|deviceToken/i)
})

console.log(`es-tray relay config tests passed (${cases} cases)`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
