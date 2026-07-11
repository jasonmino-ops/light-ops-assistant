import assert from 'node:assert/strict'
import fs from 'node:fs'

function read(path: string) {
  return fs.readFileSync(path, 'utf8')
}

const invite = read('app/invite/page.tsx')
const landingPage = read('app/m/[storeCode]/page.tsx')
const landingShell = read('app/m/[storeCode]/PrivateLandingShell.tsx')
const menu = read('app/menu/page.tsx')
const eventApi = read('app/api/public/landing-events/route.ts')
const ordersApi = read('app/api/public/orders/route.ts')
const schema = read('prisma/schema.prisma')

assert.match(invite, /publicUrl\(`\/m\/\$\{current\.code\}`\)/, 'invite customer link should still target /m/[storeCode]')

assert.match(landingPage, /store\.status === 'ACTIVE'/, '/m should only pass ACTIVE stores to the shell')
assert.match(landingShell, /eventType: 'landing_view'/, '/m should record landing_view')
assert.match(landingShell, /recordEvent\('landing_cta_click'/, '/m should record landing_cta_click')
assert.match(landingShell, /menuParams\.set\('from', 'landing'\)/, '/m -> /menu should include from=landing')
assert.match(landingShell, /menuParams\.set\('code', storeCode\)/, '/m -> /menu should preserve storeCode')
assert.match(landingShell, /keepalive: true/, 'landing event reporting should be non-blocking')

assert.match(eventApi, /isLandingEventType\(body\.eventType\)/, 'event API should whitelist event types')
assert.match(eventApi, /INVALID_EVENT_TYPE/, 'event API should reject illegal eventType')
assert.match(eventApi, /where: \{ code: storeCode \}/, 'event API should resolve store by storeCode')
assert.doesNotMatch(eventApi, /body\.storeId/, 'event API should not trust client storeId')
assert.match(eventApi, /store\.status !== 'ACTIVE'/, 'event API should reject inactive stores')

assert.match(menu, /const fromLanding = urlParams\.get\('from'\) === 'landing'/, '/menu should detect landing source')
assert.match(menu, /eventType: 'menu_arrival'/, '/menu should record menu_arrival')
assert.match(menu, /setTableNo\(urlTable\.slice\(0, 20\)\)/, 'table parameter logic should remain present')
assert.match(menu, /orderSource: 'landing'/, '/menu should pass landing source to order API')

assert.match(ordersApi, /orderSource === 'landing'/, 'orders API should detect landing orders')
assert.match(ordersApi, /sourcePlatform: 'landing'/, 'landing orders should save sourcePlatform=landing')
assert.match(ordersApi, /eventType: 'order_conversion'/, 'orders API should record order_conversion after success')
assert.match(ordersApi, /storeId: store\.id/, 'order conversion should use server-resolved storeId')

assert.match(schema, /model CustomerJourneyEvent/, 'journey event model should exist')
assert.match(schema, /@@unique\(\[eventKey\]\)/, 'journey events should support idempotent eventKey')
assert.match(schema, /@@index\(\[storeId, eventType, createdAt\]\)/, 'journey events should support store/date/event queries')

console.log('customer landing journey static tests passed')
