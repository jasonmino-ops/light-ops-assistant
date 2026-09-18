const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { validatePilot, validateRegister } = require('../scripts/governance/delivery-classification.cjs')

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

assert.throws(() => validatePilot({ ...p2, deliveryClass: 'UNKNOWN' }), /delivery classification invalid/)
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

console.log('governance delivery classification tests passed')
