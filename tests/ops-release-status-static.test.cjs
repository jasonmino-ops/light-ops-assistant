const assert = require('node:assert/strict')
const fs = require('node:fs')

const source = fs.readFileSync('lib/ops-release-status.ts', 'utf8')
const page = fs.readFileSync('app/ops/release-status/page.tsx', 'utf8')
const opsHome = fs.readFileSync('app/ops/page.tsx', 'utf8')
const route = fs.readFileSync('app/api/ops/release-status/route.ts', 'utf8')

function arrayBlock(name) {
  const objectStart = source.indexOf('export const OPS_RELEASE_STATUS')
  const start = source.indexOf(`${name}: [`, objectStart)
  assert.notEqual(start, -1, `${name} must exist in the curated source`)
  const end = source.indexOf('\n  ],', start)
  assert.notEqual(end, -1, `${name} must have a complete array block`)
  return source.slice(start, end)
}

function recordBlock(collection, taskId) {
  const block = arrayBlock(collection)
  const start = block.indexOf(`taskId: '${taskId}'`)
  assert.notEqual(start, -1, `${taskId} must appear in ${collection}`)
  const end = block.indexOf('\n    },', start)
  assert.notEqual(end, -1, `${taskId} must have a complete record`)
  return block.slice(start, end)
}

assert.match(page, /data-release-status-page="readonly"/)
assert.match(page, /apiFetch\('\/api\/ops\/release-status'/, 'the page must read through the protected Ops endpoint')
assert.match(page, /import type \{ OpsReleaseStatusSnapshot, ReleaseStatusItem \}/, 'the client may import release-status types only')
assert.doesNotMatch(page, /import \{ OPS_RELEASE_STATUS/, 'the curated dataset must not enter the pre-auth client bundle')
assert.doesNotMatch(page, /ES-PRINT-|ES-DESKTOP-/, 'the client source must not embed curated task records')
assert.match(opsHome, /href="\/ops\/release-status"/, 'desktop Ops navigation must expose the page')
assert.match(opsHome, /style=\{s\.moreMenuItem\}>版本与待发布/, 'mobile Ops More menu must expose the page')

const pending = recordBlock('pendingItems', 'ES-PRINT-SOURCE-ROUTING-NORMALIZATION-01')
assert.match(pending, /status: '待发布'/)
assert.match(pending, /implementedOnMain: true/)
assert.match(pending, /releasedToProduction: false/)
assert.match(pending, /fieldVerified: false/)
assert.match(pending, /implementedSha: 'b41a19f58fa02ec626e26a55ccb641f6a01934a7'/)
assert.match(pending, /Desktop 营业原单使用 LOCAL FIRST/)
assert.match(pending, /H5 \/ Mobile 原单保持不变并延后处理/)

const awaiting = recordBlock('releasedAwaitingAcceptance', 'ES-PRINT-V3-OPERATOR-RECOVERY-01')
assert.match(awaiting, /status: '已发布待验收'/)
assert.match(awaiting, /implementedOnMain: true/)
assert.match(awaiting, /releasedToProduction: true/)
assert.match(awaiting, /visibleOnField: true/)
assert.match(awaiting, /fieldVerified: false/)
assert.match(awaiting, /Desktop 0\.2\.0-pilot\.4/)
assert.match(awaiting, /PARTIAL \/ 完整 FIELD 闭环待确认/)
assert.match(awaiting, /implementedSha: '37aa58c025c72e6d4547cf366d334ef3ea511e24'/)

const completed = recordBlock('recentlyCompleted', 'ES-DESKTOP-CASHIER-SIDEBAR-SIMPLIFICATION-01')
assert.match(completed, /status: '已完成'/)
assert.match(completed, /implementedOnMain: true/)
assert.match(completed, /releasedToProduction: true/)
assert.match(completed, /visibleOnField: true/)
assert.match(completed, /fieldVerified: false/)
assert.match(completed, /PASS \/ 独立 FIELD 不要求/)
assert.match(completed, /implementedSha: '8fdf9b310a9b23e1e3c9e02cf88ec2790a9f879c'/)

assert.doesNotMatch(page, /当前线上版本|当前开发主线|Production SHA|Main SHA/, 'the summary must not present recorded SHAs as live facts')
assert.doesNotMatch(source, /^\s{2}(?:production|main): \{/m, 'the curated snapshot must not carry self-staling live SHA fields')

assert.match(route, /checkOpsAuth\(req\)/, 'the data endpoint must reuse Ops authentication')
assert.match(route, /hasOpsRole\(opsRole, 'OPS_ADMIN'\)/, 'the data endpoint must reject BD and non-Ops users')
assert.match(route, /status: 403/)
assert.match(route, /OPS_RELEASE_STATUS/, 'only the authenticated server route may read the curated dataset')
assert.match(route, /private, no-store/, 'the internal status response must not be publicly cached')

assert.doesNotMatch(page, /method:\s*['"](?:POST|PUT|PATCH|DELETE)/i, 'the page must not add write requests')
assert.doesNotMatch(page, /deploy|promote|cherry-pick|rollback|release engine/i, 'the page must not become a release action surface')
assert.doesNotMatch(source, /FIELD Verified:\s*YES|fieldVerified:\s*true/, 'the curated record must not claim FIELD verification')
assert.doesNotMatch(source, /FINAL FROZEN/, 'the curated record must not claim a final freeze')

console.log('ops-release-status-static.test.cjs: PASS')
