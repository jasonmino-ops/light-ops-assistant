import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { GET } from '../app/api/ops/release-status/route'
import { signSession } from '../lib/session'

function request(session?: string) {
  return new NextRequest('http://localhost/api/ops/release-status', {
    headers: session ? { cookie: `auth-session=${session}` } : undefined,
  })
}

async function expectForbidden(req: NextRequest) {
  const response = await GET(req)
  const body = await response.text()
  assert.equal(response.status, 403)
  assert.doesNotMatch(body, /ES-PRINT-|ES-DESKTOP-/)
}

async function main() {
  await expectForbidden(request())

  const ordinaryOwner = signSession({
    tenantId: 'tenant-test',
    userId: 'owner-test',
    storeId: 'store-test',
    role: 'OWNER',
  })
  await expectForbidden(request(ordinaryOwner))

  const legacyOps = signSession({
    tenantId: '_ops',
    userId: '_ops_admin',
    storeId: '_ops',
    role: 'OWNER',
  })
  const authorized = await GET(request(legacyOps))
  assert.equal(authorized.status, 200)
  assert.equal(authorized.headers.get('cache-control'), 'private, no-store')

  const body = await authorized.json()
  assert.equal(body.pendingItems[0]?.taskId, 'ES-PRINT-SOURCE-ROUTING-NORMALIZATION-01')
  assert.equal(body.releasedAwaitingAcceptance[0]?.taskId, 'ES-PRINT-V3-OPERATOR-RECOVERY-01')
  assert.equal(body.recentlyCompleted[0]?.taskId, 'ES-DESKTOP-CASHIER-SIDEBAR-SIMPLIFICATION-01')

  console.log('ops-release-status-auth.test.ts: PASS')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
