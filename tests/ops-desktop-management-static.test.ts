import assert from 'node:assert/strict'
import fs from 'node:fs'

function read(file: string) {
  return fs.readFileSync(file, 'utf8')
}

const managementRoute = read('app/api/ops/desktop-management/route.ts')
const revokeRoute = read('app/api/ops/desktop-management/devices/[id]/revoke/route.ts')
const activationRoute = read('app/api/ops/desktop-activation/route.ts')
const opsHome = read('app/ops/page.tsx')
const desktopIndex = read('app/ops/desktop/page.tsx')
const shell = read('app/ops/desktop/_components/DesktopShell.tsx')
const activationPage = read('app/ops/desktop/activation/page.tsx')
const devicesPage = read('app/ops/desktop/devices/page.tsx')
const auditPage = read('app/ops/desktop/audit/page.tsx')
const runtimePage = read('app/ops/desktop/runtime/page.tsx')
const legacyPage = read('app/ops/desktop-activation/page.tsx')
const opsAuth = read('lib/ops-auth.ts')
const writeOriginGuard = read('lib/ops-write-origin.ts')

assert.match(managementRoute, /checkOpsAuthContext/, 'management read model must use server-side ops auth')
assert.match(managementRoute, /hasOpsRole\(ops\.role, 'OPS_ADMIN'\)/, 'management read model must require OPS_ADMIN or higher')
assert.doesNotMatch(managementRoute, /getContext\(/, 'merchant auth must not grant desktop management access')
assert.match(managementRoute, /noStoreJson/, 'management responses must be no-store')
assert.doesNotMatch(managementRoute, /tokenHash|pinHash|installationIdHash|connectionString|metadata\s*:/, 'management read model must not expose protected material')
assert.match(managementRoute, /view === 'stores'/)
assert.match(managementRoute, /view === 'activation'/)
assert.match(managementRoute, /view === 'devices'/)
assert.match(managementRoute, /view === 'audit'/)
assert.match(managementRoute, /view === 'runtime'/)
assert.match(managementRoute, /pageSize/, 'management views must support pagination')
assert.match(managementRoute, /contains: query/, 'management views must support store, tenant and code search')

assert.match(revokeRoute, /checkOpsAuthContext/)
assert.match(revokeRoute, /export async function POST[\s\S]*enforceOpsWriteOrigin\(req\)[\s\S]*checkOpsAuthContext\(req\)/, 'revoke origin guard must run before auth')
assert.match(revokeRoute, /hasOpsRole\(ops\.role, 'OPS_ADMIN'\)/)
assert.doesNotMatch(revokeRoute, /getContext\(/, 'ops revocation adapter must not impersonate a merchant owner')
assert.match(revokeRoute, /getFkBackedOpsAdminIdentity/, 'ops revocation must require a FK-backed OpsAdmin actor')
assert.match(revokeRoute, /actorOpsAdminId: actor\.id/, 'ops revocation audit must carry verified operator attribution')
assert.match(revokeRoute, /DEVICE_REFERENCE_AMBIGUOUS/, 'short device references must fail closed on ambiguity')
assert.match(revokeRoute, /eventType: 'DEVICE_REVOKED'/)
assert.match(revokeRoute, /reason\.length < 3/, 'ops revocation must require a reason')
assert.doesNotMatch(revokeRoute, /deviceToken|tokenHash|pinHash|installationIdHash/, 'ops revocation must not handle protected material')

assert.match(activationRoute, /issueDesktopActivationPin/, 'productized UI must continue using the existing issuance service')
assert.match(activationRoute, /export async function POST[\s\S]*enforceOpsWriteOrigin\(req\)[\s\S]*requireOpsAdmin\(req\)/, 'PIN origin guard must run before auth')
assert.match(activationRoute, /getFkBackedOpsAdminIdentity/, 'ops PIN issuance must reject synthetic identities before FK persistence')
assert.match(activationRoute, /OPS_ADMIN_IDENTITY_REQUIRED/, 'ops PIN issuance must return a stable identity error')
assert.match(opsAuth, /session\.opsSessionVersion == null/, 'FK-backed writes must require a versioned OpsAdmin session')
assert.match(opsAuth, /admin\.sessionVersion !== session\.opsSessionVersion/, 'FK-backed writes must reject stale sessions')
assert.match(writeOriginGuard, /OPS_WRITE_ORIGIN_FORBIDDEN/)
assert.doesNotMatch(writeOriginGuard, /allowlist|cors|telegram/i, 'origin guard must not use broad host, CORS, or Telegram exceptions')
assert.match(opsHome, /href="\/ops\/desktop\/activation"[^>]*>Desktop</)
assert.ok(
  opsHome.indexOf('<Link href="/ops/desktop/activation" style={s.moreMenuItem}>Desktop</Link>') <
    opsHome.indexOf('<Link href="/ops/admins" style={s.moreMenuItem}>管理员</Link>'),
  'Desktop must be the first item in the Mini App More menu',
)
assert.match(shell, /\/ops\/desktop\/activation/)
assert.match(shell, /\/ops\/desktop\/devices/)
assert.match(shell, /\/ops\/desktop\/audit/)
assert.match(shell, /\/ops\/desktop\/runtime/)
assert.ok(
  shell.indexOf("href: '/ops/desktop/activation'") < shell.indexOf("href: '/ops/desktop/devices'") &&
    shell.indexOf("href: '/ops/desktop/devices'") < shell.indexOf("href: '/ops/desktop/runtime'") &&
    shell.indexOf("href: '/ops/desktop/runtime'") < shell.indexOf("href: '/ops/desktop/audit'"),
  'Desktop tabs must remain Activation, Devices, Runtime, Audit',
)
assert.match(desktopIndex, /redirect\('\/ops\/desktop\/activation'\)/, 'Desktop root must open Activation directly')
assert.match(legacyPage, /redirect\('\/ops\/desktop\/activation'\)/, 'legacy hidden route must redirect to the normal menu route')

assert.match(activationPage, /Store Code、Store Name 或 Tenant/)
assert.match(activationPage, /\/api\/ops\/desktop-activation/)
assert.match(activationPage, /navigator\.clipboard\.writeText\(issued\.pin\)/)
assert.match(activationPage, /关闭并清除/)
assert.match(activationPage, /setIssued\(null\)/)
assert.match(activationPage, /Desktop Activation Guide/)
assert.match(activationPage, /Go To Subscription/)
assert.match(activationPage, /Subscription expired/)
assert.match(activationPage, /Subscription cancelled/)
assert.match(activationPage, /Store disabled/)
assert.match(activationPage, /Tenant disabled/)
assert.match(activationPage, /Not eligible/)
assert.doesNotMatch(activationPage, /localStorage|sessionStorage|console\./)
assert.doesNotMatch(activationPage, /router\.push|window\.location/)

assert.match(devicesPage, /Device status/)
assert.match(devicesPage, /Desktop Version/)
assert.match(devicesPage, /Windows Version/)
assert.match(devicesPage, /Revoke Desktop Device/)
assert.match(devicesPage, /Reason/)
assert.match(devicesPage, /DEVICE_NOT_FOUND/)
assert.match(devicesPage, /DEVICE_REFERENCE_AMBIGUOUS/)
assert.match(devicesPage, /OPS_ADMIN_IDENTITY_REQUIRED/)
assert.match(devicesPage, /REVOCATION_REASON_REQUIRED/)
assert.doesNotMatch(devicesPage, /Last Heartbeat/, 'lastSeenAt must not be presented as separate heartbeat telemetry')
assert.doesNotMatch(devicesPage, /token|hash|secret/i)

assert.match(auditPage, /Desktop Audit/)
assert.match(auditPage, /All Events/)
assert.match(auditPage, /Derived from latest verification/)
assert.doesNotMatch(auditPage, /metadata|token|hash|secret/i)
assert.match(runtimePage, /Current Desktop Version/)
assert.match(runtimePage, /Last Verification/)

console.log('ops desktop management static tests passed')
