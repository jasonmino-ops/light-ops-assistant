const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const desktopRoot = path.resolve(__dirname, '../..')
const appAsar = process.argv[2] ? path.resolve(process.argv[2]) : null
const assetRoot = appAsar ?? desktopRoot
const checkpoints = []
const consoleErrors = []

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
    show: false,
    width: 480,
    height: 620,
    webPreferences: {
      preload: path.join(assetRoot, 'dist/preload/activationPreload.js'),
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

  await win.loadFile(path.join(assetRoot, 'dist/renderer/activation/index.html'))
  await waitForRendered()
  const dom = await win.webContents.executeJavaScript(`({
    title: document.querySelector('#state-title')?.textContent,
    formHidden: document.querySelector('#activation-form')?.hidden,
    storeCode: document.querySelector('#store-code')?.value,
    statusCode: document.querySelector('#status-code')?.textContent,
  })`)
  if (consoleErrors.length) throw new Error(`activation renderer console errors: ${JSON.stringify(consoleErrors)}`)
  const stages = checkpoints.map((checkpoint) => checkpoint.stage)
  for (const expected of ['preload-ready', 'script-started', 'bridge-detected', 'subscribed', 'get-state-started', 'get-state-succeeded', 'rendered']) {
    if (!stages.includes(expected)) throw new Error(`missing checkpoint ${expected}: ${JSON.stringify(checkpoints)}`)
  }
  if (dom.title !== '激活此收银台' || dom.formHidden !== false || dom.storeCode !== 'STORE-A') {
    throw new Error(`unexpected activation DOM: ${JSON.stringify(dom)}`)
  }
  console.log('RESULT=PASS')
  console.log(JSON.stringify({ checkpoints, dom, consoleErrors }, null, 2))
  app.exit(0)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
