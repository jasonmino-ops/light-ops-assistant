const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const desktopRoot = path.resolve(__dirname, '../..')
const mode = readMode(process.argv.slice(2))
const appAsar = mode === 'asar' ? findPackagedAppAsar() : null
const assetRoot = appAsar ?? desktopRoot
const activationHtmlPath = path.join(assetRoot, 'dist/renderer/activation/index.html')
const activationPreloadPath = path.join(assetRoot, 'dist/preload/activationPreload.js')
const consoleErrors = []
let getStateCalls = 0
let activateCalls = 0
let activationPayloadValid = false

function readMode(args) {
  const explicit = args.find((arg) => arg.startsWith('--mode='))
  const modeValue = explicit?.slice('--mode='.length) ?? 'dist'
  if (modeValue !== 'dist' && modeValue !== 'asar') {
    throw new Error(`unknown Activation Window smoke mode: ${modeValue}`)
  }
  return modeValue
}

function findPackagedAppAsar() {
  const candidates = [
    path.join(desktopRoot, 'release/win-unpacked/resources/app.asar'),
    path.join(desktopRoot, 'release/mac-arm64/E-Shop Desktop.app/Contents/Resources/app.asar'),
    path.join(desktopRoot, 'release/mac/E-Shop Desktop.app/Contents/Resources/app.asar'),
    path.join(desktopRoot, 'release/linux-unpacked/resources/app.asar'),
  ]
  const appAsar = candidates.find((candidate) => fs.existsSync(candidate))
  if (!appAsar) {
    throw new Error(`packaged app.asar not found; checked: ${candidates.join(', ')}`)
  }
  return appAsar
}

function activationState(kind = 'UNACTIVATED') {
  return {
    kind,
    storeCodeHint: 'STORE-A',
    isBusy: kind === 'ACTIVATING',
    canActivate: kind === 'UNACTIVATED',
    canRetryVerify: false,
    canResetLocal: false,
    canQuit: true,
  }
}

function waitFor(condition, message, timeoutMs = 5000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (condition()) {
        resolve()
      } else if (Date.now() - started >= timeoutMs) {
        reject(new Error(message))
      } else {
        setTimeout(poll, 25)
      }
    }
    poll()
  })
}

ipcMain.handle('eshop:activation:get-state', () => {
  getStateCalls += 1
  return { ok: true, state: activationState() }
})
ipcMain.handle('eshop:activation:activate', (_event, payload) => {
  activateCalls += 1
  activationPayloadValid = payload?.storeCode === 'STORE-A' && /^\d{6}$/.test(payload?.pin ?? '')
  return { ok: true, state: activationState('ACTIVATING') }
})
ipcMain.handle('eshop:activation:retry-verify', () => ({ ok: true, state: activationState() }))
ipcMain.handle('eshop:activation:reset-local', () => ({ ok: true, state: activationState() }))
ipcMain.handle('eshop:activation:quit', () => ({ ok: true, state: activationState('QUITTING') }))

const smokeTimeout = setTimeout(() => {
  console.error(`Activation Window ${mode} smoke timed out`)
  app.exit(1)
}, 15000)

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
    if (level >= 3) {
      consoleErrors.push({
        level,
        message,
        line,
        source: path.basename(String(sourceId || '').split(/[?#]/)[0]),
      })
    }
  })

  await win.loadFile(activationHtmlPath)
  await waitFor(() => getStateCalls === 1, 'Activation Renderer did not call getState')

  const startup = await win.webContents.executeJavaScript(`({
    bridgeReadable: typeof window.eshopDesktopActivation?.getState === 'function',
    title: document.querySelector('#state-title')?.textContent,
    formHidden: document.querySelector('#activation-form')?.hidden,
    storeCode: document.querySelector('#store-code')?.value,
    pinDisabled: document.querySelector('#pin')?.disabled,
  })`)
  if (
    !startup.bridgeReadable ||
    startup.title !== '激活此收银台' ||
    startup.formHidden !== false ||
    startup.storeCode !== 'STORE-A' ||
    startup.pinDisabled !== false
  ) {
    throw new Error(`Activation Window did not enter usable form state: ${JSON.stringify(startup)}`)
  }

  await win.webContents.executeJavaScript(`(() => {
    document.querySelector('#store-code').value = 'store-a'
    document.querySelector('#pin').value = '123456'
    document.querySelector('#activation-form').requestSubmit()
  })()`)
  await waitFor(() => activateCalls === 1, 'Activation Renderer did not submit through preload IPC')

  const submitted = await win.webContents.executeJavaScript(`({
    title: document.querySelector('#state-title')?.textContent,
    formHidden: document.querySelector('#activation-form')?.hidden,
  })`)
  if (!activationPayloadValid || submitted.title !== '正在激活' || submitted.formHidden !== true) {
    throw new Error('Activation Window PIN submit chain did not enter ACTIVATING')
  }
  if (consoleErrors.length) {
    throw new Error(`Activation Window emitted renderer errors: ${JSON.stringify(consoleErrors)}`)
  }

  console.log('RESULT=PASS')
  console.log(JSON.stringify({
    mode,
    preloadBridgeReadable: startup.bridgeReadable,
    getStateCalls,
    formUsable: true,
    activateCalls,
    activationPayloadValid,
    rendererErrors: consoleErrors.length,
  }))
  clearTimeout(smokeTimeout)
  win.destroy()
  app.exit(0)
}).catch((error) => {
  console.error(error)
  clearTimeout(smokeTimeout)
  app.exit(1)
})
