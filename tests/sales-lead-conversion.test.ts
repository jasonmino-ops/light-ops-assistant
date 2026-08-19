import assert from 'node:assert/strict'
import fs from 'node:fs'

const approve = fs.readFileSync('app/api/ops/applications/[id]/approve/route.ts', 'utf8')
const reject = fs.readFileSync('app/api/ops/applications/[id]/reject/route.ts', 'utf8')
const applications = fs.readFileSync('app/api/ops/applications/route.ts', 'utf8')
const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')

assert.match(approve, /prisma\.\$transaction/)
assert.match(approve, /getSalesLeadTelegramAdvisoryKey\(preflight\.telegramId\)/)
assert.match(reject, /getSalesLeadTelegramAdvisoryKey\(application\.telegramId\)/)
assert.match(approve, /where: \{ id, status: 'PENDING' \}/)
assert.match(approve, /transition\.count !== 1/)
assert.match(approve, /createdStoreId: store\.id/)
assert.match(approve, /status: 'ACTIVATED'/)
assert.match(approve, /salesLead\.updateMany/)
assert.ok(approve.indexOf('createdStoreId: store.id') < approve.indexOf('sendAndLogMessage({'))
assert.match(applications, /createdStore:/)
assert.match(applications, /salesLead:/)
assert.match(schema, /createdStoreId\s+String\?\s+@unique/)
assert.match(schema, /salesLeadId\s+String\?/)
assert.doesNotMatch(schema, /salesLeadId\s+String\?\s+@unique/)

console.log('sales lead conversion tests passed')
