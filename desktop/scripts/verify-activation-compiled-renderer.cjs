#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const desktopRoot = path.resolve(__dirname, '..')
const rendererPath = path.join(desktopRoot, 'dist/renderer/activation/activationRenderer.js')
const rendererHtmlPath = path.join(desktopRoot, 'dist/renderer/activation/index.html')
const preloadPath = path.join(desktopRoot, 'dist/preload/activationPreload.js')

function readRequired(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`missing compiled activation artifact: ${path.relative(desktopRoot, filePath)}`)
  }
  const source = fs.readFileSync(filePath, 'utf8')
  if (!source.trim()) {
    throw new Error(`empty compiled activation artifact: ${path.relative(desktopRoot, filePath)}`)
  }
  return source
}

function assertBrowserClassicScript(rendererSource, htmlSource) {
  if (!/<script\s+src=["']\.\/activationRenderer\.js["']\s*><\/script>/i.test(htmlSource)) {
    throw new Error('Activation HTML must load activationRenderer.js as a classic script')
  }
  if (/<script[^>]+type=["']module["']/i.test(htmlSource)) {
    throw new Error('Activation HTML must not load activationRenderer.js as an ES module')
  }

  const forbidden = [
    [/\bexports\b/, 'exports'],
    [/\brequire\s*\(/, 'require(...)'],
    [/\bmodule\.exports\b/, 'module.exports'],
  ]
  for (const [pattern, label] of forbidden) {
    if (pattern.test(rendererSource)) {
      throw new Error(`compiled Activation Renderer contains forbidden CommonJS runtime reference: ${label}`)
    }
  }
}

function recorder(implementation = () => undefined) {
  const calls = []
  const fn = (...args) => {
    calls.push(args)
    return implementation(...args)
  }
  fn.calls = calls
  return fn
}

function element() {
  const listeners = new Map()
  return {
    textContent: '',
    hidden: false,
    disabled: false,
    value: '',
    focus: recorder(),
    addEventListener: recorder((event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    }),
    listeners,
  }
}

function unactivatedState() {
  return {
    kind: 'UNACTIVATED',
    storeCodeHint: 'STORE-A',
    isBusy: false,
    canActivate: true,
    canRetryVerify: false,
    canResetLocal: false,
    canQuit: true,
  }
}

async function flushAsyncWork() {
  await Promise.resolve()
  await new Promise((resolve) => setImmediate(resolve))
}

async function verifyCompiledRuntime(rendererSource) {
  const selectors = [
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
  ]
  const elements = new Map(selectors.map((selector) => [selector, element()]))
  const getState = recorder(async () => ({ ok: true, state: unactivatedState() }))
  const activate = recorder(async () => ({ ok: true, state: { ...unactivatedState(), kind: 'ACTIVATING', isBusy: true, canActivate: false } }))
  const consoleError = recorder()
  const windowListeners = new Map()
  const window = {
    confirm: recorder(() => true),
    addEventListener: recorder((event, listener) => {
      windowListeners.set(event, [...(windowListeners.get(event) ?? []), listener])
    }),
    eshopDesktopActivation: {
      getState,
      activate,
      retryVerification: recorder(),
      resetLocalActivation: recorder(),
      quit: recorder(),
      onStateChanged: recorder(() => recorder()),
    },
  }

  const context = vm.createContext({
    document: {
      querySelector: (selector) => elements.get(selector) ?? null,
    },
    console: { error: consoleError },
    window,
  })

  try {
    vm.runInContext(rendererSource, context, { filename: 'activationRenderer.js' })
  } catch (error) {
    throw new Error(`compiled Activation Renderer failed as a browser classic script: ${error.message}`)
  }

  await flushAsyncWork()
  if (getState.calls.length !== 1) {
    throw new Error(`compiled Activation Renderer called getState ${getState.calls.length} times`)
  }

  const form = elements.get('#activation-form')
  const storeCodeInput = elements.get('#store-code')
  const pinInput = elements.get('#pin')
  const stateTitle = elements.get('#state-title')
  if (
    stateTitle.textContent !== '激活此收银台' ||
    form.hidden !== false ||
    storeCodeInput.value !== 'STORE-A' ||
    pinInput.disabled !== false
  ) {
    throw new Error('compiled Activation Renderer did not enter the usable activation form state')
  }

  storeCodeInput.value = 'STORE-A'
  pinInput.value = '123456'
  const submitListeners = form.listeners.get('submit') ?? []
  if (submitListeners.length !== 1) {
    throw new Error(`compiled Activation Renderer registered ${submitListeners.length} submit handlers`)
  }
  submitListeners[0]({ preventDefault() {} })
  await flushAsyncWork()

  if (activate.calls.length !== 1) {
    throw new Error(`compiled Activation Renderer called activate ${activate.calls.length} times`)
  }
  const activationInput = activate.calls[0][0]
  if (activationInput?.storeCode !== 'STORE-A' || !/^\d{6}$/.test(activationInput?.pin ?? '')) {
    throw new Error('compiled Activation Renderer did not forward a valid activation payload')
  }
  if (consoleError.calls.length) {
    throw new Error('compiled Activation Renderer emitted console errors')
  }

  return {
    getStateCalls: getState.calls.length,
    activateCalls: activate.calls.length,
    formUsable: true,
  }
}

async function main() {
  const rendererSource = readRequired(rendererPath)
  const htmlSource = readRequired(rendererHtmlPath)
  const preloadSource = readRequired(preloadPath)
  assertBrowserClassicScript(rendererSource, htmlSource)
  if (!/contextBridge\.exposeInMainWorld\(\s*['"]eshopDesktopActivation['"]/.test(preloadSource)) {
    throw new Error('compiled Activation preload does not expose eshopDesktopActivation through contextBridge')
  }

  const runtime = await verifyCompiledRuntime(rendererSource)
  console.log('compiled activation renderer verification: PASS')
  console.log(JSON.stringify({
    commonJsRuntimeReferences: false,
    preloadBridgePresent: true,
    ...runtime,
  }))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
