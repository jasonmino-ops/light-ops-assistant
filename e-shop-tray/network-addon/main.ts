import * as electron from 'electron'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, Tray } from 'electron'
import { randomUUID, createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { CloudRelayClient } from '../src/cloudRelayClient'
import { desktopBindingIdentityPath, readDesktopBindingIdentity, type DesktopBindingIdentity } from '../src/desktopBindingIdentity'
import { protectNetworkDirectory, type NetworkNode } from '../src/networkNodeConfig'
import { getWindowsLocalNetworks, validateLocalPrinterEndpoint, discoverNetworkPrinters, readLocalPrinterHardware, assertConfirmedPrinter, networkContinuityFingerprint } from '../src/networkDiscovery'
import { NETWORK_PROFILE, parseNetworkMode, exactObject, type NetworkRequest } from '../src/networkContract'
import { NetworkRawTcpTransport, NetworkDeliveryError } from '../src/printing/networkRawTcpTransport'
import { RelayPoller } from '../src/relayPoller'
import { RelayResultLog } from '../src/resultLog'
import { createGuardedNetworkClient, createNetworkStrategy, createNetworkRenderer, submitLocalNetworkTest } from '../src/networkRuntime'
import { NetworkAddonProfile, bindingTuple, sameBinding, type ColdModePreflightContext } from './profile'
import { ColdModeLifecycle } from './coldModeLifecycle'

const SERVER = 'https://elifekh.com'
const USER_DATA = path.join(app.getPath('appData'), 'E-Shop-Network-Print-Addon')
app.setPath('userData', USER_DATA)
const PAGE = path.join(__dirname, 'ui.html')
let window: BrowserWindow | null = null
let tray: Tray | null = null
let binding: DesktopBindingIdentity | undefined
let profile: NetworkAddonProfile | undefined
let poller: RelayPoller | undefined
let lifecycle: ColdModeLifecycle | undefined
let renderer: ReturnType<typeof createNetworkRenderer> | undefined
const transport = new NetworkRawTcpTransport()
let operation: Promise<unknown> | undefined
let scanner: AbortController | undefined
let lastCode = 'STARTING'
let lastEvent: { event: string; jobId?: string; resultCode?: string; effectBoundary?: string } | undefined
let quitting = false
let exitPending: Promise<void> | undefined

function code(error: unknown) {
  const value = error instanceof Error ? ('code' in error ? String(error.code) : error.message) : ''
  return /^[A-Z0-9_:-]{3,120}$/.test(value) ? value : 'ADDON_OPERATION_FAILED'
}
async function assertIdentity() {
  const current = await readDesktopBindingIdentity(desktopBindingIdentityPath(app.getPath('appData')))
  if (!binding || !sameBinding(bindingTuple(binding), bindingTuple(current)) || binding.deviceSecret !== current.deviceSecret) {
    throw new Error('NETWORK_BINDING_CHANGED_RESTART_REQUIRED')
  }
}
async function validateEndpoint(endpoint: NetworkNode) {
  const snapshot = await getWindowsLocalNetworks()
  const confirmed = profile?.snapshot().test
  if (!confirmed || confirmed.outcome !== 'CONFIRMED' || confirmed.networkFingerprint !== networkContinuityFingerprint(snapshot)) {
    throw new Error('NETWORK_CHANGED')
  }
  return assertConfirmedPrinter(endpoint, confirmed, snapshot)
}
function knownProfile() {
  if (!profile || !binding) throw new Error('DESKTOP_BINDING_NOT_ACTIVE')
  return profile
}
function knownLifecycle() {
  if (!lifecycle) throw new Error('ADDON_RESTART_REQUIRED')
  return lifecycle
}
async function validateColdContext(context: ColdModePreflightContext) {
  if (!binding || !sameBinding(bindingTuple(binding), context.identity)) throw new Error('NETWORK_BINDING_CHANGED_RESTART_REQUIRED')
  if (context.test.outcome !== 'CONFIRMED'
    || context.config.endpoint.host !== context.test.endpoint.host || context.config.endpoint.port !== context.test.endpoint.port) {
    throw new Error('ADDON_COLD_SETTLED_TEST_REQUIRED')
  }
  await assertConfirmedPrinter(context.config.endpoint, context.test, await getWindowsLocalNetworks())
}
async function finishExit() {
  renderer?.dispose()
  quitting = true
  app.quit()
}

async function initialize() {
  if (profile) throw new Error('ADDON_RESTART_REQUIRED')
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('ADDON_WINDOWS_X64_REQUIRED')
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || process.env.NODE_EXTRA_CA_CERTS) throw new Error('ADDON_CUSTOM_TLS_NOT_ALLOWED')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('ADDON_WINDOWS_ENCRYPTION_REQUIRED')
  binding = await readDesktopBindingIdentity(desktopBindingIdentityPath(app.getPath('appData')))
  const directory = path.join(USER_DATA, 'state')
  await protectNetworkDirectory(directory)
  const protector = { protect: (value: string) => safeStorage.encryptString(value).toString('base64'),
    unprotect: (value: string) => safeStorage.decryptString(Buffer.from(value, 'base64')) }
  const next = new NetworkAddonProfile({ directory, identity: bindingTuple(binding), protector })
  await next.open()
  profile = next
  renderer = createNetworkRenderer({ electron, distDirectory: __dirname })
  const resultLog = new RelayResultLog(path.join(directory, 'results.jsonl'))
  const recorder = { async record(event: Parameters<RelayResultLog['record']>[0]) {
    lastEvent = { event: event.event, jobId: event.jobId, resultCode: event.resultCode, effectBoundary: event.effectBoundary }
    await resultLog.record(event)
  } }
  const client = new CloudRelayClient({ config: { baseUrl: SERVER },
    credential: { installationId: binding.installationId, deviceSecret: binding.deviceSecret },
    network: { bindingId: binding.computerId, storeCode: binding.storeCode } })
  // Only this commercial entry opts in. The server must reject late tasks for
  // an old mode before recovering or claiming them; existing clients are intact.
  const modeClient = {
    receive: () => client.receive(parseNetworkMode(knownProfile().snapshot().mode)),
    markExecuting: client.markExecuting.bind(client), reportResult: client.reportResult.bind(client),
  }
  const dependencies = { assertIdentity, identity: bindingTuple(binding), nodes: profile, journal: profile.journal,
    client: modeClient, render: renderer.render, recorder, transport, validateEndpoint }
  poller = new RelayPoller({ client: createGuardedNetworkClient(dependencies), journal: profile.journal, recorder,
    network: createNetworkStrategy(dependencies), onError(error) { lastCode = code(error) } })
  lifecycle = new ColdModeLifecycle({ profile, client, assertIdentity, validate: validateColdContext,
    stopAndWait: () => poller!.stopAndWait(), start: () => poller!.start(), exit: finishExit })
  try {
    await lifecycle.resumeAtStartup()
    lastCode = profile.snapshot().enabled ? 'RUNNING' : profile.snapshot().coldEnableCheckRequired
      ? 'ADDON_COLD_EXPLICIT_ENABLE_REQUIRED' : 'SETUP_OR_PAUSED'
  } catch (error) { lastCode = code(error) }
}

async function status() {
  let state: ReturnType<NetworkAddonProfile['snapshot']> | undefined
  let endpoint: NetworkNode | undefined
  try { state = profile?.snapshot(); if (state?.revision) endpoint = (await profile!.readForRecovery()).endpoint }
  catch (error) {
    // Keep the reason a cold conversion was refused visible after the profile
    // closes this process, rather than replacing it with a generic restart code.
    const failure = code(error)
    if (failure !== 'ADDON_PROFILE_RESTART_REQUIRED'
      || ['STARTING', 'RUNNING', 'SETUP_OR_PAUSED', 'CONFIGURED_PAUSED', 'PAUSED'].includes(lastCode)) lastCode = failure
  }
  return { version: app.getVersion(), server: SERVER, storeCode: binding?.storeCode ?? null,
    ready: !!profile && !!lifecycle && !!state, busy: !!operation, code: lastCode, mode: state?.mode ?? null,
    enabled: state?.enabled ?? false, endpoint: endpoint ?? null, revision: state?.revision ?? 0,
    test: state?.test ?? null, lastEvent: lastEvent ?? null,
    restartRequired: lifecycle?.restartRequired ?? profile?.restartRequired ?? false,
    coldEnableCheckRequired: state?.coldEnableCheckRequired ?? false,
    coldProcess: lifecycle?.coldProcess ?? false,
    autostart: app.getLoginItemSettings({ path: process.execPath }).openAtLogin }
}

async function pause() {
  await knownLifecycle().pause()
  lastCode = 'PAUSED'
}

async function sendTest(input: Record<string, unknown>) {
  exactObject(input, ['mode', 'host', 'port'])
  const target = knownProfile()
  await pause()
  await assertIdentity()
  const mode = parseNetworkMode(input.mode)
  const snapshot = await getWindowsLocalNetworks()
  const selected = validateLocalPrinterEndpoint(input.host, input.port, snapshot)
  const hardwareAddress = await readLocalPrinterHardware(selected.host, selected.port, snapshot)
  const id = randomUUID()
  const request: NetworkRequest = { profile: NETWORK_PROFILE, requestId: `TEST-${id}`, mode, role: 'FRONT', rendererVersion: 1,
    order: { storeCode: binding!.storeCode, storeName: 'TEST 测试票 / NOT A SALE', orderNo: `TEST-${id}`,
      createdAt: new Date().toISOString(), cashierName: '用户主动测试 / User requested TEST', paymentMethod: 'CASH',
      currencyCode: 'USD', totalAmount: 0, lang: 'zh', items: [{ name: 'TEST 请确认打印目标 · 非营业订单',
        spec: '中文、走纸、切刀 / Chinese, feed, cut', qty: 1, price: 0, lineAmount: 0 }] } }
  const bytes = await renderer!.render(request)
  const endpoint = { host: selected.host, port: selected.port }
  await target.beginTest({ id, mode, endpoint, networkFingerprint: networkContinuityFingerprint(snapshot),
    hardwareAddress,
    bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') })
  // All critical checks occur again after durable intent, before any bytes.
  let localAddress: string | undefined
  await submitLocalNetworkTest({
    verify: async () => {
      await assertIdentity()
      const current = await getWindowsLocalNetworks()
      const verified = await assertConfirmedPrinter(endpoint, { networkFingerprint: networkContinuityFingerprint(snapshot), hardwareAddress }, current)
      localAddress = verified.localAddress
    },
    deliver: () => transport.deliver(bytes, endpoint, localAddress),
    finish: outcome => target.finishTest(id, outcome),
  })
  lastCode = 'TEST_AWAITING_PHYSICAL_CONFIRMATION'
  return { testId: id, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), physicalCompletionKnown: false }
}

async function openCashier() {
  const target = knownProfile()
  const config = await target.read()
  await assertIdentity()
  await validateEndpoint(config.endpoint)
  const candidates = [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]
    .filter((value): value is string => !!value).map(base => path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  let chrome: string | undefined
  for (const candidate of candidates) {
    try { const info = await lstat(candidate); if (info.isFile() && !info.isSymbolicLink()) { chrome = candidate; break } } catch { /* Next fixed Chrome location. */ }
  }
  if (!chrome) throw new Error('ADDON_CHROME_REQUIRED')
  // Reuse the existing one-time browser launch. No agentVersion is sent, so
  // the Desktop binding's version metadata is not overwritten by this Add-on.
  const response = await fetch(`${SERVER}/api/computer-client/bindings/self/launch-ticket`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'x-installation-id': binding!.installationId,
      Authorization: `Bearer ${binding!.deviceSecret}` }, body: '{}' })
  const body = await response.text()
  if (!response.ok || body.length > 16384) throw new Error('ADDON_BROWSER_AUTH_FAILED')
  const parsed: unknown = JSON.parse(body)
  const ticket = parsed && typeof parsed === 'object' && 'ticket' in parsed ? parsed.ticket : null
  if (typeof ticket !== 'string' || !/^ecl_v1_[A-Za-z0-9_-]{32,128}$/.test(ticket)) throw new Error('ADDON_BROWSER_AUTH_FAILED')
  const url = new URL('/cashier/launch', SERVER)
  url.hash = new URLSearchParams({ ticket, networkPrint: 'v01', networkMode: config.mode }).toString()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(chrome!, [url.toString()], { shell: false, detached: true, stdio: 'ignore', windowsHide: false })
    child.once('error', () => reject(new Error('ADDON_CHROME_START_FAILED')))
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

async function perform(action: unknown, value: unknown) {
  if (action === 'status') return status()
  if (action !== 'exit' && (lifecycle?.restartRequired || profile?.restartRequired)) throw new Error('ADDON_PROFILE_RESTART_REQUIRED')
  if (['discover', 'test', 'confirmTest'].includes(String(action)) && profile?.snapshot().coldEnableCheckRequired) {
    throw new Error('ADDON_COLD_EXPLICIT_ENABLE_REQUIRED')
  }
  if (action === 'cancelDiscovery') { scanner?.abort(); return null }
  if (operation) throw new Error('ADDON_BUSY')
  const input = value ?? {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('ADDON_INVALID_INPUT')
  operation = (async () => {
    switch (action) {
      case 'retryBinding': exactObject(input, []); await initialize(); break
      case 'pause': exactObject(input, []); await pause(); break
      case 'pauseAndExit': exactObject(input, []); await knownLifecycle().pauseAndExit(); break
      case 'exit': exactObject(input, []); scanner?.abort(); if (lifecycle) await lifecycle.safeExit(); else await finishExit(); break
      case 'convertMode': {
        const data = exactObject(input, ['mode', 'cashierTabsClosed', 'singleAgentConfirmed'])
        await knownLifecycle().convertAndExit(parseNetworkMode(data.mode), {
          cashierTabsClosed: data.cashierTabsClosed === true, singleAgentConfirmed: data.singleAgentConfirmed === true })
        break
      }
      case 'discover': {
        exactObject(input, [])
        if (knownProfile().snapshot().enabled) throw new Error('ADDON_PAUSE_REQUIRED')
        await assertIdentity()
        scanner = new AbortController()
        try { return await discoverNetworkPrinters(await getWindowsLocalNetworks(), { signal: scanner.signal }) }
        finally { scanner = undefined }
      }
      case 'test': return sendTest(input as Record<string, unknown>)
      case 'confirmTest': {
        const data = exactObject(input, ['id', 'paperConfirmed', 'sameOriginalPrinter'])
        const test = knownProfile().snapshot().test
        if (!test || data.id !== test.id) throw new Error('ADDON_TEST_STATE_CONFLICT')
        await assertIdentity()
        const current = await getWindowsLocalNetworks()
        if (networkContinuityFingerprint(current) !== test.networkFingerprint) throw new Error('NETWORK_CHANGED')
        await assertConfirmedPrinter(test.endpoint, test, current)
        await profile!.confirmTest(String(data.id), data.paperConfirmed === true, data.sameOriginalPrinter === true)
        lastCode = 'CONFIGURED_PAUSED'; break
      }
      case 'enable': {
        const data = exactObject(input, ['singleAgentConfirmed', 'cashierTabsClosed'])
        await knownLifecycle().enable({ singleAgentConfirmed: data.singleAgentConfirmed === true,
          cashierTabsClosed: data.cashierTabsClosed === true })
        app.setLoginItemSettings({ name: 'EShopNetworkPrintAddon', openAtLogin: true, path: process.execPath })
        lastCode = 'RUNNING'; break
      }
      case 'autostart': {
        const data = exactObject(input, ['enabled'])
        if (typeof data.enabled !== 'boolean') throw new Error('ADDON_INVALID_INPUT')
        app.setLoginItemSettings({ name: 'EShopNetworkPrintAddon', openAtLogin: data.enabled, path: process.execPath })
        break
      }
      case 'cashier': exactObject(input, []); await openCashier(); break
      default: throw new Error('ADDON_ACTION_REJECTED')
    }
    return null
  })()
  try { return await operation } finally { operation = undefined }
}

function showWindow() {
  if (window && !window.isDestroyed()) { window.show(); window.focus(); return }
  window = new BrowserWindow({ width: 840, height: 850, minWidth: 720, minHeight: 600, title: 'E-Shop Network Print',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'), partition: 'network-addon-ui' } })
  const web = window.webContents
  web.setWindowOpenHandler(() => ({ action: 'deny' }))
  web.on('will-navigate', event => event.preventDefault())
  web.on('will-attach-webview', event => event.preventDefault())
  web.session.setPermissionRequestHandler((_web, _permission, callback) => callback(false))
  web.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true }))
  window.on('close', event => { if (!quitting) { event.preventDefault(); window!.hide() } })
  void window.loadFile(PAGE)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', showWindow)
  app.on('window-all-closed', () => { /* Remain resident, existing Tray pattern. */ })
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault(); scanner?.abort()
    if (!exitPending) exitPending = (async () => {
      try { await operation } catch { /* The operation reports its own state. */ }
      if (quitting) return
      if (lifecycle) await lifecycle.safeExit()
      else { await poller?.stopAndWait(); await finishExit() }
    })().catch(error => { lastCode = code(error); showWindow() }).finally(() => { exitPending = undefined })
  })
  app.whenReady().then(async () => {
    ipcMain.handle('network-addon:action', async (event, action: unknown, value: unknown) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
        || event.senderFrame.url !== pathToFileURL(PAGE).toString()) return { ok: false, code: 'ADDON_IPC_REJECTED' }
      try { return { ok: true, value: await perform(action, value) } }
      catch (error) { lastCode = code(error); return { ok: false, code: lastCode } }
    })
    try { await initialize() } catch (error) { lastCode = code(error) }
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 20, height: 20 })
    tray = new Tray(icon)
    tray.setToolTip('E-Shop Network Print')
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Network 设置 / 状态', click: showWindow },
      { label: '安全退出（等待当前任务结束）', click: () => app.quit() }]))
    tray.on('double-click', showWindow)
    showWindow()
  }).catch(() => { lastCode = 'ADDON_START_FAILED'; app.quit() })
}
