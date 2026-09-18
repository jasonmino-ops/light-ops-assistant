const DELIVERY_CLASSES = ['WEB', 'DESKTOP_SHELL', 'MIXED']
const DELIVERY_RUNTIMES = [
  'REMOTE_WEB_VIA_BROWSERWINDOW_LOADURL',
  'DESKTOP_SHELL_LOCAL_RUNTIME',
  'MIXED_REMOTE_WEB_AND_DESKTOP_SHELL',
]
const MILESTONE_IDENTITY = [
  'desktopShellCandidateSha',
  'desktopShellVersion',
  'desktopInstallerSha256',
  'productionWebDeploymentId',
  'productionWebSourceSha',
]

function fail(message) {
  throw new Error(`delivery classification invalid: ${message}`)
}

function isWebPath(filePath) {
  return typeof filePath === 'string' && (
    filePath.startsWith('app/') ||
    filePath.startsWith('lib/') ||
    filePath === 'middleware.ts'
  )
}

function isDesktopShellPath(filePath) {
  return typeof filePath === 'string' && (
    filePath.startsWith('desktop/') ||
    filePath.startsWith('packages/hrt-contract/')
  )
}

function validateRegister(register) {
  if (!register || typeof register !== 'object' || Array.isArray(register)) fail('register must be an object')
  const classification = register.deliveryClassification
  if (!classification || typeof classification !== 'object' || Array.isArray(classification)) {
    fail('deliveryClassification is required')
  }
  if (classification.schemaVersion !== 'es-risk-based-delivery.delivery-classification.v1') {
    fail('deliveryClassification schemaVersion is invalid')
  }
  if (JSON.stringify(classification.classes) !== JSON.stringify(DELIVERY_CLASSES)) {
    fail('deliveryClassification classes are invalid')
  }
  if (typeof classification.remoteWebDesktopRule !== 'string' || !classification.remoteWebDesktopRule.includes('do not require Desktop repackaging')) {
    fail('remote Web rule is missing')
  }
  if (JSON.stringify(classification.milestoneIdentity) !== JSON.stringify(MILESTONE_IDENTITY)) {
    fail('milestone identity fields are invalid')
  }
  if (!Array.isArray(register.sourceAcceptancePilots)) fail('sourceAcceptancePilots is required')
  for (const pilot of register.sourceAcceptancePilots) validatePilot(pilot)
  return true
}

function validatePilot(pilot) {
  if (!pilot || typeof pilot !== 'object' || Array.isArray(pilot)) fail('source acceptance pilot must be an object')
  if (!DELIVERY_CLASSES.includes(pilot.deliveryClass)) fail(`${pilot.taskId ?? 'pilot'}.deliveryClass is unknown`)
  if (!DELIVERY_RUNTIMES.includes(pilot.runtimeDelivery)) fail(`${pilot.taskId ?? 'pilot'}.runtimeDelivery is unknown`)
  if (!Array.isArray(pilot.boundaryPaths) || pilot.boundaryPaths.length === 0) fail(`${pilot.taskId ?? 'pilot'}.boundaryPaths is required`)
  const hasWeb = pilot.boundaryPaths.some(isWebPath)
  const hasDesktop = pilot.boundaryPaths.some(isDesktopShellPath)
  if (pilot.boundaryPaths.some((filePath) => !isWebPath(filePath) && !isDesktopShellPath(filePath))) {
    fail(`${pilot.taskId ?? 'pilot'} contains an unrecognized boundary path`)
  }
  if (pilot.deliveryClass === 'WEB') {
    if (pilot.runtimeDelivery !== 'REMOTE_WEB_VIA_BROWSERWINDOW_LOADURL') fail(`${pilot.taskId ?? 'pilot'} WEB runtime must be remote Web`)
    if (!hasWeb || hasDesktop) fail(`${pilot.taskId ?? 'pilot'} WEB boundary must be Web-only`)
  }
  if (pilot.deliveryClass === 'DESKTOP_SHELL') {
    if (pilot.runtimeDelivery !== 'DESKTOP_SHELL_LOCAL_RUNTIME' || !hasDesktop || hasWeb) fail(`${pilot.taskId ?? 'pilot'} DESKTOP_SHELL boundary/runtime mismatch`)
  }
  if (pilot.deliveryClass === 'MIXED') {
    if (pilot.runtimeDelivery !== 'MIXED_REMOTE_WEB_AND_DESKTOP_SHELL' || !hasWeb || !hasDesktop) fail(`${pilot.taskId ?? 'pilot'} MIXED boundary/runtime mismatch`)
  }
  return true
}

module.exports = { DELIVERY_CLASSES, DELIVERY_RUNTIMES, MILESTONE_IDENTITY, validatePilot, validateRegister }
