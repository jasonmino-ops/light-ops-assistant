import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { app, dialog, Menu, nativeImage, Tray } from 'electron'
import { createLocalApi, ESHOP_TRAY_PORT } from './localApi'
import { showFieldBindingWindow } from './cloud/bindingWindow'
import { CloudRelayClient, CloudRelayError } from './cloud/cloudClient'
import { FieldCredentialStore } from './cloud/credentialStore'
import { CloudRelayStateStore } from './cloud/stateStore'
import { CloudRelayWorker } from './cloud/worker'
import type { WorkerPublicStatus } from './cloud/types'
import { createTrayTestPrintCommand } from './printing/testPrint'
import { PrintDeliveryError, WindowsQueueTransport } from './printing/windowsQueueTransport'

const FIELD_CLOUD_BASE_URL = 'https://elifekh.com'

let tray: Tray | null = null
let worker: CloudRelayWorker | null = null
let quitting = false
let rebuildMenu: (() => void) | null = null
let relayStatus: WorkerPublicStatus = { connection: 'disconnected', lastJob: null, lastResult: null }

function resourcePath(filename: string): string {
  if (app.isPackaged) return path.join(process.resourcesPath, filename)
  return filename === 'icon.png' ? path.resolve(__dirname, '..', '..', 'public', 'icon-512.png') : path.resolve(__dirname, '..', 'assets', filename)
}

function localAddresses(): string[] {
  const addresses = new Set<string>()
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) if (entry.family === 'IPv4' && !entry.internal) addresses.add(entry.address)
  }
  return [...addresses].sort()
}

function testPrintMessage(error?: unknown): { title: string; message: string; type: 'info' | 'error' } {
  if (!error) return { title: 'E-Shop Tray', message: 'Test print submitted to “前台”.', type: 'info' }
  const code = error instanceof PrintDeliveryError ? error.code : 'PRINT_DELIVERY_FAILED'
  return code === 'TRAY_BUSY'
    ? { title: 'E-Shop Tray', message: 'Printing is busy. Try again after the current print finishes.', type: 'error' }
    : { title: 'E-Shop Tray', message: 'Test print failed. Confirm the Windows queue “前台” is online.', type: 'error' }
}

async function start(): Promise<void> {
  const transport = new WindowsQueueTransport({ scriptPath: resourcePath('Write-RawPrint.ps1') })
  const server = createLocalApi({ version: app.getVersion(), transport })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(ESHOP_TRAY_PORT, '0.0.0.0', () => resolve())
  })

  const cloudClient = new CloudRelayClient({ baseUrl: FIELD_CLOUD_BASE_URL })
  const credentialStore = new FieldCredentialStore(app.getPath('userData'))
  const stateStore = new CloudRelayStateStore(app.getPath('userData'))

  const startWorker = async (token: string) => {
    worker?.stop()
    worker = new CloudRelayWorker({
      token,
      client: cloudClient,
      stateStore,
      transport,
      onStatus(status) { relayStatus = status; rebuildMenu?.() },
    })
    await worker.start()
  }

  const icon = nativeImage.createFromPath(resourcePath('icon.png')).resize({ width: 20, height: 20 })
  tray = new Tray(icon)
  tray.setToolTip(`E-Shop Tray V${app.getVersion()} — FIELD Cloud Relay`)

  rebuildMenu = () => {
    const address = localAddresses()[0]
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: `Cloud Relay · ${relayStatus.connection === 'connected' ? 'Connected' : 'Disconnected'}`, enabled: false },
      {
        label: 'Connect FIELD Store',
        click: () => showFieldBindingWindow(async (pin) => {
          try {
            const installationId = await credentialStore.installationId()
            const activated = await cloudClient.activate(pin, installationId)
            await credentialStore.writeToken(activated.token, activated.device)
            await startWorker(activated.token)
            await dialog.showMessageBox({ title: 'E-Shop Tray', message: 'Cloud Relay connected to ST169E7000.', type: 'info' })
            return { ok: true }
          } catch (error) {
            const code = error instanceof CloudRelayError ? error.code : 'FIELD_BINDING_FAILED'
            return { ok: false, message: `Connection failed (${code}). Generate a new code and try again.` }
          }
        }),
      },
      { label: `Last Job · ${relayStatus.lastJob ?? 'None'}`, enabled: false },
      { label: `Last Result · ${relayStatus.lastResult ?? 'None'}`, enabled: false },
      { type: 'separator' },
      { label: `Local API · ${address ? `${address}:${ESHOP_TRAY_PORT}` : `Port ${ESHOP_TRAY_PORT}`}`, enabled: false },
      {
        label: 'Test Print',
        click: async () => {
          let failure: unknown
          try { await transport.deliver(createTrayTestPrintCommand(), 'E-Shop Tray Test Print') } catch (error) { failure = error }
          await dialog.showMessageBox(testPrintMessage(failure))
        },
      },
      { type: 'separator' },
      { label: `Version ${app.getVersion()} FIELD-CLOUD-RELAY`, enabled: false },
      { label: 'Exit', click: () => { quitting = true; worker?.stop(); server.close(() => app.quit()) } },
    ]))
  }
  rebuildMenu()
  tray.on('click', () => rebuildMenu?.())

  const savedToken = await credentialStore.readToken()
  if (savedToken) await startWorker(savedToken)

  if (app.isPackaged && process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: true, path: app.getPath('exe') })
  app.on('before-quit', () => { quitting = true; worker?.stop(); server.close() })
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
else {
  app.on('second-instance', () => tray?.displayBalloon?.({ title: 'E-Shop Tray', content: 'E-Shop Tray is already online.' }))
  app.on('window-all-closed', () => { /* keep tray resident */ })
  app.whenReady().then(start).catch((error: unknown) => {
    dialog.showErrorBox('E-Shop Tray', `Unable to start E-Shop Tray: ${String(error)}`)
    app.quit()
  })
}
