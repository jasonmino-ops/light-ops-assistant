import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { app, dialog, Menu, nativeImage, Tray } from 'electron'
import { createLocalApi, ESHOP_TRAY_PORT } from './localApi'
import { createTrayTestPrintCommand } from './printing/testPrint'
import { PrintDeliveryError, WindowsQueueTransport } from './printing/windowsQueueTransport'

let tray: Tray | null = null
let quitting = false

function resourcePath(filename: string): string {
  if (app.isPackaged) return path.join(process.resourcesPath, filename)
  return filename === 'icon.png'
    ? path.resolve(__dirname, '..', '..', 'public', 'icon-512.png')
    : path.resolve(__dirname, '..', 'assets', filename)
}

function localAddresses(): string[] {
  const addresses = new Set<string>()
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.add(entry.address)
    }
  }
  return [...addresses].sort()
}

function testPrintMessage(error?: unknown): { title: string; message: string; type: 'info' | 'error' } {
  if (!error) return { title: 'E-Shop Tray', message: 'Test print submitted to “前台”.', type: 'info' }
  const code = error instanceof PrintDeliveryError ? error.code : 'PRINT_DELIVERY_FAILED'
  if (code === 'TRAY_BUSY') {
    return { title: 'E-Shop Tray', message: 'Printing is busy. Try again after the current print finishes.', type: 'error' }
  }
  return {
    title: 'E-Shop Tray',
    message: 'Test print failed. Confirm the Windows queue “前台” is online.',
    type: 'error',
  }
}

async function start(): Promise<void> {
  const transport = new WindowsQueueTransport({
    scriptPath: resourcePath('Write-RawPrint.ps1'),
  })
  const server = createLocalApi({
    version: app.getVersion(),
    transport,
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(ESHOP_TRAY_PORT, '0.0.0.0', () => resolve())
  })

  const icon = nativeImage.createFromPath(resourcePath('icon.png')).resize({ width: 20, height: 20 })
  tray = new Tray(icon)
  tray.setToolTip(`E-Shop Tray V${app.getVersion()} — Online`)

  const rebuildMenu = () => {
    const addresses = localAddresses()
    const endpoint = addresses.length > 0
      ? `http://${addresses[0]}:${ESHOP_TRAY_PORT}`
      : `Port ${ESHOP_TRAY_PORT}`
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: `Online · ${endpoint}`, enabled: false },
      {
        label: 'Test Print',
        click: async () => {
          let failure: unknown
          try {
            await transport.deliver(createTrayTestPrintCommand(), 'E-Shop Tray Test Print')
          } catch (error) {
            failure = error
          }
          await dialog.showMessageBox(testPrintMessage(failure))
        },
      },
      { type: 'separator' },
      { label: `Version ${app.getVersion()}`, enabled: false },
      {
        label: 'Exit',
        click: () => {
          quitting = true
          server.close(() => app.quit())
        },
      },
    ]))
  }
  rebuildMenu()
  tray.on('click', rebuildMenu)

  if (app.isPackaged && process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: true, path: app.getPath('exe') })
  }

  app.on('before-quit', () => {
    quitting = true
    server.close()
  })
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    tray?.displayBalloon?.({ title: 'E-Shop Tray', content: 'E-Shop Tray is already online.' })
  })
  app.on('window-all-closed', () => {
    // Registering the listener keeps this tray-only app resident on Windows.
  })
  app.whenReady().then(start).catch((error: unknown) => {
    dialog.showErrorBox('E-Shop Tray', `Unable to start local printing: ${String(error)}`)
    app.quit()
  })
}
