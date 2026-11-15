const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (value) => fs.readFileSync(path.join(root, value), 'utf8')

test('V3 control plane schema is dedicated, store-scoped and device-scope fenced', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /model V3PrintControlPlane \{/)
  assert.match(schema, /storeId\s+String\s+@unique/)
  assert.match(schema, /ownerEpoch\s+Int\s+@default\(0\)/)
  assert.match(schema, /ownerDevice DesktopDevice\?\s+@relation\("V3PrintControlPlaneOwner", fields: \[ownerDeviceId, tenantId, storeId\]/)
  assert.match(schema, /model V3PrintExecutionBatch \{/)
  assert.match(schema, /ownerDevice\s+DesktopDevice\s+@relation\("V3PrintExecutionBatchOwner", fields: \[ownerDeviceId, tenantId, storeId\]/)
})

test('migration constrains mode, owner shape, expiry and exact composite identity', () => {
  const sql = read('prisma/migrations/20260923022000_add_v3_print_control_plane/migration.sql')
  assert.match(sql, /mode_check.*V2_ACTIVE.*V2_DRAINING.*V3_ACTIVE.*V3_DRAINING.*BLOCKED_UNKNOWN/s)
  assert.match(sql, /owner_shape_check/)
  assert.match(sql, /V3PrintExecutionBatch_expiry_check/)
  assert.match(sql, /FOREIGN KEY \("ownerDeviceId", "tenantId", "storeId"\) REFERENCES "DesktopDevice"\("id", "tenantId", "storeId"\)/)
})

test('server writer rejects timeout promotion and requires explicit fenced writes', () => {
  const source = read('lib/v3-print-control-plane.ts')
  const recoverExpiredSelfSource = source.slice(
    source.indexOf('export async function recoverExpiredSelfV3Authority'),
    source.indexOf('export async function releaseV3Authority'),
  )
  assert.match(source, /OWNER_LIVENESS_AMBIGUOUS/)
  assert.match(recoverExpiredSelfSource, /leaseExpiresAt:\s*\{\s*lte: now\s*\}/)
  assert.doesNotMatch(recoverExpiredSelfSource, /ownerEpoch:\s*\{\s*increment/)
  assert.match(source, /SELECT "id" FROM "V3PrintControlPlane"[\s\S]*FOR UPDATE/)
  assert.match(recoverExpiredSelfSource, /await lockControlPlaneRow\(tx, observed\)[\s\S]*const activeBatch/)
  assert.match(source.slice(source.indexOf('export async function issueV3ExecutionBatch'), source.indexOf('const MODE_TRANSITIONS')),
    /await lockControlPlaneRow\(tx, observed\)[\s\S]*v3PrintExecutionBatch\.create/)
  assert.match(source, /stateVersion: identity\.stateVersion/)
  assert.match(source, /leaseExpiresAt: \{ gt: now \}/)
  assert.match(source, /controlledV3OwnerHandoff/)
  assert.match(source, /recoverExpiredSelfV3Authority/)
  assert.match(source, /RECOVER_EXPIRED_SELF_ATTEMPT/)
  assert.match(source, /RECOVER_EXPIRED_SELF_SUCCESS/)
  assert.match(source, /RECOVER_EXPIRED_SELF_REJECTED/)
})

test('Desktop and Owner APIs keep authority roles separate and retire raw OWNER mode writes', () => {
  const desktop = read('app/api/desktop/v3-print-control-plane/route.ts')
  const owner = read('app/api/owner/v3-print-control-plane/route.ts')
  assert.match(desktop, /getDesktopDeviceContext/)
  assert.match(desktop, /body\.action === 'RECOVER_EXPIRED_SELF'/)
  assert.doesNotMatch(desktop, /transitionV3PrintMode|controlledV3OwnerHandoff/)
  assert.match(owner, /ctx\.role !== 'OWNER'/)
  assert.match(owner, /body\.action === 'SET_MODE'/)
  assert.match(owner, /RAW_SET_MODE_RETIRED/)
  assert.match(owner, /status: 409/)
  assert.doesNotMatch(owner, /transitionV3PrintMode|V3_PRINT_MODES/)
  assert.match(owner, /controlledV3OwnerHandoff/)
})

test('V3 receive contract is batch-fenced and explicitly role-aware on client and server', () => {
  const route = read('app/api/desktop/v3-print-jobs/route.ts')
  const client = read('desktop/src/main/printing/v3PrintJobClient.ts')
  const adapter = read('lib/v3-print-job-adapter.ts')
  assert.match(route, /searchParams\.get\('role'\)/)
  assert.match(route, /parseV3PrintRole\(searchParams\.get\('role'\)\)/)
  assert.match(route, /deliverV3PrintIntent\(db, \{ \.\.\.auth\.context, batchId, role \}\)/)
  assert.match(client, /batchId=\$\{encodeURIComponent\(batch\.id\)\}&role=\$\{encodeURIComponent\(role\)\}/)
  assert.match(client, /intent\.role !== role/)
  assert.match(adapter, /payload: \{ path: \['role'\], equals: identity\.role \}/)
  assert.match(adapter, /if \(!batch\) return \{ ok: false as const, code: 'V3_BATCH_STALE' \}/)
  assert.match(adapter, /db\.\$transaction\(async \(transaction\)/)
  assert.match(adapter, /FROM "V3PrintControlPlane"[\s\S]*FOR UPDATE/)
})

test('Ops activation adapter is authenticated, store-scoped and service-composed', () => {
  const route = read('app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/route.ts')
  const service = read('app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/service.ts')
  assert.match(route, /getFkBackedOpsAdminIdentity\(request, 'OPS_ADMIN'\)/)
  assert.match(route, /where: \{ id: storeId, tenantId, status: 'ACTIVE' \}/)
  assert.match(route, /resolveOpsPrintStoreAccess/)
  assert.match(route, /parseOpsPrintModeCommand/)
  assert.match(route, /validateOpsPrintMutationRequest/)
  assert.match(service, /'tenantId' in input \|\| 'storeId' in input \|\| 'ownerDeviceId' in input/)
  assert.match(service, /transitionV3PrintMode/)
  assert.match(service, /START_ACTIVATION[\s\S]*nextMode: 'V2_DRAINING'/)
  assert.match(service, /ENTER_MANUAL_REVIEW[\s\S]*nextMode: 'BLOCKED_UNKNOWN'/)
  assert.match(service, /FINALIZE_V3_ACTIVE[\s\S]*nextMode: 'V3_ACTIVE'/)
  assert.match(service, /START_DEACTIVATION[\s\S]*nextMode: 'V3_DRAINING'/)
  assert.match(service, /FINALIZE_V2_ACTIVE[\s\S]*nextMode: 'V2_ACTIVE'/)
  assert.match(service, /expectedStateVersion: initial\.stateVersion/)
  assert.match(service, /V2_DRAIN_NOT_COMPLETE/)
  assert.match(service, /V3_DRAIN_NOT_COMPLETE/)
  assert.match(service, /V3_EXECUTION_AMBIGUOUS/)
  assert.match(service, /V3_DURABLY_HELD/)
  assert.match(service, /V2_DRAIN_WINDOW_MS = 120_000/)
  assert.match(service, /effectBoundary: 'CROSSING_UNKNOWN'/)
  assert.match(service, /V3_PRINT_MODE_OPERATOR_CONFIRMATION/)
  assert.match(service, /isolationLevel: 'Serializable'/)
  assert.match(service, /throw new RejectedTransition/)
  assert.match(route, /UNEXPECTED_SERVER_ERROR/)
  assert.doesNotMatch(`${route}\n${service}`, /v3PrintControlPlane\.(?:update|updateMany|upsert)\(/)
})

test('Ops merchant detail renders authoritative modes and fail-closed controls', () => {
  const page = read('app/ops/[tenantId]/page.tsx')
  // Labels are rendered through the single presentation helper; retain all Chinese contract assertions.
  const display = page + '\n' + read('app/ops/[tenantId]/localFirstPresentation.ts')
  assert.match(page, /describePrintMode\(state/)
  assert.match(page, /打印模式/)
  assert.match(display, /传统打印/)
  assert.match(display, /正在切换到 Local First/)
  assert.match(display, /Local First/)
  assert.match(display, /正在切回传统打印/)
  assert.match(display, /需要人工处理/)
  assert.match(page, /BLOCKED_UNKNOWN 不会自动转出/)
  assert.match(page, /确认启用 Local First/)
  assert.match(page, /确认恢复传统打印/)
  assert.match(page, /expectedStateVersion: state\.controlPlane\.stateVersion/)
  assert.match(page, /if \(!state \|\| loading \|\| error\) return/)
  assert.match(page, /disabled=\{controlsDisabled\}/)
})

// ES-OPS-LOCAL-FIRST-UX-01: captured before UI edits. These protect operations, not layout.
const operationSignatures = {
  "app/ops/[tenantId]/page.tsx": {
    "patch": "280cc295c814395cbfcf1ed84cf136b9c9ca89d7ce4b13bcf582971cab107fd8",
    "toggleFeatured": "f4e1744d42c3c314ff06fd70323c386c278d1766cdf3a62e1240906baeabc615",
    "saveSort": "08e196acac27b4e5599cfd7cc317d9624b9d13fcfa85daa0178252093e1979d4",
    "loadPrintMode": "cbf569c0e9068a5fb9f376d61486613043a0d71218ce02773d867eb1ed4e174b",
    "requestTransition": "b696e3aea96d7538a0577bbf283e51e4945307c965d84dafd217b23641d593d4"
  },
  "app/ops/[tenantId]/DiamondFounderRecoveryPanel.tsx": {
    "object": "116c7eb1a323aee332afb4dd83434b0a4a1eb9b5bf406857ed7a7a69cad5904a",
    "exactKeys": "e41d0671351fd4ec6a6db280afceb32cfaeb6dd11543d7c520b8bfd4d061ac11",
    "iso": "90cd312f8a28472374e18985343971fa21a62fd0e20b331c5b0645c647943131",
    "parseCapture": "40cb63e99586e89bf1130d0faa29ed9b4c973c026b221db218c749ff6700faea",
    "stateAllowsReview": "6dcc45fc4ba1b65ac24ba41e4bdb659ce7ddb5a97896fc36296f9956fe53ae58",
    "captureIsFresh": "d87bce7baadce3130c95d76437d2b707e7acc5e6377a0a75061db72eb61b5a67",
    "recoveryActions": "eeea62d0e79e2d1abffb841ba4179cec11ef560f8be4bc284b243072d8b46087",
    "clearEvidence": "d65046d43a86c75c809051ea6a168744183aacda17450b5d98c51a2dd6f1ff52",
    "postOnce": "f3e79352cbc07ce3a78c7d773afbb435d48b4e473f30336b0e1ce710fbd6903c",
    "review": "9b7330c593b198e6d8fd95799bc120d44d617d1764d3b38ab151685669f2b049",
    "expire": "c256e5bd71eec1e7b137be4ca64046492acac5c2651490a7f5e2bb516b83dd84"
  }
}
const ts = require('typescript')
const { createHash } = require('node:crypto')
const operationPrinter = ts.createPrinter({ removeComments: true })
function signature(source, name) {
  const file = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit) }
  visit(file)
  if (!found) throw Error('missing function ' + name)
  return createHash('sha256').update(operationPrinter.printNode(ts.EmitHint.Unspecified, found, file)).digest('hex')
}

test('Local First UX leaves all existing mutation handlers and eligibility functions unchanged', () => {
  for (const [file, functions] of Object.entries(operationSignatures)) {
    for (const [name, expected] of Object.entries(functions)) assert.equal(signature(read(file), name), expected, file + ': ' + name)
  }
})

test('operation guard rejects changed payloads and eligibility boundaries', () => {
  const panel = read('app/ops/[tenantId]/DiamondFounderRecoveryPanel.tsx')
  for (const [name, before, after] of [
    ['review', 'confirmed: true', 'confirmed: false'],
    ['expire', 'expectedStateVersion: activeGrant.stateVersion', 'expectedStateVersion: 0'],
    ['recoveryActions', 'EXPIRE_WINDOW_MS - 5000', 'EXPIRE_WINDOW_MS'],
    ['stateAllowsReview', 'recovery.leasePresent === false', 'true'],
  ]) {
    assert.ok(panel.includes(before))
    assert.notEqual(signature(panel.replace(before, after), name), operationSignatures['app/ops/[tenantId]/DiamondFounderRecoveryPanel.tsx'][name])
  }
})

test('Local First UX keeps original action visibility, disabled expressions and click bindings', () => {
  const page = read('app/ops/[tenantId]/page.tsx')
  const file = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let panel
  function locate(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'PrintModePanel') panel = node; ts.forEachChild(node, locate) }
  locate(file)
  const buttons = []
  const visibility = []
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'controlsDisabled') assert.equal(node.initializer.getText(file), 'loading || busy || error !== null')
    if (ts.isBinaryExpression(node) && node.left.getText(file).startsWith('state?.actions.')) visibility.push(node.left.getText(file))
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(file) === 'button') {
      const values = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).filter(a => ['disabled', 'onClick'].includes(a.name.text)).map(a => [a.name.text, a.initializer.expression.getText(file)]))
      buttons.push(values)
    }
    ts.forEachChild(node, visit)
  }
  visit(panel)
  assert.deepEqual(visibility, ['startActivation','startDeactivation','enterManualReview','finalizeV3Active','finalizeV2Active'].map(key => 'state?.actions.' + key))
  assert.deepEqual(buttons, [...['START_ACTIVATION','START_DEACTIVATION','ENTER_MANUAL_REVIEW','FINALIZE_V3_ACTIVE','FINALIZE_V2_ACTIVE'].map(action => ({disabled: 'controlsDisabled', onClick: "() => requestTransition('" + action + "')"})), {disabled: 'loading || busy', onClick: 'loadPrintMode'}])
  const founder = read('app/ops/[tenantId]/DiamondFounderRecoveryPanel.tsx')
  assert.match(founder, /disabled=\{!mayReview\}[^>]*onClick=\{review\}/)
  assert.match(founder, /disabled=\{!mayExpire\}[^>]*onClick=\{expire\}/)
})

test('N1/N4/N7: setup copy, single display mapping and evidence accessible names match real UI', () => {
  const page = read('app/ops/[tenantId]/page.tsx')
  const founder = read('app/ops/[tenantId]/DiamondFounderRecoveryPanel.tsx')
  const labels = read('lib/i18n/zh.ts')
  const management = read('app/management/page.tsx')
  assert.match(page, /import zh from '@\/lib\/i18n\/zh'/)
  assert.match(page, /\{zh\.management\.title\} → \{zh\.management\.system\} → \{zh\.management\.printConfig\}/)
  assert.doesNotMatch(page, /管理中心 → (?:系统 → )?打印(?:设置|配置)|PRINT_MODE_META/)
  const managementTree = ts.createSourceFile('management.tsx', management, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const labelsTree = ts.createSourceFile('zh.ts', labels, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const find = (root, matches) => {
    const found = []
    function visit(node) { if (matches(node)) found.push(node); ts.forEachChild(node, visit) }
    visit(root)
    return found
  }
  const value = (object, key) => object && ts.isObjectLiteralExpression(object) ? object.properties.find(
    property => ts.isPropertyAssignment(property) && property.name.getText() === key,
  )?.initializer : undefined
  const system = find(managementTree, node => value(node, 'key')?.text === 'system')
  assert.equal(system.length, 1)
  assert.equal(value(system[0], 'title')?.getText(), "t('management.system')")
  const entries = value(system[0], 'entries')
  assert.ok(entries && ts.isArrayLiteralExpression(entries))
  const printEntry = entries.elements.filter(entry => value(entry, 'action')?.text === 'printing')
  assert.equal(printEntry.length, 1)
  assert.equal(value(printEntry[0], 'label')?.getText(), "t('management.printConfig')")
  assert.equal(value(printEntry[0], 'desktopOnly')?.kind, ts.SyntaxKind.TrueKeyword)

  const dictionaries = find(labelsTree, node => ts.isVariableDeclaration(node) && node.name.getText() === 'zh')
  assert.equal(dictionaries.length, 1)
  const dictionary = dictionaries[0].initializer
  const chineseManagement = value(ts.isAsExpression(dictionary) ? dictionary.expression : dictionary, 'management')
  assert.equal(value(chineseManagement, 'title')?.text, '管理中心')
  assert.equal(value(chineseManagement, 'system')?.text, '系统')

  // Distinguish the actual guarded native panel from legacy Desktop, not comments or imports.
  const native = find(managementTree, node =>
    (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText() === 'PrintSettingsPanel',
  )
  const nativeBridge = find(managementTree, node => ts.isPropertyAccessExpression(node)
    && node.expression.getText() === 'window' && node.name.text === 'eshopDesktopV3PrintSettings')
  assert.equal(native.length, nativeBridge.length ? 1 : 0)
  if (native.length) {
    let branch = ts.isJsxOpeningElement(native[0]) ? native[0].parent : native[0]
    while (ts.isParenthesizedExpression(branch.parent)) branch = branch.parent
    assert.ok(ts.isConditionalExpression(branch.parent) && branch.parent.whenTrue === branch
      && nativeBridge.includes(branch.parent.condition), 'native print panel must be guarded by the V3 bridge')
    const surface = find(managementTree, node => ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'section'
      && node.openingElement.attributes.properties.some(attr => ts.isJsxAttribute(attr)
        && attr.name.getText() === 'data-printing-info-surface' && attr.initializer?.text === 'desktop-only'))
    assert.equal(surface.length, 1)
    assert.ok(find(surface[0], node => node === native[0]).length, 'native panel must be inside Desktop print settings')
  }
  assert.equal(value(chineseManagement, 'printConfig')?.text, native.length ? '打印配置' : '打印设置')
  assert.match(page, /\{presentation\.label\}/)
  for (const label of ['Windows 本地采集证据（JSON）','目标电脑 Installation ID（安装身份）']) {
    assert.ok(founder.includes('>' + label + '</label>'))
    assert.ok(founder.includes('aria-label="' + label + '"'))
  }
  assert.match(founder, /EXPIRE 实际可提交时间剩余 \{presentation\.expireSubmitWindow\.seconds\}/)
  assert.match(founder, /采集后 295 秒/)
})
