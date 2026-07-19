const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, ipcMain } = require('electron')

const desktopRoot = path.resolve(__dirname, '../..')
const smokeConfig = parseSmokeConfig(process.argv.slice(2))
const appAsar = smokeConfig.mode === 'asar' ? smokeConfig.appAsar : null
const assetRoot = appAsar ?? desktopRoot
const activationHtmlPath = path.join(assetRoot, 'dist/renderer/activation/index.html')
const activationPreloadPath = path.join(assetRoot, 'dist/preload/activationPreload.js')
const expectedActivationUrl = pathToFileURL(activationHtmlPath).toString()
const checkpoints = []
const consoleErrors = []
const smokeTimeout = setTimeout(() => {
  console.error(`activation ${smokeConfig.mode} smoke timed out`)
  app.exit(1)
}, 10000)

function parseSmokeConfig(args) {
  let mode = 'dist'
  let explicitAsar = null

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--mode') {
      mode = args[index + 1] ?? mode
      index += 1
      continue
    }
    if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length)
      continue
    }
    if (arg === '--asar') {
      explicitAsar = args[index + 1] ?? explicitAsar
      mode = 'asar'
      index += 1
      continue
    }
    if (arg.startsWith('--asar=')) {
      explicitAsar = arg.slice('--asar='.length)
      mode = 'asar'
      continue
    }
    if (arg === '--dist') {
      mode = 'dist'
      continue
    }
    if (arg === '--asar-mode') {
      mode = 'asar'
      continue
    }
    if (!arg.startsWith('--')) {
      explicitAsar = arg
      mode = 'asar'
    }
  }

  if (mode !== 'dist' && mode !== 'asar') {
    throw new Error(`unknown activation smoke mode: ${mode}`)
  }

  return {
    mode,
    appAsar: mode === 'asar' ? path.resolve(explicitAsar ?? findPackagedAppAsar()) : null,
  }
}

function findPackagedAppAsar() {
  const candidates = [
    path.join(desktopRoot, 'release/win-unpacked/resources/app.asar'),
    path.join(desktopRoot, 'release/mac-arm64/E-Shop Desktop.app/Contents/Resources/app.asar'),
    path.join(desktopRoot, 'release/linux-unpacked/resources/app.asar'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(`packaged app.asar not found; checked: ${candidates.join(', ')}`)
}

function state(kind = 'UNACTIVATED') {
  return {
    kind,
    storeCodeHint: 'STORE-A',
    isBusy: false,
    canActivate: kind === 'UNACTIVATED',
    canRetryVerify: false,
    canResetLocal: false,
    canQuit: true,
  }
}

function waitForRendered(timeoutMs = 5000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const startupError = checkpoints.find((checkpoint) => checkpoint.stage === 'startup-error')
      if (startupError) {
        reject(new Error(`activation renderer reported startup-error: ${JSON.stringify(startupError)}`))
        return
      }
      if (checkpoints.some((checkpoint) => checkpoint.stage === 'rendered' && checkpoint.stateKind === 'UNACTIVATED')) {
        resolve()
        return
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timed out waiting for activation renderer checkpoints: ${JSON.stringify(checkpoints)}`))
        return
      }
      setTimeout(tick, 50)
    }
    tick()
  })
}

function loadedActivationPathCategory(loadedUrl) {
  if (loadedUrl === expectedActivationUrl) {
    return smokeConfig.mode === 'asar' ? 'PACKAGED_ASAR_ACTIVATION_INDEX_HTML' : 'DIST_ACTIVATION_INDEX_HTML'
  }
  if (loadedUrl.startsWith('file:') && loadedUrl.includes('/dist/renderer/activation/index.html')) {
    return 'ACTIVATION_INDEX_HTML_URL_MISMATCH'
  }
  return 'NON_ACTIVATION_PAGE'
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message)
}

ipcMain.handle('eshop:activation:renderer-checkpoint', (_event, payload) => {
  checkpoints.push(payload)
  return { ok: true }
})
ipcMain.handle('eshop:activation:get-state', () => ({ ok: true, state: state() }))
ipcMain.handle('eshop:activation:activate', () => ({ ok: true, state: state('VERIFYING') }))
ipcMain.handle('eshop:activation:retry-verify', () => ({ ok: true, state: state('VERIFYING') }))
ipcMain.handle('eshop:activation:reset-local', () => ({ ok: true, state: state() }))
ipcMain.handle('eshop:activation:quit', () => ({ ok: true, state: state('QUITTING') }))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    title: 'E-Shop Desktop Activation',
    show: false,
    width: 480,
    height: 620,
    webPreferences: {
      preload: activationPreloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      consoleErrors.push({
        level,
        message,
        line,
        source: path.basename(String(sourceId || '').split(/[?#]/)[0]),
      })
    }
  })

  await win.loadFile(activationHtmlPath)
  await waitForRendered()
  const loadedUrl = win.webContents.getURL()
  const loadedUrlCategory = loadedActivationPathCategory(loadedUrl)
  const dom = await win.webContents.executeJavaScript(`({
    documentTitle: document.title,
    bodyTextPreview: (document.body?.innerText || '').slice(0, 240),
    hasActivationBrand: (document.body?.innerText || '').includes('E-Shop Desktop') &&
      (document.body?.innerText || '').includes('店小二电脑收银台'),
    hasActivationForm: Boolean(document.querySelector('#activation-form')),
    storeCodeInputPresent: Boolean(document.querySelector('#store-code')),
    pinInputPresent: Boolean(document.querySelector('#pin')),
    pinDisabled: document.querySelector('#pin')?.disabled,
    title: document.querySelector('#state-title')?.textContent,
    formHidden: document.querySelector('#activation-form')?.hidden,
    storeCode: document.querySelector('#store-code')?.value,
    statusCode: document.querySelector('#status-code')?.textContent,
    defaultElectronPageDetected: document.title === 'Electron' ||
      /welcome to electron|electron quick start|electron fiddle|electron default/i.test(document.body?.innerText || ''),
  })`)
  if (consoleErrors.length) throw new Error(`activation renderer console errors: ${JSON.stringify(consoleErrors)}`)
  assertCondition(loadedUrlCategory !== 'NON_ACTIVATION_PAGE', `loaded non-activation page: ${loadedUrl}`)
  assertCondition(loadedUrl === expectedActivationUrl, `loaded URL mismatch: expected ${expectedActivationUrl}, got ${loadedUrl}`)
  assertCondition(win.getTitle() === 'E-Shop Desktop Activation', `unexpected BrowserWindow title: ${win.getTitle()}`)
  assertCondition(dom.documentTitle === 'E-Shop Desktop Activation', `unexpected document title: ${dom.documentTitle}`)
  assertCondition(!dom.defaultElectronPageDetected, `Electron default page detected: ${JSON.stringify(dom)}`)
  assertCondition(dom.hasActivationBrand, `missing E-Shop Activation brand: ${JSON.stringify(dom)}`)
  assertCondition(dom.hasActivationForm, `missing activation form: ${JSON.stringify(dom)}`)
  assertCondition(dom.storeCodeInputPresent, `missing storeCode input: ${JSON.stringify(dom)}`)
  assertCondition(dom.pinInputPresent, `missing PIN input: ${JSON.stringify(dom)}`)
  const stages = checkpoints.map((checkpoint) => checkpoint.stage)
  for (const expected of ['preload-ready', 'script-started', 'bridge-detected', 'subscribed', 'get-state-started', 'get-state-succeeded', 'rendered']) {
    if (!stages.includes(expected)) throw new Error(`missing checkpoint ${expected}: ${JSON.stringify(checkpoints)}`)
  }
  const watchdogTriggered = checkpoints.some((checkpoint) => checkpoint.stage === 'startup-error')
  if (watchdogTriggered) throw new Error(`activation watchdog/startup error detected: ${JSON.stringify(checkpoints)}`)
  if (dom.title !== '激活此收银台' || dom.formHidden !== false || dom.storeCode !== 'STORE-A' || dom.pinDisabled !== false) {
    throw new Error(`unexpected activation DOM: ${JSON.stringify(dom)}`)
  }
  console.log('RESULT=PASS')
  console.log(JSON.stringify({
    mode: smokeConfig.mode,
    appAsar,
    browserWindowTitle: win.getTitle(),
    loadedUrlCategory,
    defaultElectronPageDetected: dom.defaultElectronPageDetected,
    watchdogTriggered,
    checkpoints,
    dom,
    consoleErrors,
  }, null, 2))
  clearTimeout(smokeTimeout)
  app.exit(0)
}).catch((error) => {
  console.error(error)
  clearTimeout(smokeTimeout)
  app.exit(1)
})
