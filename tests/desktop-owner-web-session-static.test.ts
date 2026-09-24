/**
 * ES-DESKTOP-OWNER-WEB-SESSION-01 — static boundaries.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (file: string) => fs.readFileSync(file, 'utf8')
const lib = read('lib/desktop-owner-web-session.ts')
const route = read('app/api/pos-session/owner-web-session/route.ts')
const client = read('app/desktop/pos/DesktopOwnerWebSession.tsx')
const desktopPos = read('app/desktop/pos/page.tsx')
const posAuth = read('lib/desktop-pos-auth.ts')
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// Authority reuse: the OWNER lookup is the existing device authority, not a copy.
assert.match(posAuth, /export async function authorizeDesktopPosDevice\(/)
assert.match(posAuth, /verifyPosDeviceRequest\(req, expected, \{ ignoreOperatorBoundary: true \}\)[\s\S]*authorizationForDevice\(expected, payload\)/)
assert.match(code(lib), /authorizeDesktopPosDevice\(req, scope\)/)
assert.doesNotMatch(code(lib), /userStoreRole/, 'OWNER lookup must reuse authorizationForDevice instead of copying it')

// Never authorize by storeCode fallback, account cookie, operator boundary or renderer flags.
assert.doesNotMatch(code(lib), /allowStoreCodeFallback|authorizeDesktopPosRequest|authorizeDesktopPosAccount|getContext|cookies\.get/)
assert.doesNotMatch(code(lib), /where:\s*\{\s*code/, 'store must be resolved from the signed token, not by storeCode')
assert.doesNotMatch(code(lib), /\bisDesktop\b|eshopDesktopRuntime|x-lightops-client|x-pos-operator-source/)
assert.match(code(lib), /signed\.issuedBy !== DESKTOP_SESSION_ISSUER/)
assert.match(code(lib), /!signed\.browserPosSessionId/)
assert.match(lib, /\^desktop-/)

// Standard auth-session only; no second auth system, no generic session change.
assert.match(code(lib), /signSession\(\{/)
assert.match(lib, /OWNER_WEB_SESSION_COOKIE = 'auth-session'/)
assert.match(lib, /OWNER_WEB_SESSION_MAX_AGE_SECONDS = 12 \* 60 \* 60/)
assert.match(code(lib), /httpOnly: true/)
assert.match(code(route), /res\.cookies\.set\(OWNER_WEB_SESSION_COOKIE, result\.sessionToken, ownerWebSessionCookieOptions\(\)\)/)

// No token/cookie leakage or logging.
for (const [name, source] of [['lib', lib], ['route', route], ['client', client]] as const) {
  assert.doesNotMatch(code(source), /console\./, `${name} must not log`)
}
assert.doesNotMatch(code(route), /sessionToken[^)]*noStoreJson|noStoreJson\(\{[^}]*token/, 'response must not echo tokens')

// Placement: the Desktop activation API namespace stays free of legacy POS auth.
assert.ok(!fs.existsSync('app/api/desktop/owner-web-session'), 'exchange must not live under app/api/desktop')

// Client: trigger only, silent failure, no blocking UI, mounted only in Desktop POS mode.
assert.match(code(client), /runtime\?\.isDesktop !== true \|\| runtime\.windowRole !== 'employee'/)
assert.match(code(client), /return null\s*\}\s*$/)
assert.doesNotMatch(code(client), /alert\(|throw /)
assert.match(desktopPos, /<UsbCustomerDisplayBridge \/>\s*<DesktopOwnerWebSession \/>/)

console.log('desktop-owner-web-session-static.test.ts: PASS')
