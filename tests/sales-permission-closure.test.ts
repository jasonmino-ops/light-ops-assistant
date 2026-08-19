import assert from 'node:assert/strict'
import fs from 'node:fs'

const protectedRoutes = [
  'app/api/ops/applications/[id]/approve/route.ts',
  'app/api/ops/applications/[id]/reject/route.ts',
  'app/api/ops/conversations/route.ts',
  'app/api/ops/conversations/[telegramId]/route.ts',
  'app/api/ops/messages/route.ts',
  'app/api/ops/support/[telegramId]/takeover/route.ts',
]

for (const path of protectedRoutes) {
  const source = fs.readFileSync(path, 'utf8')
  assert.match(source, /hasOpsRole/)
  assert.match(source, /'OPS_ADMIN'/)
  assert.match(source, /status: 403/)
}

const merchantList = fs.readFileSync('app/api/ops/conversations/route.ts', 'utf8')
const merchantThread = fs.readFileSync('app/api/ops/conversations/[telegramId]/route.ts', 'utf8')
const merchantMessages = fs.readFileSync('app/api/ops/messages/route.ts', 'utf8')
const opsLeadList = fs.readFileSync('app/api/ops/sales-leads/route.ts', 'utf8')
const opsLeadDetail = fs.readFileSync('app/api/ops/sales-leads/[id]/route.ts', 'utf8')
const opsPage = fs.readFileSync('app/ops/page.tsx', 'utf8')

assert.match(merchantList, /channel: 'MERCHANT'/)
assert.match(merchantThread, /channel: 'MERCHANT'/)
assert.match(merchantMessages, /channel: 'MERCHANT'/)
assert.match(opsLeadList, /hasOpsRole\(ops\.role, 'OPS_ADMIN'\)/)
assert.match(opsLeadDetail, /hasOpsRole\(ops\.role, 'OPS_ADMIN'\)/)
assert.match(opsPage, /data\.opsRole === 'BD'/)
assert.match(opsPage, /window\.location\.replace\('\/ops\/sales'\)/)

console.log('sales permission closure tests passed')
