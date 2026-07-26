import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const cashier = read('app/cashier/page.tsx')
const client = read('lib/desktop-pos-client.ts')
const auth = read('lib/desktop-pos-auth.ts')
const startRoute = read('app/api/cashier/device-authorization/start/route.ts')
const statusRoute = read('app/api/cashier/device-authorization/status/route.ts')
const confirmRoute = read('app/api/cashier/device-authorization/[requestId]/route.ts')

function sectionAfter(source: string, marker: string, nextMarker?: string) {
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `missing marker: ${marker}`)
  const end = nextMarker ? source.indexOf(nextMarker, start + marker.length) : source.length
  assert.notEqual(end, -1, `missing next marker: ${nextMarker}`)
  return source.slice(start, end)
}

// The visible entry is token-based: it is present only when the existing token is absent.
assert.match(cashier, /!posDeviceToken && \(/, 'an unbound POS must render the binding entry')
assert.match(cashier, /本 POS 电脑尚未绑定/, 'the unbound state must be clearly named')
assert.match(cashier, /绑定后才能完成销售和打印，请由门店老板确认本机授权。/, 'the entry must explain OWNER confirmation')
assert.match(cashier, /aria-label="绑定本机 POS"/, 'the binding action must be discoverable and accessible')
assert.doesNotMatch(
  sectionAfter(cashier, '<div style={{ ...s.posAuthCard, ...s.posAuthCardWarn, marginTop: 0 }}>', '<div style={s.autoPrintToggle}>'),
  /qzStatus|qzPrintEnabled|handleRefreshQzStatus/,
  'QZ connectivity must not control the Browser POS binding card',
)

// The entry delegates to the existing authorization start function; it does not create a new protocol.
const entryHandler = sectionAfter(cashier, 'function handleAuthorizePosDevice()', 'async function startPosAuthorization()')
assert.match(entryHandler, /setPosBindingEntryRequested\(true\)/, 'clicking the entry must enter the existing authorization screen')
assert.match(entryHandler, /void startPosAuthorization\(\)/, 'clicking the entry must reuse the existing start function')

const startHandler = sectionAfter(cashier, 'async function startPosAuthorization()', 'const checkPosAuthorization')
assert.match(startHandler, /const deviceId = getPosDeviceId\(\)/, 'start must use the existing browser deviceId')
assert.match(startHandler, /fetch\('\/api\/cashier\/device-authorization\/start'/, 'start must call the existing authorization endpoint')
assert.match(startHandler, /JSON\.stringify\(\{ storeCode, deviceId, deviceName: '前台收银机' \}\)/, 'start must use the current storeCode and deviceId')

// Existing status polling remains the only path that receives and persists a token.
const statusHandler = sectionAfter(cashier, 'const checkPosAuthorization', 'function requireOnlinePosAuthorization')
assert.match(statusHandler, /\/api\/cashier\/device-authorization\/status/, 'the entry must poll the existing status endpoint')
assert.match(statusHandler, /savePosDeviceToken\(storeCode, body\.token\)/, 'an approved token must use the existing origin-local storage helper')
assert.match(statusHandler, /setPosBindingEntryRequested\(false\)/, 'approval must leave the binding screen')
assert.match(statusHandler, /body\.status === 'EXPIRED'/, 'expiry must remain visible to the operator')
assert.match(cashier, /onClick=\{\(\) => void startPosAuthorization\(\)\}[\s\S]{0,300}刷新二维码/, 'expired or failed requests must be regenerable')

// A protected request rejection clears the stale token and exposes the same entry again.
const unauthorizedHandler = sectionAfter(cashier, 'function handlePosUnauthorized', 'function handleAuthorizePosDevice')
assert.match(unauthorizedHandler, /clearPosDeviceToken\(storeCode\)/, 'POS_DEVICE_UNAUTHORIZED must clear only the existing store token')
assert.match(unauthorizedHandler, /setPosDeviceToken\(''\)/, 'POS_DEVICE_UNAUTHORIZED must clear in-memory token state')
assert.match(unauthorizedHandler, /setPosAccountAccess\('device_unbound'\)/, 'POS_DEVICE_UNAUTHORIZED must return to the binding entry')

// Security-sensitive protocol code remains owner-confirmed and device-bound.
assert.match(client, /cashier:deviceId/, 'the existing local device identity must remain the source of deviceId')
assert.match(client, /cashier:posDeviceToken:/, 'the existing per-store token key must remain in use')
assert.match(startRoute, /targetId: deviceId/, 'authorization requests must stay tied to the requesting deviceId')
assert.match(statusRoute, /targetId: deviceId/, 'status polling must only reveal a token to the requesting deviceId')
assert.match(confirmRoute, /ctx\.role !== 'OWNER'/, 'only an OWNER may confirm device authorization')
assert.match(auth, /payload\.deviceId !== deviceId/, 'server authorization must still require the signed deviceId to match')
assert.match(auth, /return NextResponse\.json\(POS_AUTH_ERROR, \{ status: 403 \}\)/, 'unbound device requests must continue to fail closed')

console.log('pos binding entry static tests passed')
