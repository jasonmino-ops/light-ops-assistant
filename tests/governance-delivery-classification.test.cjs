const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { validatePilot, validatePilotSourcePaths, validateRegister } = require('../scripts/governance/delivery-classification.cjs')

const root = path.resolve(__dirname, '..')
const policyPath = path.join(root, 'docs/governance/ES-ENGINEERING-RISK-BASED-DELIVERY-01-WEB-SHELL-DELIVERY-CLARIFICATION.md')
const registerPath = path.join(root, 'docs/governance/ES-ENGINEERING-RISK-BASED-DELIVERY-01-register.json')

const policy = fs.readFileSync(policyPath, 'utf8')
const register = JSON.parse(fs.readFileSync(registerPath, 'utf8'))

assert.match(policy, /`WEB`/)
assert.match(policy, /`DESKTOP_SHELL`/)
assert.match(policy, /`MIXED`/)
assert.match(policy, /does not by itself require Desktop repackaging/)
assert.match(policy, /Production still requires trusted lineage/)

assert.deepEqual(register.deliveryClassification.classes, ['WEB', 'DESKTOP_SHELL', 'MIXED'])
assert.equal(register.deliveryClassification.remoteWebDesktopRule.includes('do not require Desktop repackaging'), true)
assert.deepEqual(register.deliveryClassification.milestoneIdentity, [
  'desktopShellCandidateSha',
  'desktopShellVersion',
  'desktopInstallerSha256',
  'productionWebDeploymentId',
  'productionWebSourceSha',
])

const p2 = register.sourceAcceptancePilots.find((entry) => entry.taskId === 'ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION')
assert.ok(p2)
assert.equal(p2.deliveryClass, 'WEB')
assert.equal(p2.runtimeDelivery, 'REMOTE_WEB_VIA_BROWSERWINDOW_LOADURL')
assert.equal(p2.status, 'SOURCE_ACCEPTED')
assert.equal(p2.fieldStatus, 'MILESTONE_FIELD_PENDING')
assert.doesNotThrow(() => validateRegister(register))
assert.throws(() => validateRegister({ ...register, deliveryClassification: undefined }), /deliveryClassification is required/)
assert.throws(() => validateRegister({
  ...register,
  deliveryClassification: { ...register.deliveryClassification, classes: ['WEB'] },
}), /classes are invalid/)
assert.throws(() => validateRegister({ ...register, status: 'DRAFT' }), /register status is not active/)
assert.throws(() => validateRegister({ ...register, fieldDebt: [{ ...register.fieldDebt[0], riskClass: 'L4' }] }), /fieldDebt\[0\]\.riskClass is invalid/)
assert.throws(() => validateRegister({ ...register, fieldDebt: [{ ...register.fieldDebt[0], status: 'PASS' }] }), /fieldDebt\[0\]\.status must be DEFERRED/)

assert.throws(() => validatePilot({ ...p2, deliveryClass: 'UNKNOWN' }), /delivery classification invalid/)
assert.throws(() => validatePilot({ ...p2, status: 'DRAFT' }), /status must be SOURCE_ACCEPTED/)
assert.throws(() => validatePilot({ ...p2, milestoneTarget: '' }), /milestoneTarget is required/)
assert.throws(() => validatePilot({ ...p2, runtimeDelivery: 'DESKTOP_SHELL_LOCAL_RUNTIME' }), /boundary\/runtime mismatch|runtime must be remote Web/)
assert.throws(() => validatePilot({ ...p2, boundaryPaths: ['desktop/src/main/main.ts'] }), /WEB boundary must be Web-only/)
assert.throws(() => validatePilot({
  ...p2,
  boundaryPaths: ['app/cashier/page.tsx', 'prisma/schema.prisma'],
}), /unrecognized boundary path/)
assert.doesNotThrow(() => validatePilot({
  ...p2,
  taskId: 'ES-TEST-DESKTOP-SHELL',
  deliveryClass: 'DESKTOP_SHELL',
  runtimeDelivery: 'DESKTOP_SHELL_LOCAL_RUNTIME',
  boundaryPaths: ['desktop/src/main/main.ts'],
}))
assert.throws(() => validatePilot({
  ...p2,
  taskId: 'ES-TEST-DESKTOP-SHELL-MIXED-RUNTIME',
  deliveryClass: 'DESKTOP_SHELL',
  runtimeDelivery: 'MIXED_REMOTE_WEB_AND_DESKTOP_SHELL',
  boundaryPaths: ['desktop/src/main/main.ts'],
}), /DESKTOP_SHELL boundary\/runtime mismatch/)
assert.doesNotThrow(() => validatePilot({
  ...p2,
  taskId: 'ES-TEST-MIXED',
  deliveryClass: 'MIXED',
  runtimeDelivery: 'MIXED_REMOTE_WEB_AND_DESKTOP_SHELL',
  boundaryPaths: ['app/cashier/page.tsx', 'desktop/src/main/main.ts'],
}))
assert.throws(() => validatePilot({
  ...p2,
  taskId: 'ES-TEST-MIXED-BROKEN',
  deliveryClass: 'MIXED',
  runtimeDelivery: 'MIXED_REMOTE_WEB_AND_DESKTOP_SHELL',
  boundaryPaths: ['app/cashier/page.tsx'],
}), /MIXED boundary\/runtime mismatch/)

assert.doesNotThrow(() => validatePilotSourcePaths([
  'app/cashier/page.tsx',
  'tests/browser-pos-customer-display-entry.test.ts',
  'docs/desktop/es-desktop-ux-01-p2-candidate-evidence.md',
], p2))
assert.throws(() => validatePilotSourcePaths([
  'app/cashier/page.tsx',
  'desktop/src/main/main.ts',
], p2), /source diff\/class mismatch/)
assert.throws(() => validatePilotSourcePaths(['package.json'], p2), /unclassified source paths/)

console.log('governance delivery classification tests passed')
