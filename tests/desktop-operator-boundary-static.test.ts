import assert from 'node:assert/strict'
import fs from 'node:fs'

const auth = fs.readFileSync('lib/desktop-pos-auth.ts', 'utf8')
const client = fs.readFileSync('lib/desktop-pos-client.ts', 'utf8')
const desktopPage = fs.readFileSync('app/desktop/pos/page.tsx', 'utf8')
const boundaryRoute = fs.readFileSync('app/api/operator-boundary/route.ts', 'utf8')

assert.match(auth, /DESKTOP_OPERATOR_BOUNDARY_ENABLED !== '0'/)
assert.match(auth, /operatorSource === 'ACCOUNT'\) return accountAuth/)
assert.match(auth, /operatorSource === 'DEVICE'\) return null/)
assert.match(auth, /options\?\.ignoreOperatorBoundary/)
assert.match(client, /'x-pos-operator-source': operatorSelection \?\? 'DEVICE'/)
assert.match(client, /sessionStorage\.getItem\(`\$\{DESKTOP_OPERATOR_SELECTION_PREFIX\}/)
assert.match(desktopPage, /OperatorBoundary/)
assert.match(desktopPage, /选择本次操作人/)
assert.match(desktopPage, /离线 CASH 继续沿用现有能力/)
assert.match(boundaryRoute, /authorizeDesktopPosAccount\(req, expected, \{ ignoreOperatorBoundary: true \}\)/)
assert.match(boundaryRoute, /verifyPosDeviceRequest\(req, expected, \{ ignoreOperatorBoundary: true \}\)/)
assert.match(boundaryRoute, /isDesktopOperatorBoundaryEnabled\(\)/)

console.log('PASS Desktop operator boundary static contract')
