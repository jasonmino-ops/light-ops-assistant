import assert from 'node:assert/strict'
import fs from 'node:fs'
import zh from '../lib/i18n/zh'
import en from '../lib/i18n/en'
import km from '../lib/i18n/km'

const leads = fs.readFileSync('app/api/sales/leads/route.ts', 'utf8')
const statusRoute = fs.readFileSync('app/api/sales/leads/[id]/route.ts', 'utf8')
const page = fs.readFileSync('app/ops/sales/page.tsx', 'utf8')
const approval = fs.readFileSync('app/api/ops/applications/[id]/approve/route.ts', 'utf8')

// A conversion requires the complete Lead -> APPROVED Application -> created Store chain.
assert.match(leads, /status: 'ACTIVATED',[\s\S]+status: 'APPROVED',[\s\S]+createdStoreId: \{ not: null \},[\s\S]+createdStore: \{ isNot: null \}/)
assert.match(leads, /converted: Boolean\(conversion\?\.createdStore\)/)
assert.doesNotMatch(leads, /converted: Boolean\(lead\.applications\[0\]\?\.createdStoreId\)/)

// Performance attribution stays with the permanent first-touch owner; follow-up stays current-owner scoped.
assert.match(leads, /currentOwnerWhere:[\s\S]+salesOwnerId: actor\.userId/)
assert.match(leads, /performanceWhere:[\s\S]+initialSalesOwnerId: actor\.userId/)
assert.match(leads, /activated: activatedCount/)

// PENDING, REJECTED, or APPROVED-without-store cannot satisfy conversion evidence.
assert.match(leads, /applications: \{ some: \{ status: 'PENDING' \} \}/)
assert.match(leads, /status: 'APPROVED',[\s\S]+createdStoreId: \{ not: null \}/)
assert.doesNotMatch(leads, /status: \{ in: \['APPROVED', 'PENDING', 'REJECTED'\] \}/)

// Opened time comes from the approval transaction, with a linked Store timestamp fallback only.
assert.match(approval, /approvedAt: now,[\s\S]+createdStoreId: store\.id/)
assert.match(leads, /conversion\.approvedAt \?\? conversion\.createdStore!\.createdAt/)

// Activated view remains server-scoped and search is applied inside that scope.
assert.match(leads, /view === 'activated' \? performanceWhere : \{\}/)
assert.match(page, /params\.set\('view', 'activated'\)/)
assert.match(page, /queue === 'activated'/)
assert.match(page, /lead\.converted/)

// Activated Leads leave active follow-up queues and the conversion state cannot be manually reverted.
assert.match(page, /!lead\.converted && \['NEW', 'WAITING_TELEGRAM'\]/)
assert.match(page, /!lead\.converted && lead\.status === 'FOLLOWING'/)
assert.match(page, /!lead\.converted && lead\.applicationStatus === 'PENDING'/)
assert.match(page, /lead\.status === 'ACTIVATED'[\s\S]+salesWorkspace\.statusLocked/)
assert.match(statusRoute, /status: \{ notIn: \['APPLIED', 'ACTIVATED'\] \}/)

// UI shows auditable owner/time/store evidence without exposing internal conversion IDs.
assert.match(page, /salesWorkspace\.activatedMerchants/)
assert.match(page, /salesWorkspace\.initialOwner/)
assert.match(page, /salesWorkspace\.currentFollowOwner/)
assert.match(page, /salesWorkspace\.openedTime/)
assert.match(page, /salesWorkspace\.storeStatus/)
const leadViewModel = page.slice(page.indexOf('type Lead ='), page.indexOf('type UnassignedLead'))
assert.doesNotMatch(leadViewModel, /createdStoreId|salesLeadId/)

// Existing support conversation remains on the same workspace and message API.
assert.match(page, /kind: 'inquiry'/)
assert.match(page, /\/api\/sales\/messages/)

const keys = (value: Record<string, string>) => Object.keys(value).sort()
assert.deepEqual(keys(en.salesWorkspace), keys(zh.salesWorkspace))
assert.deepEqual(keys(km.salesWorkspace), keys(zh.salesWorkspace))

console.log('sales workspace conversion closure tests passed')
