import path from 'node:path'
import { app, dialog, Menu, nativeImage, safeStorage, Tray } from 'electron'
import { CloudRelayClient, readCloudRelayConfig } from './cloudRelayClient'
import {
  desktopBindingIdentityPath,
  readDesktopBindingIdentity,
} from './desktopBindingIdentity'
import { ExecutionJournal, type ClaimTokenProtector } from './executionJournal'
import { WindowsQueueTransport } from './printing/windowsQueueTransport'
import { RelayPoller } from './relayPoller'
import { RelayResultLog } from './resultLog'

let tray: Tray | null = null
let poller: RelayPoller | null = null

function resourcePath(filename: string): string {
  if (app.isPackaged) return path.join(process.resourcesPath, filename)
  return filename === 'icon.png'
    ? path.resolve(__dirname, '..', '..', 'public', 'icon-512.png')
    : path.resolve(__dirname, '..', 'assets', filename)
}

function encryptedClaimTokenProtector(): ClaimTokenProtector {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('WINDOWS_SECURE_STORAGE_UNAVAILABLE')
  }
  return {
    protect(value) {
      return safeStorage.encryptString(value).toString('base64')
    },
    unprotect(value) {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    },
  }
}

async function start(): Promise<void> {
  const config = readCloudRelayConfig()
  if (!config) {
    dialog.showErrorBox(
      'E-Shop Tray',
      'Production Relay configuration missing. Set ES_TRAY_02_CLOUD_URL, then restart Tray.',
    )
    app.quit()
    return
  }

  let binding
  try {
    binding = await readDesktopBindingIdentity(
      desktopBindingIdentityPath(app.getPath('appData')),
    )
  } catch {
    dialog.showErrorBox(
      'E-Shop Tray',
      'An active E-Shop Desktop binding is required. Complete Desktop binding, then restart Tray.',
    )
    app.quit()
    return
  }

  const transport = new WindowsQueueTransport({
    scriptPath: resourcePath('Write-RawPrint.ps1'),
  })
  const userData = app.getPath('userData')
  const journal = new ExecutionJournal(
    path.join(userData, 'es-tray-02-execution-journal.json'),
    encryptedClaimTokenProtector(),
  )
  await journal.load()
  const resultLog = new RelayResultLog(path.join(userData, 'es-tray-02-results.jsonl'))
  const client = new CloudRelayClient({
    config,
    credential: {
      installationId: binding.installationId,
      deviceSecret: binding.deviceSecret,
    },
  })
  poller = new RelayPoller({ client, transport, journal, recorder: resultLog })

  const icon = nativeImage.createFromPath(resourcePath('icon.png')).resize({ width: 20, height: 20 })
  tray = new Tray(icon)
  tray.setToolTip(`E-Shop Tray V${app.getVersion()}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Production Relay', enabled: false },
    { label: '固定队列：前台', enabled: false },
    { label: '成功仅表示 Winspool 接受，非物理出纸确认', enabled: false },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        poller?.stop()
        app.quit()
      },
    },
  ]))
  poller.start()
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('window-all-closed', () => {
    // Keep the tray-only production receiver resident on Windows.
  })
  app.on('before-quit', () => poller?.stop())
  app.whenReady().then(start).catch(() => {
    dialog.showErrorBox('E-Shop Tray', 'Unable to start the Production Relay safely.')
    app.quit()
  })
}
