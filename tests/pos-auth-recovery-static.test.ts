import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync('app/cashier/page.tsx', 'utf8')

function section(from: string, to: string) {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0, `missing section start: ${from}`)
  assert.ok(end > start, `missing section end: ${to}`)
  return source.slice(start, end)
}

const unauthorizedHandler = section('function handlePosUnauthorized', 'async function handleAuthorizePosDevice')
assert.match(unauthorizedHandler, /setPosDeviceRecoveryOpen\(true\)/, '403 POS device failures must open the recovery panel')
assert.match(unauthorizedHandler, /isReusablePosAuthChallenge\([\s\S]*posAuthChallenge[\s\S]*storeCode[\s\S]*getPosDeviceId\(\)[\s\S]*posAuthExpired[\s\S]*posAuthError/, 'challenge reuse must validate current store, device, expiry state, and terminal errors')
assert.match(unauthorizedHandler, /if \(!canReuseChallenge\) \{\s*setPosAuthChallenge\(null\)/, 'an eligible challenge must not be unconditionally cleared')

const accountRevalidation = section('function handleRevalidatePosAccount', 'async function handleAuthorizePosDevice')
assert.match(accountRevalidation, /localStorage\.setItem\(posAccountRecoverySnapshotKey\(storeCode\), JSON\.stringify\(snapshot\)\)/, 'account revalidation must preserve the current cashier snapshot locally')
assert.match(accountRevalidation, /window\.location\.assign\(`\/relogin\?returnUrl=\$\{encodeURIComponent\(returnUrl\)\}`\)/, 'account revalidation must use the existing relogin route with a return URL')
for (const forbiddenAutoWrite of [
  '/api/cashier/sales',
  '/api/cashier/member-balance-pay',
  '/api/cashier/offline-sync',
  '/api/cashier/orders/',
]) {
  assert.doesNotMatch(accountRevalidation, new RegExp(forbiddenAutoWrite.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `account revalidation must not automatically call ${forbiddenAutoWrite}`)
}

const accountSnapshotRestore = section('useEffect(() => {\n    if (!storeCode) return\n    try {\n      const raw = localStorage.getItem(posAccountRecoverySnapshotKey(storeCode))', '// ── Browser online/offline signal')
assert.match(accountSnapshotRestore, /setCart\(snapshot\.cart\)/, 'returning from account revalidation must restore the cart')
assert.match(accountSnapshotRestore, /setPayment\(snapshot\.payment\)/, 'returning from account revalidation must restore the payment choice')
assert.match(accountSnapshotRestore, /setCheckoutStep\(snapshot\.checkoutStep\)/, 'returning from account revalidation must restore the checkout step')
assert.match(accountSnapshotRestore, /accountRevalidatedRetry/, 'returning from account revalidation must require a manual retry')
assert.match(source, /revalidateAccount: '重新验证账号'/, 'recovery UI must offer account revalidation in Chinese')

const reusableChallenge = section('function isReusablePosAuthChallenge', 'type ScannerDebugState')
assert.match(reusableChallenge, /challenge\.storeCode === storeCode/, 'challenge reuse must be scoped to the store')
assert.match(reusableChallenge, /challenge\.deviceId === deviceId/, 'challenge reuse must be scoped to the browser device')
assert.match(reusableChallenge, /challenge\.expiresAt/, 'challenge reuse must validate expiry')
assert.match(reusableChallenge, /hasTerminalError/, 'challenge reuse must reject an error terminal state')
assert.match(source, /setPosAuthChallenge\(\{ \.\.\.body, storeCode, deviceId \}\)/, 'new challenges must retain their originating store and device')

const recoveryPolling = section('useEffect(() => {\n    const canPollRecovery', 'function buildReceiptSnapshot')
assert.match(recoveryPolling, /posDeviceRecoveryOpen/, 'authorization polling must be gated by the open recovery panel')
assert.doesNotMatch(recoveryPolling, /posAccountAccess !== 'authorized'/, 'recovery polling must not depend on account access')
assert.match(recoveryPolling, /window\.clearInterval\(timer\)/, 'recovery polling must clean up its interval')

assert.doesNotMatch(source, /if \(!posDeviceToken[^\n]*\)\s*\{?\s*setPosDeviceRecoveryOpen\(true\)/, 'a missing token alone must not open recovery')

const authorizationSuccess = section("if (body.status === 'APPROVED' && body.token)", "if (body.status === 'EXPIRED')")
assert.match(authorizationSuccess, /savePosDeviceToken\(storeCode, body\.token\)/, 'approved authorization must save the device token')
for (const forbiddenAutoWrite of [
  '/api/cashier/sales',
  '/api/cashier/member-balance-pay',
  '/api/cashier/offline-sync',
  '/api/cashier/orders/',
]) {
  assert.doesNotMatch(authorizationSuccess, new RegExp(forbiddenAutoWrite.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `authorization success must not automatically call ${forbiddenAutoWrite}`)
}

for (const forbiddenExpansion of ['deviceList', 'deviceCenter', 'revoke', 'credentialBridge', 'edt_v1']) {
  assert.doesNotMatch(source, new RegExp(forbiddenExpansion, 'i'), `must not introduce ${forbiddenExpansion}`)
}

const packageJson = fs.readFileSync('package.json', 'utf8')
for (const forbiddenTestDependency of ['jest', '@testing-library/react', 'jsdom']) {
  assert.doesNotMatch(packageJson, new RegExp(forbiddenTestDependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `must not introduce ${forbiddenTestDependency}`)
}

console.log('POS authorization recovery static tests passed')
