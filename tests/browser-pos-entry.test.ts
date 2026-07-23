import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  browserPosReturnTo,
  browserPosSharedLinkUrl,
  resolveBrowserPosReturnTo,
} from '../lib/browser-pos-entry'

const origin = 'https://app.example.test'
const storeCode = 'STORE-A'
const returnTo = browserPosReturnTo(storeCode, 'km')

assert.equal(returnTo, '/desktop/pos?storeCode=STORE-A&lang=km&mode=pos',
  'binding return target must preserve store, language, and POS mode')

const shareUrl = browserPosSharedLinkUrl(
  'https://app.example.test/cashier/authorize?requestId=request-123',
  { storeCode, lang: 'km', origin },
)
const share = new URL(shareUrl)
assert.equal(share.pathname, '/cashier/authorize')
assert.equal(share.searchParams.get('requestId'), 'request-123')
assert.equal(share.searchParams.get('returnTo'), returnTo)
assert.doesNotMatch(shareUrl, /pos-device-v1|x-pos-device-token|auth-session/i,
  'Telegram entry URLs must never contain a long-lived credential or owner session')

assert.equal(resolveBrowserPosReturnTo(returnTo, { storeCode, origin }), returnTo,
  'a matching local Browser POS return target must be retained')
assert.equal(
  resolveBrowserPosReturnTo('/desktop/pos?storeCode=STORE-B&lang=zh&mode=pos', { storeCode, origin }),
  '/desktop/pos?storeCode=STORE-A&lang=en&mode=pos',
  'a cross-store return target must fail closed to the bound store',
)
assert.equal(
  resolveBrowserPosReturnTo('https://attacker.example/desktop/pos?storeCode=STORE-A', { storeCode, origin }),
  '/desktop/pos?storeCode=STORE-A&lang=en&mode=pos',
  'an absolute or off-origin return target must be rejected',
)

const home = readFileSync('app/home/page.tsx', 'utf8')
const desktop = readFileSync('app/desktop/page.tsx', 'utf8')
const desktopPos = readFileSync('app/desktop/pos/page.tsx', 'utf8')
const authorize = readFileSync('app/cashier/authorize/page.tsx', 'utf8')

assert.match(home, /apiFetch\('\/api\/cashier\/browser-devices'/,
  'Telegram OWNER cashier action must create the existing shared-link capability')
assert.match(home, /browserPosSharedLinkUrl\(/,
  'Telegram entry must add only the safe POS return target to the shared link')
assert.doesNotMatch(home, /const desktopPath = `\/desktop\?/, 
  'Telegram cashier action must not keep constructing the legacy storeCode-only URL')
assert.match(desktop, /getPosDeviceToken\(sc\)/,
  'legacy /desktop must check for a stored Browser POS credential before entering POS')
assert.match(desktop, /bindingTitle/, 
  'legacy /desktop without a credential must show binding guidance rather than POS content')
assert.match(desktopPos, /getPosDeviceToken\(storeCode\)/,
  'direct /desktop/pos must not bypass the Browser POS binding gate')
assert.match(authorize, /resolveBrowserPosReturnTo\(/,
  'shared-link bind success must use a constrained return target')
assert.match(authorize, /savePosDeviceToken\(body\.storeCode, body\.token\)/,
  'binding success must keep using the existing Browser POS token persistence')
assert.match(authorize, /getPosDeviceToken\(body\.storeCode\)/,
  'an already-bound browser must bypass a newly generated shared-link bind')

console.log('Browser POS Telegram entry and legacy-route tests passed')
