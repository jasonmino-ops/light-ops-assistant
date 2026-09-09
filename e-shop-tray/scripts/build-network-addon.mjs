import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { builtinModules, createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

export const TASK_ID = 'ES-PRINT-NETWORK-FIRST-01'
export const ADDON_VERSION = '0.1.0'
export const CANDIDATE_VERSION = '0.1.0-commercial-rc.2'
export const ELECTRON_VERSION = '44.3.0'
export const BASELINE_COMMIT = 'c205dd64821fdbe4ee45197d610b22190427e083'
export const APP_ID = 'com.elife.eshop.networkprint.addon'
export const PACKAGE_NAME = 'eshop-network-print-addon'
export const PRODUCT_NAME = 'E-Shop Network Print Add-on'
export const CANDIDATE_BUILD = Object.freeze({ mode: 'unsigned-test-only', version: CANDIDATE_VERSION,
  target: 'win32-x64', electronVersion: ELECTRON_VERSION, published: false, releaseReady: false })

const tray = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(tray, '..')
const require = createRequire(path.join(tray, 'package.json'))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const fail = code => { throw new Error(code) }
const portable = value => value.split(path.sep).join('/')
const ENTRY_FILES = ['network-addon/main.ts', 'network-addon/preload.ts', 'network-addon/ui.ts', 'src/networkRenderPreload.tsx']
const GUARD_FILE = 'scripts/guards/check-change-scope.js'
const CONFIG_FILE = 'docs/change-gates/gate-config.json'
const EXCEPTION_FILE = `docs/change-gates/exceptions/${TASK_ID}.json`
const FIXED_INPUTS = [
  'package.json', 'package-lock.json',
  'e-shop-tray/package.json', 'e-shop-tray/package-lock.json', 'e-shop-tray/tsconfig.json',
  'e-shop-tray/scripts/build-network-addon.mjs', 'e-shop-tray/network-addon/electron-builder.cjs',
  'e-shop-tray/network-addon/installer.nsh', 'e-shop-tray/network-addon/ui.html',
  'e-shop-tray/network-addon/ui.css', 'public/icon-512.png',
]
export const PAYLOAD_FILES = Object.freeze([
  'main.cjs', 'preload.cjs', 'ui.js', 'ui.html', 'ui.css', 'network-render.cjs',
  'network-render.html', 'icon.png', 'package.json',
])
const RENDER_HTML = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data: blob:; frame-src \'self\' about:; font-src \'self\'; connect-src \'none\'"></head><body></body></html>'

export function parseArgs(args) {
  if (args.length === 0) return { mode: 'check' }
  if (args.length === 1 && ['--check', '--bundle', '--candidate', '--release'].includes(args[0])) return { mode: args[0].slice(2) }
  fail('ADDON_UNSUPPORTED_ARGUMENTS')
}

export function canonicalMapping(mapping) {
  return JSON.stringify(Object.fromEntries(Object.keys(mapping).sort().map(key => [key, mapping[key]])))
}

export function assertSnapshotMatch(before, after) {
  if (canonicalMapping(before) !== canonicalMapping(after)) fail('ADDON_SOURCE_CHANGED_DURING_BUILD')
}

export function assertSafeBuildEnvironment(env = process.env) {
  // Do not inherit alternate JS loaders, module roots or replacement compilers.
  // Only variable names are inspected/reported, never values or credentials.
  if (Object.keys(env).some(key => /^GIT_/i.test(key))
    || ['NODE_OPTIONS', 'NODE_PATH', 'ESBUILD_BINARY_PATH'].some(key => env[key])) fail('ADDON_UNSAFE_BUILD_ENVIRONMENT')
}

export function candidateEnvironment(env = process.env) {
  assertSafeBuildEnvironment(env)
  // Names only: never read signing credentials or accept environment approvals.
  if (Object.keys(env).some(key => /^(?:CSC_|WIN_CSC_|AZURE_|ELECTRON_|APP_BUILDER_|USE_SYSTEM_|SQUIRREL_|SIGNTOOL_|WIN_SIGN_|ESHOP_ADDON_)/i.test(key))) {
    fail('ADDON_CANDIDATE_ENVIRONMENT_OVERRIDE')
  }
  const allowed = ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'SYSTEMROOT', 'WINDIR',
    'LOCALAPPDATA', 'APPDATA', 'USERNAME', 'USER', 'LOGNAME', 'SHELL', 'ComSpec', 'COMSPEC', 'PROGRAMFILES',
    'ProgramFiles', 'ProgramFiles(x86)', 'NUMBER_OF_PROCESSORS']
  return { ...Object.fromEntries(allowed.filter(key => env[key] !== undefined).map(key => [key, env[key]])),
    CSC_IDENTITY_AUTO_DISCOVERY: 'false', ELECTRON_BUILDER_DISABLE_UPDATE_CHECK: 'true',
    npm_config_update_notifier: 'false', CI: 'true' }
}

function git(args) {
  assertSafeBuildEnvironment()
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  if (result.error || result.status !== 0) fail('ADDON_SOURCE_GIT_CHECK_FAILED')
  return result.stdout.trim()
}

export function readSourceState() {
  const headCommit = git(['rev-parse', 'HEAD'])
  if (!/^[a-f0-9]{40}$/.test(headCommit)) fail('ADDON_SOURCE_HEAD_INVALID')
  git(['merge-base', '--is-ancestor', BASELINE_COMMIT, headCommit])
  const dirty = Boolean(git(['status', '--porcelain=v1', '--untracked-files=all']))
  return { baselineCommit: BASELINE_COMMIT, headCommit, sourceCommit: dirty ? null : headCommit, workingTreeDirty: dirty }
}

export function releaseBlockers(source) {
  const blockers = []
  if (source.workingTreeDirty || !source.sourceCommit) blockers.push('CLEAN_COMMITTED_SOURCE_REQUIRED')
  // There is deliberately no env boolean, arbitrary proof JSON, self-signing
  // fallback or signing credential lookup in the formal release route.
  // Add the selected legitimate signing integration plus its Authenticode and
  // trusted origin/main exact-manifest gates only after that route is approved.
  blockers.push('LEGITIMATE_SIGNING_ROUTE_NOT_CONFIGURED', 'TRUSTED_EXACT_RELEASE_MANIFEST_NOT_CONFIGURED')
  return blockers
}

function trustedBlob(ref, file) {
  assertSafeBuildEnvironment()
  const result = spawnSync('git', ['show', `${ref}:${file}`], { cwd: root, windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  if (result.error || result.status !== 0) fail('ADDON_TRUSTED_SOURCE_UNAVAILABLE')
  return result.stdout
}

export function selectCandidateAuthorization(exception, branch) {
  const matches = [{ ...exception, authorizationId: 'PRIMARY' }, ...(exception.additionalAuthorizations || [])]
    .filter(item => item.featureBranch === branch)
  if (exception.taskId !== TASK_ID || matches.length !== 1 || matches[0].status !== 'ACTIVE'
    || matches[0].lineageMode !== 'PRE_COMMIT_CONTENT_SHA256'
    || canonicalMapping(matches[0].candidateBuild || {}) !== canonicalMapping(CANDIDATE_BUILD)) {
    fail('ADDON_CANDIDATE_EXACT_AUTHORIZATION_REQUIRED')
  }
  return matches[0]
}

async function candidateAuthorization() {
  const originMainCommit = git(['rev-parse', 'origin/main'])
  const branch = git(['branch', '--show-current'])
  const trusted = {}
  for (const file of [GUARD_FILE, CONFIG_FILE, EXCEPTION_FILE]) {
    const bytes = await regularFile(path.join(root, file))
    if (!bytes.equals(trustedBlob(originMainCommit, file))) fail('ADDON_CANDIDATE_TRUSTED_GATE_MISMATCH')
    trusted[file] = sha256(bytes)
  }
  const guard = require(path.join(root, GUARD_FILE))
  const exception = guard.validateException(JSON.parse(await regularFile(path.join(root, EXCEPTION_FILE))), root)
  const authorization = selectCandidateAuthorization(exception, branch)
  const result = spawnSync(process.execPath, [path.join(root, GUARD_FILE), '--task-id', TASK_ID,
    '--files', authorization.authorizedPaths.join(',')], { cwd: root, encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0 || !result.stdout.endsWith('PASS\n')) fail('ADDON_CANDIDATE_SCOPE_BLOCKED')
  const changed = [...new Set([...git(['diff', '--name-only', '-z', 'HEAD']).split('\0'),
    ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')].filter(Boolean))].sort()
  return { originMainCommit, branch, authorizationId: authorization.authorizationId,
    approvedContentMappingSha256: sha256(canonicalMapping(authorization.authorizedPathSha256)),
    authorizedPathSha256: authorization.authorizedPathSha256, gateFilesSha256: trusted,
    files: [...new Set([...authorization.authorizedPaths, ...changed, GUARD_FILE, CONFIG_FILE, EXCEPTION_FILE])].sort() }
}

export function assertCandidateInput(file, actualHash, authorizedHashes, trustedHash) {
  if (actualHash !== (Object.hasOwn(authorizedHashes, file) ? authorizedHashes[file] : trustedHash)) {
    fail('ADDON_CANDIDATE_SOURCE_NOT_APPROVED')
  }
}

function verifyCandidateInputs(inputs, authorization) {
  for (const [file, actualHash] of Object.entries(inputs)) {
    if (file.startsWith('dependencies/')) continue
    const trustedHash = Object.hasOwn(authorization.authorizedPathSha256, file)
      ? null : sha256(trustedBlob(authorization.originMainCommit, file))
    assertCandidateInput(file, actualHash, authorization.authorizedPathSha256, trustedHash)
  }
}

async function regularFile(file) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink()) fail('ADDON_INPUT_MUST_BE_REGULAR_FILE')
  return readFile(file)
}

export function assertModuleBoundary(file) {
  const name = portable(file)
  if (/(?:^|\/)e-shop-tray\/src\/main\.ts$|(?:^|\/)(?:network-candidate|desktop)\//.test(name)
    || /qz-tray|qzPrinterAdapter|[Ww]indows[Qq]ueue[Tt]ransport|Write-RawPrint|winspool|@prisma/.test(name)) {
    fail('ADDON_FORBIDDEN_RUNTIME_INPUT')
  }
}

export function assertExternalBoundary(filename, metadata) {
  const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name.replace(/^node:/, '')}`]))
  for (const output of Object.values(metadata.outputs)) {
    for (const item of output.imports || []) {
      if (!item.external) continue
      const permitted = filename === 'main.cjs'
        ? item.path === 'electron' || builtins.has(item.path)
        : filename !== 'ui.js' && item.path === 'electron'
      if (!permitted) fail('ADDON_UNSAFE_EXTERNAL_IMPORT')
    }
  }
}

export function inspectPayload(file, bytes) {
  if (!PAYLOAD_FILES.includes(file)) fail('ADDON_UNEXPECTED_PAYLOAD_FILE')
  if (!/\.(?:cjs|js|json|html|css)$/.test(file)) return
  const text = bytes.toString('utf8')
  if (/Write-RawPrint\.ps1|SUBMITTED_TO_WINDOWS_SPOOLER|WindowsQueueTransport|qz-tray|qzPrinterAdapter/.test(text)) {
    fail('ADDON_FORBIDDEN_RUNTIME_PAYLOAD')
  }
  if (/-----BEGIN (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----|ecc_v1_[A-Za-z0-9_-]{32,128}|postgres(?:ql)?:\/\//.test(text)) {
    fail('ADDON_PROVISIONING_MATERIAL_IN_PAYLOAD')
  }
}

async function toolchain() {
  const lock = JSON.parse(await regularFile(path.join(tray, 'package-lock.json')))
  const versions = {}
  for (const name of ['typescript', 'esbuild', 'electron-builder', 'app-builder-lib', '@electron/asar', '7zip-bin', 'electron']) {
    const installed = require(`${name}/package.json`).version
    if (installed !== lock.packages?.[`node_modules/${name}`]?.version) fail('ADDON_TOOLCHAIN_LOCK_MISMATCH')
    versions[name === 'electron' ? 'electronTypeDefinitions' : name] = installed
  }
  return { ...versions, sevenZipBinarySha256: sha256(await regularFile(require('7zip-bin').path7za)),
    electronRuntime: ELECTRON_VERSION, node: process.versions.node }
}

function typecheck() {
  const ts = require('typescript')
  const config = ts.readConfigFile(path.join(tray, 'tsconfig.json'), ts.sys.readFile)
  if (config.error) fail('ADDON_TYPESCRIPT_CONFIG_INVALID')
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, tray, undefined, path.join(tray, 'tsconfig.json'))
  const options = { ...parsed.options, noEmit: true, jsx: ts.JsxEmit.ReactJSX,
    baseUrl: root, paths: { '@/*': ['./*'] } }
  const program = ts.createProgram(ENTRY_FILES.map(file => path.join(tray, file)), options)
  const errors = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
  if (errors.length) {
    // Compiler diagnostics contain source locations, never environment values.
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: value => value, getCurrentDirectory: () => root, getNewLine: () => '\n',
    }))
    fail('ADDON_TYPESCRIPT_FAILED')
  }
  return program.getSourceFiles().map(file => path.resolve(file.fileName)).sort()
}

async function compileInMemory() {
  const { build } = require('esbuild')
  const shared = { absWorkingDir: root, bundle: true, write: false, metafile: true,
    sourcemap: false, minifySyntax: true, logLevel: 'silent', external: ['electron'],
    nodePaths: [path.join(tray, 'node_modules')],
    plugins: [{ name: 'network-excludes-unused-windows-transport', setup(builder) {
      // This frozen module has only declarations/constants at top level. The
      // compile-time Network profile removes all value references. Do not
      // substitute its code: if a reference survives, live-input checks reject it.
      builder.onResolve({ filter: /^\.\/printing\/windowsQueueTransport$/ }, () => ({
        path: path.join(tray, 'src/printing/windowsQueueTransport.ts'), sideEffects: false,
      }))
    } }],
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', baseUrl: root, paths: { '@/*': ['./*'] } } } }
  const specifications = [
    ['network-addon/main.ts', 'main.cjs', 'node', 'cjs', 'node24'],
    ['network-addon/preload.ts', 'preload.cjs', 'node', 'cjs', 'node24'],
    ['network-addon/ui.ts', 'ui.js', 'browser', 'iife', 'chrome152'],
    ['src/networkRenderPreload.tsx', 'network-render.cjs', 'browser', 'cjs', 'chrome152'],
  ]
  const results = await Promise.all(specifications.map(([entry, filename, platform, format, target]) => build({
    ...shared, entryPoints: [path.join(tray, entry)], outfile: path.join(root, '.addon-memory-only', filename),
    platform, format, target, define: { 'process.env.NODE_ENV': '"production"', 'process.env.ES_TRAY_BUILD_PROFILE': '"network-v2"' },
  })))
  const outputs = {}, inputs = new Set()
  for (const [index, result] of results.entries()) {
    assertExternalBoundary(specifications[index][1], result.metafile)
    const liveInputs = new Set(Object.values(result.metafile.outputs).flatMap(output =>
      Object.entries(output.inputs).filter(([, usage]) => usage.bytesInOutput > 0).map(([input]) => input)))
    for (const input of Object.keys(result.metafile.inputs)) {
      // esbuild records type/fully tree-shaken modules too. Only live bytes
      // belong to runtime; every input still belongs to the source snapshot.
      if (liveInputs.has(input)) assertModuleBoundary(input)
      inputs.add(path.resolve(root, input))
    }
    for (const output of result.outputFiles) {
      const filename = path.basename(output.path)
      if (outputs[filename]) fail('ADDON_DUPLICATE_OUTPUT')
      inspectPayload(filename, Buffer.from(output.contents))
      outputs[filename] = Buffer.from(output.contents)
    }
  }
  return { inputs: [...inputs].sort(), outputs }
}

async function inputMapping(files) {
  const moduleRoots = []
  for (const [label, directory] of [['tray', path.join(tray, 'node_modules')], ['root', path.join(root, 'node_modules')]]) {
    try { moduleRoots.push({ label, directory: await realpath(directory) }) } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  const mapping = {}, resolved = new Map()
  for (const file of [...new Set([...FIXED_INPUTS.map(file => path.join(root, file)), ...files])].sort()) {
    const absolute = await realpath(file)
    const dependency = moduleRoots.find(item => absolute.startsWith(item.directory + path.sep))
    const relative = portable(path.relative(root, absolute))
    const key = dependency ? `dependencies/${dependency.label}/${portable(path.relative(dependency.directory, absolute))}` : relative
    if (!dependency && (relative.startsWith('../') || relative.startsWith('dependencies/') || path.isAbsolute(relative) || /(?:^|\/)\.[^/]+/.test(relative))) {
      fail('ADDON_UNSEALED_INPUT_LOCATION')
    }
    if (!dependency && absolute !== file) fail('ADDON_SOURCE_SYMLINK_REJECTED')
    if (resolved.has(key) && resolved.get(key) !== absolute) fail('ADDON_INPUT_KEY_COLLISION')
    resolved.set(key, absolute)
    mapping[key] = sha256(await regularFile(absolute))
  }
  return JSON.parse(canonicalMapping(mapping))
}

export function createManifest({ source, inputs, outputs, tools, candidate = null }) {
  return {
    schemaVersion: 1, taskId: TASK_ID, product: candidate ? `${PRODUCT_NAME} (TEST ONLY)` : PRODUCT_NAME,
    appId: APP_ID, version: candidate ? CANDIDATE_VERSION : ADDON_VERSION,
    profile: 'network-v2', buildClass: candidate ? 'unsigned-test-candidate' : 'draft-js-only',
    draftUnsignedJsOnly: !candidate, testOnly: Boolean(candidate),
    installer: false, runtimeIncluded: false, releaseReady: false, published: false,
    signingStatus: candidate ? 'unsigned-test-only' : 'not-applicable-js-only', releaseBlockers: releaseBlockers(source),
    ...source, sourceSnapshotSha256: sha256(canonicalMapping(inputs)), inputsSha256: inputs,
    outputsSha256: outputs, tools,
    electronReleaseSource: 'https://releases.electronjs.org/release/v44.3.0',
    manualUpdateOnly: true, desktopRepacked: false,
    ...(candidate ? { manifestPurpose: 'sealed-application-payload', candidateBuild: CANDIDATE_BUILD, candidateAuthorization: candidate,
      payloadTransformations: ['TEST ONLY package metadata, HTML title and visible banner'],
      installed: false, fieldVerified: false } : {}),
  }
}

export function candidateHtml(bytes) {
  const html = bytes.toString('utf8')
  if (html.split('<title>E-Shop Network Print</title>').length !== 2 || html.split('  <main>').length !== 2) {
    fail('ADDON_CANDIDATE_UI_MARKER_MISMATCH')
  }
  return Buffer.from(html.replace('<title>E-Shop Network Print</title>', '<title>E-Shop Network Print — TEST ONLY</title>')
    .replace('  <main>', `  <main>\n    <section role="note"><strong>TEST ONLY · ${CANDIDATE_VERSION} · 未签名测试候选</strong><p>仅供授权安装验收，未正式发布。启用自动打印和发送 TEST 纸票前须由负责人明确确认。</p></section>`))
}

export function candidateBuilderConfig(stage) {
  const formal = require(path.join(tray, 'network-addon/electron-builder.cjs'))
  return { ...formal, productName: `${PRODUCT_NAME} (TEST ONLY)`, forceCodeSigning: false,
    cscLink: '', cscKeyPassword: '',
    directories: { app: path.join(stage, 'app'), output: path.join(stage, 'artifacts'), buildResources: path.join(stage, 'packaging') },
    win: { ...formal.win, forceCodeSigning: false, cscLink: '', cscKeyPassword: '',
      azureSignOptions: null, signtoolOptions: null, sign: null, certificateFile: null, certificatePassword: null,
      certificateSubjectName: null, certificateSha1: null, publisherName: null,
      signAndEditExecutable: false, verifyUpdateCodeSignature: false,
      artifactName: 'E-Shop-Network-Print-Addon-TEST-${version}-x64.exe' },
    nsis: { ...formal.nsis, shortcutName: `${PRODUCT_NAME} (TEST ONLY)`, uninstallDisplayName: `${PRODUCT_NAME} (TEST ONLY)`,
      include: path.join(stage, 'packaging/installer.nsh'), artifactName: 'E-Shop-Network-Print-Addon-TEST-${version}-x64.exe' } }
}

// Reuse the retained rc3 NSIS structural/CRC verification, never its source,
// runtime, profile, identity, version, executable, or authorizations.
const NSIS_SIGNATURE = Buffer.from('efbeadde4e756c6c736f6674496e7374', 'hex')
const MAX_NSIS_BYTES = 512 * 1024 * 1024
export function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function peOverlayOffset(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 512 || bytes.length > MAX_NSIS_BYTES || bytes.readUInt16LE(0) !== 0x5a4d) fail('ADDON_INVALID_PE')
  const pe = bytes.readUInt32LE(60)
  if (pe < 64 || pe + 24 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550) fail('ADDON_INVALID_PE')
  const sections = bytes.readUInt16LE(pe + 6), optionalSize = bytes.readUInt16LE(pe + 20), optional = pe + 24
  const table = optional + optionalSize
  if (optionalSize < 136 || table > bytes.length || ![0x10b, 0x20b].includes(bytes.readUInt16LE(optional))) fail('ADDON_INVALID_PE')
  if (sections < 1 || sections > 96 || table + sections * 40 > bytes.length) fail('ADDON_INVALID_PE')
  const headersSize = bytes.readUInt32LE(optional + 60)
  if (headersSize < table + sections * 40 || headersSize > bytes.length) fail('ADDON_INVALID_PE')
  let end = headersSize
  const spans = []
  for (let index = 0; index < sections; index++) {
    const entry = table + index * 40, size = bytes.readUInt32LE(entry + 16), offset = bytes.readUInt32LE(entry + 20)
    if (size && (offset < headersSize || offset + size > bytes.length)) fail('ADDON_INVALID_PE')
    if (size) { end = Math.max(end, offset + size); spans.push([offset, offset + size]) }
  }
  spans.sort((left, right) => left[0] - right[0])
  if (!spans.length || spans.some((span, index) => index > 0 && span[0] < spans[index - 1][1])) fail('ADDON_INVALID_PE')
  return end
}

export function inspectUnsignedPe(bytes, machine) {
  const offset = peOverlayOffset(bytes), pe = bytes.readUInt32LE(60), optional = pe + 24
  if (bytes.readUInt16LE(pe + 4) !== machine || (bytes.readUInt16LE(pe + 22) & 0x2000)) fail('ADDON_INVALID_PE_ARCH')
  const security = optional + (bytes.readUInt16LE(optional) === 0x20b ? 112 : 96) + 32
  if (security + 8 > optional + bytes.readUInt16LE(pe + 20)
    || bytes.readUInt32LE(security) || bytes.readUInt32LE(security + 4)) fail('ADDON_CANDIDATE_UNEXPECTED_SIGNATURE')
  return offset
}

export function verifyNsisBinary(bytes, uninstaller = false) {
  const offset = inspectUnsignedPe(bytes, 0x14c)
  const pe = bytes.readUInt32LE(60)
  if (bytes.readUInt16LE(pe + 24) !== 0x10b || offset < 512 || offset % 512 || offset + 32 > bytes.length
    || !bytes.subarray(offset + 4, offset + 20).equals(NSIS_SIGNATURE)) fail('ADDON_INVALID_NSIS')
  for (let earlier = 512; earlier < offset; earlier += 512) {
    if (bytes.subarray(earlier + 4, earlier + 20).equals(NSIS_SIGNATURE)) fail('ADDON_INVALID_NSIS')
  }
  const flags = bytes.readUInt32LE(offset), headerLength = bytes.readUInt32LE(offset + 20)
  if (flags !== (uninstaller ? 1 : 0) || bytes.readUInt32LE(offset + 24) !== bytes.length - offset
    || headerLength < 68 || headerLength > 16 * 1024 * 1024) fail('ADDON_INVALID_NSIS')
  const actual = crc32(bytes.subarray(512, bytes.length - 4))
  if (bytes.readUInt32LE(bytes.length - 4) !== actual) fail('ADDON_NSIS_CRC_MISMATCH')
  return { offset, flags, headerLength, crc32: actual.toString(16).padStart(8, '0'), bytes: bytes.length }
}

function* nsisBlocks(bytes, info) {
  let position = info.offset + 28, count = 0, expanded = 0
  while (position < bytes.length - 4) {
    if (count >= 1024 || position + 4 > bytes.length - 4) fail('ADDON_INVALID_NSIS_BLOCK')
    const field = bytes.readUInt32LE(position), length = field & 0x7fffffff
    position += 4
    if (!length || position + length > bytes.length - 4) fail('ADDON_INVALID_NSIS_BLOCK')
    let block = bytes.subarray(position, position + length)
    position += length
    if (field >>> 31) {
      const result = inflateRawSync(block, { info: true, maxOutputLength: MAX_NSIS_BYTES })
      if (result.engine.bytesWritten !== length) fail('ADDON_INVALID_NSIS_BLOCK')
      block = result.buffer
    }
    expanded += block.length
    if (expanded > MAX_NSIS_BYTES || (count === 0 && block.length !== info.headerLength)) fail('ADDON_INVALID_NSIS_BLOCK')
    count++
    yield block
  }
  if (!count || position !== bytes.length - 4) fail('ADDON_INVALID_NSIS_BLOCK')
}

export function inspectCandidateInstaller(bytes) {
  const installer = verifyNsisBinary(bytes), matches = [], archives = []
  for (const block of nsisBlocks(bytes, installer)) {
    if (block.subarray(0, 6).equals(Buffer.from('377abcaf271c', 'hex'))) archives.push(block)
    if (block.length < 512 || block.readUInt16LE(0) !== 0x5a4d) continue
    // NSIS also embeds ordinary PE plugin DLLs. Inspect only their structure
    // to find an NSIS overlay; unsigned x86 EXE checks apply to the uninstaller.
    const offset = peOverlayOffset(block)
    if (offset + 20 <= block.length && block.subarray(offset + 4, offset + 20).equals(NSIS_SIGNATURE)) {
      const validation = verifyNsisBinary(block, true)
      for (const _innerBlock of nsisBlocks(block, validation)) { /* Validate without rewriting. */ }
      matches.push({ buffer: block, validation })
    }
  }
  if (matches.length !== 1) fail('ADDON_NSIS_UNINSTALLER_MISMATCH')
  return { installer, uninstaller: matches[0].validation, uninstallerBuffer: matches[0].buffer,
    applicationArchives: archives }
}

export async function extractArchiveMember(archive, member, env) {
  if (!['resources/app.asar', 'E-Shop-Network-Print-Addon.exe'].includes(member)) fail('ADDON_UNEXPECTED_ARCHIVE_MEMBER')
  // The builder's own helper normalizes its installed binary's executable mode.
  const result = spawnSync(await require('builder-util').getPath7za(),
    ['x', '-so', '-bd', '-bso0', '-bsp0', '-bse2', archive, member],
    { cwd: path.dirname(archive), env, windowsHide: true, maxBuffer: MAX_NSIS_BYTES })
  if (result.error || result.status !== 0 || !result.stdout.length) fail('ADDON_EMBEDDED_ARCHIVE_READ_FAILED')
  return result.stdout
}

export function assertEmbeddedApplication(asarBytes, executableBytes, expectedAsarHash, expectedExecutableHash) {
  if (sha256(asarBytes) !== expectedAsarHash || sha256(executableBytes) !== expectedExecutableHash) {
    fail('ADDON_INSTALLER_APPLICATION_MISMATCH')
  }
}

async function listFiles(directory, prefix = '') {
  const files = []
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(directory, relative))
    else if (entry.isFile()) files.push(portable(relative))
    else fail('ADDON_OUTPUT_MUST_BE_REGULAR_FILE')
  }
  return files.sort()
}

async function assertStage(stage) {
  const temp = await realpath(os.tmpdir()), actual = await realpath(stage), info = await lstat(stage)
  if (!info.isDirectory() || info.isSymbolicLink() || actual !== stage || path.dirname(stage) !== temp
    || !/^es-network-addon-TEST-[A-Za-z0-9]+$/.test(path.basename(stage))) fail('ADDON_UNSAFE_STAGE')
  for (const directory of ['app', 'artifacts', 'packaging']) {
    const child = path.join(stage, directory)
    try {
      const entry = await lstat(child)
      if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(child) !== child) fail('ADDON_UNSAFE_STAGE')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

async function packageCandidate({ outputs, outputHashes, manifest, verifySources, env }) {
  const stage = await mkdtemp(path.join(await realpath(os.tmpdir()), 'es-network-addon-TEST-'))
  await assertStage(stage)
  for (const directory of ['app', 'artifacts', 'packaging']) await mkdir(path.join(stage, directory), { mode: 0o700 })
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  const staged = { ...outputs, 'build-manifest.json': manifestBytes }
  const stageHashes = { ...outputHashes, 'build-manifest.json': sha256(manifestBytes) }
  for (const [file, bytes] of Object.entries(staged)) await writeFile(path.join(stage, 'app', file), bytes, { flag: 'wx', mode: 0o600 })
  const installerBytes = await regularFile(path.join(tray, 'network-addon/installer.nsh'))
  await writeFile(path.join(stage, 'packaging/installer.nsh'), installerBytes, { flag: 'wx' })
  const config = candidateBuilderConfig(stage)
  const configPath = path.join(stage, 'packaging/candidate-builder.json')
  const configBytes = Buffer.from(`${JSON.stringify(config, null, 2)}\n`)
  await writeFile(configPath, configBytes, { flag: 'wx' })
  const verifyStage = async () => {
    await assertStage(stage)
    for (const [file, hash] of Object.entries(stageHashes)) {
      if (sha256(await regularFile(path.join(stage, 'app', file))) !== hash) fail('ADDON_CANDIDATE_STAGE_CHANGED')
    }
    if (!(await regularFile(configPath)).equals(configBytes)
      || !(await regularFile(path.join(stage, 'packaging/installer.nsh'))).equals(installerBytes)) fail('ADDON_CANDIDATE_STAGE_CHANGED')
  }
  await verifyStage()
  await verifySources()
  process.stderr.write(`TEST candidate staging and build log: ${stage}\n`)
  const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--projectDir', path.join(stage, 'app'),
    '--config', configPath, '--win', 'nsis', '--x64', '--publish', 'never'],
  { cwd: path.join(stage, 'app'), env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  // Keep child logs private/local. A failure never emits PASS or a release claim.
  await writeFile(path.join(stage, 'builder.log'), `${result.stdout || ''}\n${result.stderr || ''}`, { flag: 'wx', mode: 0o600 })
  if (result.error || result.status !== 0) fail('ADDON_CANDIDATE_PACKAGING_FAILED')
  await verifyStage()
  await verifySources()
  const artifactDir = path.join(stage, 'artifacts'), asarFile = path.join(artifactDir, 'win-unpacked/resources/app.asar')
  await regularFile(asarFile)
  const asar = require('@electron/asar')
  const files = asar.listPackage(asarFile).map(file => portable(file).replace(/^\//, '')).filter(file => !asar.statFile(asarFile, file).files).sort()
  if (JSON.stringify(files) !== JSON.stringify(Object.keys(staged).sort())) fail('ADDON_ASAR_FILE_MISMATCH')
  for (const file of files) {
    if (asar.statFile(asarFile, file).unpacked || sha256(asar.extractFile(asarFile, file)) !== stageHashes[file]) fail('ADDON_ASAR_HASH_MISMATCH')
  }
  const applicationExecutable = await regularFile(path.join(artifactDir, 'win-unpacked/E-Shop-Network-Print-Addon.exe'))
  inspectUnsignedPe(applicationExecutable, 0x8664)
  const installerName = `E-Shop-Network-Print-Addon-TEST-${CANDIDATE_VERSION}-x64.exe`
  const nsis = inspectCandidateInstaller(await regularFile(path.join(artifactDir, installerName)))
  if (nsis.applicationArchives.length !== 1) fail('ADDON_NSIS_APPLICATION_ARCHIVE_MISMATCH')
  const embeddedArchivePath = path.join(stage, 'packaging/embedded-application.7z')
  await writeFile(embeddedArchivePath, nsis.applicationArchives[0], { flag: 'wx', mode: 0o600 })
  // Stream two exact members to memory. Never extract archive-controlled paths
  // onto disk, and never repair or replace bytes inside the installer.
  assertEmbeddedApplication(await extractArchiveMember(embeddedArchivePath, 'resources/app.asar', env),
    await extractArchiveMember(embeddedArchivePath, 'E-Shop-Network-Print-Addon.exe', env),
    sha256(await regularFile(asarFile)), sha256(applicationExecutable))
  const uninstallerName = `Uninstall-E-Shop-Network-Print-Addon-TEST-${CANDIDATE_VERSION}-x64.exe`
  await writeFile(path.join(artifactDir, uninstallerName), nsis.uninstallerBuffer, { flag: 'wx' })
  const artifactFiles = await listFiles(artifactDir)
  if (artifactFiles.some(file => /(?:^|\/)(?:app-update\.yml|latest.*\.yml|elevate\.exe)$/.test(file))) fail('ADDON_UNEXPECTED_UPDATE_ARTIFACT')
  const artifactHashes = {}
  for (const file of artifactFiles) artifactHashes[file] = sha256(await regularFile(path.join(artifactDir, file)))
  await verifySources()
  const finalManifest = { ...manifest, manifestPurpose: 'verified-test-installer', installer: true, runtimeIncluded: true,
    asarPayloadVerified: true, installerAsarAndExecutableVerified: true, nsisStructureVerified: true,
    electronRuntimeVersionVerified: false, embeddedApplicationArchiveSha256: sha256(nsis.applicationArchives[0]),
    candidateConfigSha256: sha256(configBytes), embeddedManifestSha256: stageHashes['build-manifest.json'],
    installerFile: installerName, uninstallerFile: uninstallerName, artifactsSha256: artifactHashes,
    nsisValidation: { installer: nsis.installer, uninstaller: nsis.uninstaller, crcChecksEnabled: true } }
  const finalBytes = Buffer.from(`${JSON.stringify(finalManifest, null, 2)}\n`)
  await writeFile(path.join(stage, 'candidate-build-manifest.json'), finalBytes, { flag: 'wx', mode: 0o600 })
  const checksums = { 'candidate-build-manifest.json': sha256(finalBytes), ...Object.fromEntries(Object.entries(artifactHashes).map(([file, hash]) => [`artifacts/${file}`, hash])) }
  await writeFile(path.join(stage, 'SHA256SUMS.txt'), Object.keys(checksums).sort().map(file => `${checksums[file]}  ${file}\n`).join(''), { flag: 'wx' })
  return { manifest: finalManifest, outputDirectory: stage }
}

export async function buildAddon(options = { mode: 'check' }) {
  if (!['check', 'bundle', 'candidate', 'release'].includes(options.mode) || Object.keys(options).some(key => key !== 'mode')) fail('ADDON_UNSUPPORTED_MODE')
  assertSafeBuildEnvironment()
  const source = readSourceState()
  if (options.mode === 'release') fail(`ADDON_RELEASE_NOT_READY: ${releaseBlockers(source).join(', ')}`)
  const candidateEnv = options.mode === 'candidate' ? candidateEnvironment() : null
  const candidate = options.mode === 'candidate' ? await candidateAuthorization() : null
  const tools = await toolchain()
  const typeInputs = typecheck()
  // First pass discovers actual transitive inputs without writing any output.
  const discovery = await compileInMemory()
  const candidateInputs = candidate ? candidate.files.map(file => path.join(root, file)) : []
  const before = await inputMapping([...discovery.inputs, ...typeInputs, ...candidateInputs])
  if (candidate) verifyCandidateInputs(before, candidate)
  const checkedInputs = typecheck()
  if (JSON.stringify(typeInputs) !== JSON.stringify(checkedInputs)) fail('ADDON_TYPE_INPUT_SET_CHANGED_DURING_BUILD')
  const compiled = await compileInMemory()
  if (JSON.stringify(discovery.inputs) !== JSON.stringify(compiled.inputs)) fail('ADDON_INPUT_SET_CHANGED_DURING_BUILD')
  const outputs = {
    ...compiled.outputs,
    'ui.html': candidate ? candidateHtml(await regularFile(path.join(tray, 'network-addon/ui.html'))) : await regularFile(path.join(tray, 'network-addon/ui.html')),
    'ui.css': await regularFile(path.join(tray, 'network-addon/ui.css')),
    'network-render.html': Buffer.from(RENDER_HTML),
    'icon.png': await regularFile(path.join(root, 'public/icon-512.png')),
    'package.json': Buffer.from(JSON.stringify({ name: PACKAGE_NAME, productName: candidate ? `${PRODUCT_NAME} (TEST ONLY)` : PRODUCT_NAME,
      version: candidate ? CANDIDATE_VERSION : ADDON_VERSION, private: true, main: 'main.cjs',
      description: candidate ? 'TEST ONLY unsigned Network Print Add-on candidate; not a formal release' : 'Independent Network Print Add-on draft JS bundle' }, null, 2)),
  }
  if (JSON.stringify(Object.keys(outputs).sort()) !== JSON.stringify([...PAYLOAD_FILES].sort())) fail('ADDON_PAYLOAD_ALLOWLIST_MISMATCH')
  for (const [file, bytes] of Object.entries(outputs)) inspectPayload(file, bytes)
  const finalInputs = [...compiled.inputs, ...checkedInputs, ...candidateInputs]
  assertSnapshotMatch(before, await inputMapping(finalInputs))
  assertSnapshotMatch(source, readSourceState())
  const outputHashes = Object.fromEntries(Object.entries(outputs).map(([file, bytes]) => [file, sha256(bytes)]))
  const manifest = createManifest({ source, inputs: before, outputs: outputHashes, tools, candidate })
  if (options.mode === 'check') return { manifest, outputDirectory: null }
  if (candidate) return packageCandidate({ outputs, outputHashes, manifest, env: candidateEnv, verifySources: async () => {
    assertSnapshotMatch(before, await inputMapping(finalInputs))
    assertSnapshotMatch(source, readSourceState())
    if (JSON.stringify(candidate) !== JSON.stringify(await candidateAuthorization())) fail('ADDON_CANDIDATE_AUTHORIZATION_CHANGED')
    verifyCandidateInputs(before, candidate)
  } })

  // The caller cannot choose an output path. Never overwrite a prior draft,
  // candidate/rc3, source checkout, Desktop installation or retained evidence.
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'es-network-addon-bundle-'))
  for (const [file, bytes] of Object.entries(outputs)) {
    await writeFile(path.join(outputDirectory, file), bytes, { flag: 'wx', mode: 0o600 })
    if (sha256(await regularFile(path.join(outputDirectory, file))) !== outputHashes[file]) fail('ADDON_OUTPUT_HASH_MISMATCH')
  }
  assertSnapshotMatch(before, await inputMapping(finalInputs))
  assertSnapshotMatch(source, readSourceState())
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(path.join(outputDirectory, 'build-manifest.json'), manifestBytes, { flag: 'wx', mode: 0o600 })
  const checksums = { ...outputHashes, 'build-manifest.json': sha256(manifestBytes) }
  await writeFile(path.join(outputDirectory, 'SHA256SUMS.txt'), Object.keys(checksums).sort()
    .map(file => `${checksums[file]}  ${file}\n`).join(''), { flag: 'wx', mode: 0o600 })
  return { manifest, outputDirectory }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const { manifest, outputDirectory } = await buildAddon(options)
    console.log(JSON.stringify({ status: 'PASS', mode: options.mode, buildClass: manifest.buildClass,
      sourceCommit: manifest.sourceCommit, sourceSnapshotSha256: manifest.sourceSnapshotSha256,
      electronRuntime: ELECTRON_VERSION, outputDirectory, releaseReady: false }))
  } catch (error) {
    // Do not print tool stdout, credential-bearing environments or raw errors.
    console.error(error instanceof Error && /^ADDON_[A-Z_]+(?:: [A-Z_, ]+)?$/.test(error.message)
      ? error.message : 'ADDON_BUILD_FAILED')
    process.exitCode = 1
  }
}
