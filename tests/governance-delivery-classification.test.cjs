const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

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

console.log('governance delivery classification tests passed')
