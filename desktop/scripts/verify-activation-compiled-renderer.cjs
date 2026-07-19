#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const MISSING_ARTIFACT_MESSAGE = [
  'Compiled activation renderer artifact is missing.',
  'Run `npm run compile` before compiled verification.',
].join('\n')

const relativeArtifacts = {
  rendererJs: 'dist/renderer/activation/activationRenderer.js',
  rendererHtml: 'dist/renderer/activation/index.html',
  preloadJs: 'dist/preload/activationPreload.js',
}

const requiredCheckpointStages = [
  'script-started',
  'bridge-detected',
  'subscribed',
  'get-state-started',
  'get-state-succeeded',
  'rendered',
]

function toPosixPath(value) {
  return String(value).replace(/\\/g, '/')
}

function resolveArtifacts(desktopRoot) {
  return {
    rendererJs: path.join(desktopRoot, relativeArtifacts.rendererJs),
    rendererHtml: path.join(desktopRoot, relativeArtifacts.rendererHtml),
    preloadJs: path.join(desktopRoot, relativeArtifacts.preloadJs),
  }
}

function readRequiredText(filePath, missingMessage) {
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    throw new Error(missingMessage)
  }

  if (!stat.isFile()) {
    throw new Error(`Compiled activation renderer artifact is not a file: ${toPosixPath(filePath)}`)
  }
  if (stat.size === 0) {
    throw new Error(`Compiled activation renderer artifact is empty: ${toPosixPath(filePath)}`)
  }

  const source = fs.readFileSync(filePath, 'utf8')
  if (!source.trim()) {
    throw new Error(`Compiled activation renderer artifact is empty: ${toPosixPath(filePath)}`)
  }
  return source
}

function loadCompiledActivationArtifacts(options = {}) {
  const desktopRoot = path.resolve(options.desktopRoot ?? path.join(__dirname, '..'))
  const artifacts = resolveArtifacts(desktopRoot)
  return {
    desktopRoot,
    paths: artifacts,
    rendererSource: readRequiredText(artifacts.rendererJs, MISSING_ARTIFACT_MESSAGE),
    htmlSource: readRequiredText(
      artifacts.rendererHtml,
      `Compiled activation renderer HTML is missing: ${relativeArtifacts.rendererHtml}`,
    ),
    preloadSource: readRequiredText(
      artifacts.preloadJs,
      `Compiled activation preload artifact is missing: ${relativeArtifacts.preloadJs}`,
    ),
  }
}

function assertClassicScriptHtml(htmlSource) {
  if (!/<script\s+src=["']\.\/activationRenderer\.js["']\s*><\/script>/i.test(htmlSource)) {
    throw new Error('Activation HTML must load activationRenderer.js as a classic script.')
  }
  if (/<script[^>]+type=["']module["']/i.test(htmlSource)) {
    throw new Error('Activation HTML must not load activationRenderer.js as an ES module.')
  }
}

function assertNoCommonJsOrEsmRuntime(source) {
  if (/Object\.defineProperty\s*\(\s*exports\b/.test(source)) {
    throw new Error('Compiled activation renderer contains CommonJS exports prologue.')
  }
  if (/\bmodule\.exports\b/.test(source)) {
    throw new Error('Compiled activation renderer contains module.exports.')
  }
  if (/\brequire\s*\(/.test(source)) {
    throw new Error('Compiled activation renderer contains require(...).')
  }
  if (/\bexports\b/.test(source)) {
    throw new Error('Compiled activation renderer contains CommonJS exports.')
  }

  const lines = source.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//')) continue
    if (/^import(?:\s+[\w*{]|\s*["'])/.test(trimmed)) {
      throw new Error('Compiled activation renderer contains top-level ESM import syntax.')
    }
    if (/^export(?:\s|\s*\{|\s*\*)/.test(trimmed)) {
      throw new Error('Compiled activation renderer contains top-level ESM export syntax.')
    }
  }
}

function createRecorder(impl = () => undefined) {
  const calls = []
  const fn = (...args) => {
    calls.push(args)
    return impl(...args)
  }
  fn.calls = calls
  return fn
}

function makeElement() {
  return {
    textContent: '',
    hidden: false,
    disabled: false,
    value: '',
    onclick: null,
    focus: createRecorder(),
    addEventListener: createRecorder(),
  }
}

function makeDom() {
  const elements = new Map()
  for (const selector of [
    '#activation-form',
    '#store-code',
    '#pin',
    '#state-title',
    '#state-detail',
    '#status-code',
    '#activate-button',
    '#retry-button',
    '#reset-button',
    '#quit-button',
    '#busy',
  ]) {
    elements.set(selector, makeElement())
  }
  return {
    elements,
    document: {
      querySelector: createRecorder((selector) => elements.get(selector) ?? null),
    },
  }
}

function activationState(kind = 'UNACTIVATED') {
  return {
    kind,
    isBusy: kind === 'BOOTING',
    canActivate: kind === 'UNACTIVATED',
    canRetryVerify: false,
    canResetLocal: false,
    canQuit: true,
    storeCodeHint: 'STORE-A',
  }
}

async function flushAsyncRendererWork() {
  await Promise.resolve()
  await new Promise((resolve) => setImmediate(resolve))
}

async function executeClassicScriptHarness(source) {
  const { elements, document } = makeDom()
  const checkpoints = []
  const consoleErrors = []
  const windowListeners = new Map()
  const getState = createRecorder(async () => ({ ok: true, state: activationState() }))
  const onStateChanged = createRecorder(() => createRecorder())
  const reportStartupCheckpoint = createRecorder(async (checkpoint) => {
    checkpoints.push(checkpoint)
    return { ok: true }
  })
  const consoleError = createRecorder((...args) => {
    consoleErrors.push(args.map((arg) => String(arg)).join(' '))
  })

  const context = vm.createContext({
    document,
    console: { error: consoleError },
    setTimeout,
    clearTimeout,
    window: {
      confirm: createRecorder(() => true),
      location: { reload: createRecorder() },
      addEventListener: createRecorder((event, listener) => {
        windowListeners.set(event, [...(windowListeners.get(event) ?? []), listener])
      }),
      eshopDesktopActivation: {
        getState,
        activate: createRecorder(),
        retryVerification: createRecorder(),
        resetLocalActivation: createRecorder(),
        quit: createRecorder(),
        onStateChanged,
        reportStartupCheckpoint,
      },
    },
  })

  try {
    vm.runInContext(source, context, { filename: 'activationRenderer.js' })
  } catch (error) {
    throw new Error(`Compiled activation renderer failed under classic-script VM: ${error.message}`)
  }

  await flushAsyncRendererWork()

  if (consoleErrors.length) {
    throw new Error(`Compiled activation renderer emitted console errors: ${JSON.stringify(consoleErrors)}`)
  }

  const checkpointStages = checkpoints.map((checkpoint) => checkpoint.stage)
  if (JSON.stringify(checkpointStages) !== JSON.stringify(requiredCheckpointStages)) {
    throw new Error(`Unexpected activation renderer checkpoints: ${JSON.stringify(checkpoints)}`)
  }

  const watchdogTriggered = checkpoints.some((checkpoint) => checkpoint.stage === 'startup-error')
  if (watchdogTriggered) {
    throw new Error(`Activation renderer watchdog/startup error detected: ${JSON.stringify(checkpoints)}`)
  }

  if (getState.calls.length !== 1) {
    throw new Error(`Activation renderer did not read initial state exactly once: ${getState.calls.length}`)
  }
  if (onStateChanged.calls.length !== 1) {
    throw new Error(`Activation renderer did not subscribe to bridge state changes exactly once: ${onStateChanged.calls.length}`)
  }

  const title = elements.get('#state-title')?.textContent
  const formHidden = elements.get('#activation-form')?.hidden
  const storeCode = elements.get('#store-code')?.value
  const pinDisabled = elements.get('#pin')?.disabled
  if (title !== '激活此收银台' || formHidden !== false || storeCode !== 'STORE-A' || pinDisabled !== false) {
    throw new Error(`Unexpected activation renderer DOM: ${JSON.stringify({ title, formHidden, storeCode, pinDisabled })}`)
  }

  return {
    checkpointStages,
    checkpoints,
    consoleErrors,
    watchdogTriggered,
    dom: {
      title,
      formHidden,
      storeCode,
      pinInputPresent: elements.has('#pin'),
      pinDisabled,
      statusCode: elements.get('#status-code')?.textContent,
    },
  }
}

async function verifyCompiledActivationRenderer(options = {}) {
  const artifacts = loadCompiledActivationArtifacts(options)
  assertClassicScriptHtml(artifacts.htmlSource)
  assertNoCommonJsOrEsmRuntime(artifacts.rendererSource)

  if (!/contextBridge\.exposeInMainWorld/.test(artifacts.preloadSource)) {
    throw new Error('Activation preload must expose the activation bridge with contextBridge.exposeInMainWorld.')
  }

  const harness = await executeClassicScriptHarness(artifacts.rendererSource)
  return {
    result: 'PASS',
    rendererJs: toPosixPath(path.relative(artifacts.desktopRoot, artifacts.paths.rendererJs)),
    rendererHtml: toPosixPath(path.relative(artifacts.desktopRoot, artifacts.paths.rendererHtml)),
    preloadJs: toPosixPath(path.relative(artifacts.desktopRoot, artifacts.paths.preloadJs)),
    ...harness,
  }
}

function parseCliArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--root') {
      options.desktopRoot = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--root=')) {
      options.desktopRoot = arg.slice('--root='.length)
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

async function runCli(options = {}) {
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  try {
    const cliOptions = {
      ...parseCliArgs(options.argv ?? process.argv.slice(2)),
      ...(options.desktopRoot ? { desktopRoot: options.desktopRoot } : {}),
    }
    const result = await verifyCompiledActivationRenderer(cliOptions)
    stdout.write('compiled activation renderer verification: PASS\n')
    stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return 0
  } catch (error) {
    stderr.write(`${error.message}\n`)
    return 1
  }
}

if (require.main === module) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode
  })
}

module.exports = {
  MISSING_ARTIFACT_MESSAGE,
  assertClassicScriptHtml,
  assertNoCommonJsOrEsmRuntime,
  executeClassicScriptHarness,
  loadCompiledActivationArtifacts,
  parseCliArgs,
  requiredCheckpointStages,
  runCli,
  toPosixPath,
  verifyCompiledActivationRenderer,
}
