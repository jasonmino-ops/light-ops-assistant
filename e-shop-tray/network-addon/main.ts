import * as electron from 'electron'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, shell, Tray } from 'electron'
import { randomUUID, createHash } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { CloudRelayClient } from '../src/cloudRelayClient'
import { desktopBindingIdentityPath, managedAddonBindingIdentity, managedAddonHandoffPath,
  parseManagedAddonHandoff, readDesktopBindingIdentity, type DesktopBindingIdentity, type ManagedAddonHandoff } from '../src/desktopBindingIdentity'
import { networkRoleEndpoints, protectNetworkDirectory, type NetworkNode, type NetworkPrinterConfig } from '../src/networkNodeConfig'
import { getWindowsLocalNetworks, getWindowsEndpointContinuitySnapshot, validateLocalPrinterEndpoint,
  validateConfirmedPrinterPath, discoverNetworkPrinters, readLocalPrinterHardware, assertConfirmedPrinter,
  assertConfirmedPrinterContinuity, assertReachableConfirmedPrinter, networkContinuityFingerprint,
  withWindowsEndpointContinuitySnapshots, type NetworkContinuityDiagnostic } from '../src/networkDiscovery'
import { NETWORK_PROFILE, parseNetworkMode, exactObject, type NetworkRequest, type NetworkRole } from '../src/networkContract'
import { NetworkRawTcpTransport, NetworkDeliveryError } from '../src/printing/networkRawTcpTransport'
import { RelayPoller } from '../src/relayPoller'
import { RelayResultLog } from '../src/resultLog'

type ManagedPrintChildReader = (appDataPath: string) => Promise<{
  installationId: string
  deviceSecret: string
  bindingState: 'CLOUD_BOUND'
  computerId: string
  storeCode: string
  boundAt: string
} | null>

// Keep the RC9/RC10 source-isolated harness able to load the historical main
// program while the packaged build resolves the new child reader normally.
let readManagedPrintChildIdentity: ManagedPrintChildReader | undefined
try {
  readManagedPrintChildIdentity = require('../src/managedPrintChildIdentity').consumeManagedPrintChildIdentity as ManagedPrintChildReader
} catch { readManagedPrintChildIdentity = undefined }
import { createGuardedNetworkClient, createNetworkStrategy, createNetworkRenderer, submitLocalNetworkTest } from '../src/networkRuntime'
import { NetworkAddonProfile, bindingTuple, sameBinding, type ColdModePreflightContext } from './profile'
import { ColdModeLifecycle } from './coldModeLifecycle'
import { EntryCoordinator, entryIntent, readCashierEntry, cashierBlocker, networkLoginItem, type EntryIntent } from './entryCoordinator'
import { ShortcutLifecycle, LEGACY_SHORTCUTS, SHORTCUT_ROLES, reviewLegacyShortcuts, type LegacyShortcutId, type ShortcutResult } from './shortcutLifecycle'
import { readShortcutRegistration, desktopRegistration, networkRegistration, networkUninstaller, assertNormalShortcutDirectory, assertNormalShortcutFile } from './shortcutWindows'

const SERVER = 'https://elifekh.com'
const USER_DATA = path.join(app.getPath('appData'), 'E-Shop-Network-Print-Addon')
app.setPath('userData', USER_DATA)
const PAGE = path.join(__dirname, 'ui.html')
let window: BrowserWindow | null = null
let tray: Tray | null = null
let binding: DesktopBindingIdentity | undefined
let managedHandoff: ManagedAddonHandoff | undefined
let managedPrintChild = false
let profile: NetworkAddonProfile | undefined
let poller: RelayPoller | undefined
let lifecycle: ColdModeLifecycle | undefined
let renderer: ReturnType<typeof createNetworkRenderer> | undefined
let resultLog: RelayResultLog | undefined
const transport = new NetworkRawTcpTransport()
let scanner: AbortController | undefined
let lastCode = 'STARTING'
// Process-local only: DONE means startup activation was consumed, not RUNNING.
let activation: 'PENDING' | 'DONE' = 'PENDING'
let settingsRequest = 0
let lastEvent: { event: string; jobId?: string; resultCode?: string; effectBoundary?: string } | undefined
let quitting = false
let shortcutCode = 'SHORTCUT_NOT_CHECKED'
const recordedContinuityDiagnostics = new Set<string>()

async function shortcutManager() {
  const snapshot = await readShortcutRegistration()
  await assertNormalShortcutDirectory(snapshot.programs)
  let menu = snapshot.programs
  for (const component of ['店小二', '管理与维护']) {
    menu = path.join(menu, component)
    try { await mkdir(menu) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    await assertNormalShortcutDirectory(menu)
  }
  const directory = path.join(USER_DATA, 'shortcuts')
  // Validate the existing parent before mkdir/ACL changes, then the new leaf.
  // Installer maintenance must never follow a redirected/junction state path.
  await assertNormalShortcutDirectory(app.getPath('appData'))
  try { await mkdir(USER_DATA) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  await assertNormalShortcutDirectory(USER_DATA)
  try { await mkdir(directory) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  await assertNormalShortcutDirectory(directory)
  await protectNetworkDirectory(directory)
  await assertNormalShortcutDirectory(directory)
  return new ShortcutLifecycle({ directory, desktopDirectory: app.getPath('desktop'), startMenuDirectory: menu,
    networkExecutable: process.execPath, networkUninstaller: await networkUninstaller(snapshot, process.execPath),
    readDesktopRegistration: async () => desktopRegistration(await readShortcutRegistration()),
    readNetworkRegistration: async () => networkRegistration(await readShortcutRegistration(), process.execPath),
    assertNormalDirectory: assertNormalShortcutDirectory,
    assertNormalFile: assertNormalShortcutFile,
    shell: { readShortcutLink(file) { const link = shell.readShortcutLink(file); return { target: link.target,
      args: link.args ?? '', icon: link.icon ?? '', iconIndex: link.iconIndex ?? 0, appUserModelId: link.appUserModelId ?? '' } },
    writeShortcutLink: (file, spec) => shell.writeShortcutLink(file, 'create', spec) } })
}
async function installShortcuts(confirmLegacy?: (item: ShortcutResult) => Promise<boolean>) {
  const manager = await shortcutManager()
  const results: ShortcutResult[] = await manager.recover()
  for (const role of SHORTCUT_ROLES) {
    try { results.push(await manager.ensure(role)) }
    catch (error) { results.push({ subject: role, status: 'UNAVAILABLE', reason: code(error) }) }
  }
  results.push(...await reviewLegacyShortcuts(manager, confirmLegacy))
  // Installation readiness is the four new product entries. Legacy links are
  // warnings for explicit/manual review and never silently redirect printing.
  // In particular, the all-users Desktop 0.4.7 entry is outside automation.
  shortcutCode = shortcutsReady(results) ? 'SHORTCUT_READY' : 'SHORTCUT_NEEDS_ATTENTION'
  return results
}
function shortcutsReady(results: ShortcutResult[]) {
  return SHORTCUT_ROLES.every(role => ['CREATED', 'UNCHANGED'].includes(
    results.filter(result => result.subject === role).at(-1)?.status ?? ''))
}
function currentLoginItem() {
  return networkLoginItem(app.getLoginItemSettings({ path: process.execPath }).launchItems ?? [], process.execPath)
}

function code(error: unknown) {
  const value = error instanceof Error ? ('code' in error ? String(error.code) : error.message) : ''
  return /^[A-Z0-9_:-]{3,120}$/.test(value) ? value : 'ADDON_OPERATION_FAILED'
}
async function verifyManagedHandoff(handoff: ManagedAddonHandoff) {
  if (Date.parse(handoff.expiresAt) <= Date.now()) throw new Error('DESKTOP_ADDON_HANDOFF_EXPIRED')
  const response = await fetch(`${SERVER}/api/es-tray-02/device/config`, {
    method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: 'application/json',
      'x-pos-device-id': handoff.browserDeviceId,
      'x-pos-device-token': handoff.token,
    },
  })
  if (!response.ok) throw new Error('DESKTOP_ADDON_HANDOFF_REJECTED')
  const body: unknown = await response.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('DESKTOP_ADDON_HANDOFF_INVALID_RESPONSE')
  const row = body as Record<string, unknown>
  if (row.productionContract !== true || row.managedAddonContext !== true || row.principal !== 'DESKTOP_POS_DEVICE'
    || row.browserDeviceId !== handoff.browserDeviceId || row.storeCode !== handoff.storeCode) {
    throw new Error('DESKTOP_ADDON_HANDOFF_SCOPE_MISMATCH')
  }
}

async function consumeManagedAddonHandoff(): Promise<ManagedAddonHandoff | null> {
  const source = managedAddonHandoffPath(app.getPath('appData'))
  let encrypted: string
  try { encrypted = await readFile(source, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('DESKTOP_ADDON_HANDOFF_UNAVAILABLE')
  }
  const consumed = `${source}.consumed-${process.pid}-${Date.now()}`
  try {
    await rename(source, consumed)
  } catch { throw new Error('DESKTOP_ADDON_HANDOFF_REPLAYED') }
  try {
    const raw = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    return parseManagedAddonHandoff(raw)
  } finally {
    await unlink(consumed).catch(() => undefined)
  }
}

async function resolveBinding(): Promise<DesktopBindingIdentity> {
  const child = readManagedPrintChildIdentity
    ? await readManagedPrintChildIdentity(app.getPath('appData'))
    : null
  if (child) {
    managedPrintChild = true
    return child as DesktopBindingIdentity
  }
  // Legacy RC9/RC10 ComputerBinding remains supported for existing agents.
  // A missing managed child handoff never falls back to a fabricated identity.
  managedPrintChild = false
  return readDesktopBindingIdentity(desktopBindingIdentityPath(app.getPath('appData')))
}

async function assertIdentity() {
  if (managedPrintChild) {
    if (!binding || binding.bindingState !== 'CLOUD_BOUND') throw new Error('PRINT_CHILD_IDENTITY_UNAVAILABLE')
    return
  }
  if (binding?.source === 'desktop-device-handoff') {
    if (!managedHandoff) throw new Error('DESKTOP_ADDON_HANDOFF_UNAVAILABLE')
    await verifyManagedHandoff(managedHandoff)
    return
  }
  const current = await readDesktopBindingIdentity(desktopBindingIdentityPath(app.getPath('appData')))
  if (!binding || !sameBinding(bindingTuple(binding), bindingTuple(current)) || binding.deviceSecret !== current.deviceSecret) {
    throw new Error('NETWORK_BINDING_CHANGED_RESTART_REQUIRED')
  }
}
function confirmedTest(endpoint: NetworkNode, role: NetworkRole) {
  return knownProfile().confirmedTest(role, endpoint)
}
async function recordContinuityDiagnostic(diagnostic: NetworkContinuityDiagnostic) {
  const log = resultLog
  if (!log) return
  const key = `${diagnostic.comparison}:${diagnostic.fingerprintKind}:${diagnostic.expectedFingerprint}:${diagnostic.observedFingerprint}:${diagnostic.endpoint.host}:${diagnostic.endpoint.port}`
  if (recordedContinuityDiagnostics.has(key) || recordedContinuityDiagnostics.size >= 128) return
  try {
    await log.record({ event: diagnostic.code, status: diagnostic.comparison, diagnostic })
    recordedContinuityDiagnostics.add(key)
  } catch { /* Local diagnostics are best-effort and never authorize printing. */ }
}
async function validateEndpointPath(endpoint: NetworkNode, role: NetworkRole,
  getSnapshot: () => ReturnType<typeof getWindowsEndpointContinuitySnapshot> =
    () => getWindowsEndpointContinuitySnapshot(endpoint, recordContinuityDiagnostic)) {
  const confirmed = confirmedTest(endpoint, role)
  return validateConfirmedPrinterPath(endpoint, confirmed, await getSnapshot(), recordContinuityDiagnostic)
}
async function validateEndpoint(endpoint: NetworkNode, role: NetworkRole,
  getSnapshot: () => ReturnType<typeof getWindowsEndpointContinuitySnapshot> =
    () => getWindowsEndpointContinuitySnapshot(endpoint, recordContinuityDiagnostic)) {
  const confirmed = confirmedTest(endpoint, role)
  return assertConfirmedPrinterContinuity(endpoint, confirmed, await getSnapshot(), readLocalPrinterHardware,
    getSnapshot, recordContinuityDiagnostic)
}
async function validateConfiguredEndpointPaths(config: NetworkPrinterConfig) {
  const snapshot = await getWindowsEndpointContinuitySnapshot(config.endpoint, recordContinuityDiagnostic)
  const checked = new Set<string>()
  for (const { role, endpoint } of networkRoleEndpoints(config)) {
    const key = `${endpoint.host}:${endpoint.port}`
    if (checked.has(key)) continue
    await validateConfirmedPrinterPath(endpoint, confirmedTest(endpoint, role), snapshot, recordContinuityDiagnostic)
    checked.add(key)
  }
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
  const checked = new Set<string>()
  for (const { role, endpoint } of networkRoleEndpoints(context.config)) {
    const confirmed = role === 'KITCHEN' ? context.kitchenTest ?? context.test : context.test
    if (confirmed.outcome !== 'CONFIRMED' || endpoint.host !== confirmed.endpoint.host || endpoint.port !== confirmed.endpoint.port) {
      throw new Error('ADDON_COLD_SETTLED_TEST_REQUIRED')
    }
    const key = `${endpoint.host}:${endpoint.port}`
    if (checked.has(key)) continue
    const snapshot = await getWindowsEndpointContinuitySnapshot(endpoint, recordContinuityDiagnostic)
    await assertReachableConfirmedPrinter(endpoint, confirmed, snapshot, {
      refresh: () => getWindowsEndpointContinuitySnapshot(endpoint, recordContinuityDiagnostic),
      reporter: recordContinuityDiagnostic,
    })
    checked.add(key)
  }
}
async function finishExit() {
  entry.markExiting()
  renderer?.dispose()
  quitting = true
  app.quit()
}

async function initializeDependencies() {
  if (profile) throw new Error('ADDON_RESTART_REQUIRED')
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('ADDON_WINDOWS_X64_REQUIRED')
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || process.env.NODE_EXTRA_CA_CERTS) throw new Error('ADDON_CUSTOM_TLS_NOT_ALLOWED')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('ADDON_WINDOWS_ENCRYPTION_REQUIRED')
  binding = await resolveBinding()
  const directory = path.join(USER_DATA, 'state')
  await protectNetworkDirectory(directory)
  const protector = { protect: (value: string) => safeStorage.encryptString(value).toString('base64'),
    unprotect: (value: string) => safeStorage.decryptString(Buffer.from(value, 'base64')) }
  const next = new NetworkAddonProfile({ directory, identity: bindingTuple(binding), protector })
  await next.open()
  profile = next
  renderer = createNetworkRenderer({ electron, distDirectory: __dirname })
  resultLog = new RelayResultLog(path.join(directory, 'results.jsonl'))
  const recorder = { async record(event: Parameters<RelayResultLog['record']>[0]) {
    lastEvent = { event: event.event, jobId: event.jobId, resultCode: event.resultCode, effectBoundary: event.effectBoundary }
    await resultLog!.record(event)
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
    client: modeClient, render: renderer.render, recorder, transport, validateEndpoint,
    validateConfig: validateConfiguredEndpointPaths }
  poller = new RelayPoller({ client: createGuardedNetworkClient({ ...dependencies, validateEndpoint: validateEndpointPath }),
    journal: profile.journal, recorder,
    network: createNetworkStrategy({ ...dependencies,
      validateEndpoint: (endpoint, role) => withWindowsEndpointContinuitySnapshots(endpoint,
        getSnapshot => validateEndpoint(endpoint, role, getSnapshot), recordContinuityDiagnostic) }),
    onError(error) { lastCode = code(error) } })
  lifecycle = new ColdModeLifecycle({ profile, client, assertIdentity, validate: validateColdContext,
    stopAndWait: () => poller!.stopAndWait(), start: () => poller!.start(), exit: finishExit })
  lastCode = 'SETTINGS_ONLY_PENDING'
}

async function activateAtStartup() {
  const lifecycle = knownLifecycle(), profile = knownProfile()
  activation = 'DONE'
  try {
    await lifecycle.resumeAtStartup()
    lastCode = profile.snapshot().enabled ? 'RUNNING' : profile.snapshot().coldEnableCheckRequired
      ? 'ADDON_COLD_EXPLICIT_ENABLE_REQUIRED' : 'SETUP_OR_PAUSED'
  } catch (error) {
    if (lifecycle.beginStartupRecovery(error, {
      onStarted() {
        if (profile?.snapshot().enabled && lifecycle?.everStartedPoller) lastCode = 'RUNNING'
      },
      onBlocked(failure) { lastCode = code(failure) },
    })) {
      lastCode = 'NETWORK_PRINTER_UNREACHABLE'
    } else lastCode = code(error)
  }
}

async function status() {
  let state: ReturnType<NetworkAddonProfile['snapshot']> | undefined
  let endpoint: NetworkNode | undefined, kitchenEndpoint: NetworkNode | undefined
  try {
    state = profile?.snapshot()
    if (state?.revision) {
      const config = await profile!.readForRecovery()
      endpoint = config.endpoint
      kitchenEndpoint = config.kitchenEndpoint
    }
  }
  catch (error) {
    // Keep the reason a cold conversion was refused visible after the profile
    // closes this process, rather than replacing it with a generic restart code.
    const failure = code(error)
    if (failure !== 'ADDON_PROFILE_RESTART_REQUIRED'
      || ['STARTING', 'RUNNING', 'SETUP_OR_PAUSED', 'CONFIGURED_PAUSED', 'PAUSED'].includes(lastCode)) lastCode = failure
  }
  const restartRequired = lifecycle?.restartRequired ?? profile?.restartRequired ?? false
  let cashierAvailable = !!binding && !!profile && !!lifecycle && !!endpoint && !entry.isExiting
    && !cashierBlocker(state, restartRequired)
  if (cashierAvailable) {
    try { await assertIdentity() } catch { cashierAvailable = false }
  }
  return { version: app.getVersion(), server: SERVER, storeCode: binding?.storeCode ?? null,
    ready: !!profile && !!lifecycle && !!state, busy: entry.busy, code: lastCode, activation, settingsRequest, mode: state?.mode ?? null,
    enabled: state?.enabled ?? false, endpoint: endpoint ?? null, kitchenEndpoint: kitchenEndpoint ?? null,
    revision: state?.revision ?? 0,
    test: state?.test ?? null, kitchenTest: state?.kitchenTest ?? null, lastEvent: lastEvent ?? null,
    restartRequired, cashierAvailable, entryCode: entry.entryCode, entryPending: entry.entryPending, shortcutCode,
    coldEnableCheckRequired: state?.coldEnableCheckRequired ?? false,
    coldProcess: lifecycle?.coldProcess ?? false, endpointChangeProcess: lifecycle?.endpointChangeProcess ?? false,
    dualSetupRequired: (state?.schemaVersion === 3 || state?.schemaVersion === 4) && state.mode === 'SHARED_PRINTER',
    replacement: state?.schemaVersion === 4 && state.replacement ? {
      role: state.replacement.role, test: state.replacement.test,
    } : null,
    autostart: currentLoginItem()?.enabled ?? false }
}

async function pause() {
  await knownLifecycle().pause()
  lastCode = 'PAUSED'
}

async function addressSuggestions() {
  const fallback = { front: { host: '192.168.1.59', port: 9100 }, kitchen: { host: '192.168.1.229', port: 9100 } }
  try {
    const snapshot = await getWindowsLocalNetworks()
    const network = snapshot.networks.find(item => item.prefixLength === 24 && /^(?:10|172|192)\./.test(item.localAddress))
    if (!network) return fallback
    const prefix = network.networkAddress.split('.').slice(0, 3)
    if (prefix.length !== 3) return fallback
    return { front: { host: [...prefix, '59'].join('.'), port: 9100 }, kitchen: { host: [...prefix, '229'].join('.'), port: 9100 } }
  } catch { return fallback }
}

async function sendTest(input: Record<string, unknown>) {
  const role = input.role
  if (role !== 'FRONT' && role !== 'KITCHEN') throw new Error('ADDON_INVALID_ROLE')
  const hasPurpose = Object.hasOwn(input, 'purpose')
  const purpose = hasPurpose ? input.purpose : 'SETUP'
  if (purpose !== 'SETUP' && purpose !== 'RETEST' && purpose !== 'REPLACE') throw new Error('ADDON_INVALID_TEST_PURPOSE')
  const requiresLifecycleConfirmation = purpose === 'RETEST' || purpose === 'REPLACE'
  const keys = ['mode', 'role', 'host', 'port', ...(role === 'KITCHEN' || requiresLifecycleConfirmation
    ? ['cashierTabsClosed', 'singleAgentConfirmed'] : []), ...(hasPurpose ? ['purpose'] : [])]
  exactObject(input, keys)
  const target = knownProfile()
  await pause()
  await assertIdentity()
  const mode = parseNetworkMode(input.mode)
  if (role === 'KITCHEN') {
    if (mode !== 'SHARED_PRINTER') throw new Error('ADDON_ROLE_TEST_NOT_READY')
    const confirmation = { cashierTabsClosed: input.cashierTabsClosed === true,
      singleAgentConfirmed: input.singleAgentConfirmed === true }
    if (requiresLifecycleConfirmation) await knownLifecycle().preparePrinterReplacement(confirmation)
    else await knownLifecycle().prepareEndpointChange(confirmation)
  } else if (requiresLifecycleConfirmation) {
    await knownLifecycle().preparePrinterReplacement({ cashierTabsClosed: input.cashierTabsClosed === true,
      singleAgentConfirmed: input.singleAgentConfirmed === true })
  }
  const snapshot = await getWindowsLocalNetworks()
  const selected = validateLocalPrinterEndpoint(input.host, input.port, snapshot)
  const hardwareAddress = await readLocalPrinterHardware(selected.host, selected.port, snapshot)
  const id = randomUUID()
  const request: NetworkRequest = { profile: NETWORK_PROFILE, requestId: `TEST-${id}`, mode, role, rendererVersion: 1,
    order: { storeCode: binding!.storeCode, storeName: `TEST ${role} 测试票 / NOT A SALE`, orderNo: `TEST-${id}`,
      createdAt: new Date().toISOString(), cashierName: '用户主动测试 / User requested TEST', paymentMethod: 'CASH',
      currencyCode: 'USD', totalAmount: 0, lang: 'zh', items: [{ name: 'TEST 请确认打印目标 · 非营业订单',
        spec: '中文、走纸、切刀 / Chinese, feed, cut', qty: 1, price: 0, lineAmount: 0 }] } }
  const bytes = await renderer!.render(request)
  const endpoint = { host: selected.host, port: selected.port }
  const localTest = { id, mode, endpoint, networkFingerprint: networkContinuityFingerprint(snapshot),
    hardwareAddress, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
  if (purpose === 'REPLACE') await target.beginReplacementTest(localTest, role)
  else await target.beginTest(localTest, role, { allowExisting: purpose === 'RETEST' })
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
  return { testId: id, role, purpose, bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'), physicalCompletionKnown: false }
}

async function openCashier(config: NetworkPrinterConfig) {
  if (managedPrintChild) throw new Error('PRINT_CHILD_CAPABILITY_REJECTED')
  await assertIdentity()
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
  await assertIdentity()
  if (entry.isExiting) throw new Error('ADDON_EXIT_IN_PROGRESS')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(chrome!, [url.toString()], { shell: false, detached: true, stdio: 'ignore', windowsHide: false })
    child.once('error', () => reject(new Error('ADDON_CHROME_START_FAILED')))
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

const entry = new EntryCoordinator({ initialize: initializeDependencies, activateAtStartup, openCashier,
  showManagement(settings) { if (settings) settingsRequest++; showWindow() }, errorCode: code,
  readCashier: () => readCashierEntry({ profile: knownProfile(), restartRequired: knownLifecycle().restartRequired,
    printingReady: lastCode === 'RUNNING' && knownLifecycle().everStartedPoller, assertIdentity }),
  confirmWarning: async () => {
    const result = await dialog.showMessageBox({ type: 'warning', title: '店小二收银',
      message: '网络打印已暂停或当前未准备好。',
      detail: `当前状态：${lastCode}。继续后仍使用本店已配置的 Network 收银模式。新订单可能等待打印；不会自动启用打印、切换其他打印方式或补打原订单。点击「返回管理与维护」可查看原因与处理入口。`,
      buttons: ['返回管理与维护', '继续进入收银'], defaultId: 0, cancelId: 0, noLink: true })
    if (result.response !== 1) showWindow()
    return result.response === 1
  },
})

async function dispatchEntry(intent: EntryIntent) {
  try { await entry.dispatch(intent) } catch { /* The coordinator retains entry diagnostics and opens setup when appropriate. */ }
}

async function perform(action: unknown, value: unknown) {
  if (action === 'status') return status()
  if (action === 'shortcuts' || action === 'migrateShortcut') {
    return entry.runOperation(async () => {
      if (action === 'shortcuts') {
        exactObject(value ?? {}, [])
        const results = await installShortcuts()
        return { created: results.filter(item => !LEGACY_SHORTCUTS.includes(item.subject as LegacyShortcutId)),
          legacy: results.filter(item => LEGACY_SHORTCUTS.includes(item.subject as LegacyShortcutId)) }
      }
      const data = exactObject(value, ['id', 'sha256', 'ownershipConfirmed'])
      if (!LEGACY_SHORTCUTS.includes(data.id as LegacyShortcutId) || data.ownershipConfirmed !== true
        || typeof data.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256)) throw new Error('SHORTCUT_OWNERSHIP_CONFIRMATION_REQUIRED')
      return (await shortcutManager()).migrateLegacy(data.id as LegacyShortcutId, { sha256: data.sha256, ownershipConfirmed: true })
    }, false, true)
  }
  if (action === 'cashier') { exactObject(value ?? {}, []); await entry.launchCashier(); return null }
  if (action !== 'exit' && (lifecycle?.restartRequired || profile?.restartRequired)) throw new Error('ADDON_PROFILE_RESTART_REQUIRED')
  if (['discover', 'test', 'confirmTest'].includes(String(action)) && profile?.snapshot().coldEnableCheckRequired) {
    throw new Error('ADDON_COLD_EXPLICIT_ENABLE_REQUIRED')
  }
  if (action === 'cancelDiscovery') { scanner?.abort(); return null }
  const input = value ?? {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('ADDON_INVALID_INPUT')
  if (action === 'retryBinding') exactObject(input, [])
  if (action === 'exit' || action === 'pauseAndExit') {
    exactObject(input, [])
    return entry.exit(async () => {
      scanner?.abort()
      if (action === 'pauseAndExit') await knownLifecycle().pauseAndExit()
      else if (lifecycle) await lifecycle.safeExit()
      else await finishExit()
    })
  }
  if (action === 'enable' && activation === 'PENDING') {
    const data = exactObject(input, ['singleAgentConfirmed', 'cashierTabsClosed'])
    if (data.singleAgentConfirmed !== true) throw new Error('ADDON_SINGLE_AGENT_CONFIRMATION_REQUIRED')
    // An enabled profile has not been paused merely by opening settings. Resume
    // it through the same once-only startup entry, never disable/re-enable it.
    const alreadyEnabled = knownProfile().snapshot().enabled
    await entry.activate()
    if (alreadyEnabled) return null
  }
  const result = await entry.runOperation(async () => {
    switch (action) {
      case 'suggestions': exactObject(input, []); return addressSuggestions()
      case 'retryBinding': exactObject(input, []); break
      case 'pause': exactObject(input, []); await pause(); break
      case 'cancelReplacement': exactObject(input, []); await knownProfile().cancelReplacement(); lastCode = 'CONFIGURED_PAUSED'; break
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
        const data = exactObject(input, ['id', 'paperConfirmed', 'sameOriginalPrinter', 'cashierTabsClosed', 'singleAgentConfirmed'])
        const state = knownProfile().snapshot()
        const replacement = state.schemaVersion === 4 && state.replacement?.test.id === data.id
        const role: NetworkRole | null = replacement ? state.replacement!.role
          : data.id === state.test?.id ? 'FRONT' : data.id === state.kitchenTest?.id ? 'KITCHEN' : null
        const test = replacement ? state.replacement!.test
          : role === 'KITCHEN' ? state.kitchenTest : role === 'FRONT' ? state.test : null
        if (!test || !role) throw new Error('ADDON_TEST_STATE_CONFLICT')
        if (replacement) await knownLifecycle().preparePrinterReplacement({
          cashierTabsClosed: data.cashierTabsClosed === true, singleAgentConfirmed: data.singleAgentConfirmed === true })
        else if (role === 'KITCHEN') {
          const configured = state.revision ? await profile!.readForRecovery() : undefined
          const prepare = configured?.kitchenEndpoint ? 'replace' : 'setup'
          if (prepare === 'replace') await knownLifecycle().preparePrinterReplacement({
            cashierTabsClosed: data.cashierTabsClosed === true, singleAgentConfirmed: data.singleAgentConfirmed === true })
          else await knownLifecycle().prepareEndpointChange({
            cashierTabsClosed: data.cashierTabsClosed === true, singleAgentConfirmed: data.singleAgentConfirmed === true })
        }
        await assertIdentity()
        const current = await getWindowsLocalNetworks()
        if (networkContinuityFingerprint(current) !== test.networkFingerprint) throw new Error('NETWORK_CHANGED')
        await assertConfirmedPrinter(test.endpoint, test, current)
        if (replacement) await profile!.confirmReplacementTest(String(data.id), data.paperConfirmed === true)
        else await profile!.confirmTest(String(data.id), data.paperConfirmed === true, data.sameOriginalPrinter === true)
        lastCode = 'CONFIGURED_PAUSED'; break
      }
      case 'enable': {
        const data = exactObject(input, ['singleAgentConfirmed', 'cashierTabsClosed'])
        await knownLifecycle().enable({ singleAgentConfirmed: data.singleAgentConfirmed === true,
          cashierTabsClosed: data.cashierTabsClosed === true })
        lastCode = 'RUNNING'; break
      }
      case 'autostart': {
        const data = exactObject(input, ['enabled'])
        if (typeof data.enabled !== 'boolean') throw new Error('ADDON_INVALID_INPUT')
        app.setLoginItemSettings({ name: 'EShopNetworkPrintAddon', openAtLogin: data.enabled,
          enabled: data.enabled, path: process.execPath, args: ['--background'] })
        break
      }
      default: throw new Error('ADDON_ACTION_REJECTED')
    }
    return null
  }, action === 'retryBinding')
  if (action === 'retryBinding' && startupIntent !== 'settings') await entry.activate()
  return result
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

const helper = process.argv.filter(value => value === '--install-shortcuts' || value === '--uninstall-shortcuts')
const silentShortcutArgs = process.argv.filter(value => value === '--silent-shortcuts')
const helperMode = helper.length === 1 && !process.argv.some(value => ['--cashier', '--manage', '--background', '--settings-only'].includes(value))
  && (silentShortcutArgs.length === 0 || (helper[0] === '--install-shortcuts' && silentShortcutArgs.length === 1))
// Reject conflicting cold-start intents before dependency initialization or
// runtime activation (and before requesting the resident instance lock).
let startupIntent: EntryIntent | undefined
if (!helperMode) {
  try { startupIntent = entryIntent(process.argv) } catch { /* Fail closed below. */ }
}
if (!helperMode && !startupIntent) app.exit(8)
else if (!app.requestSingleInstanceLock()) { if (helperMode) app.exit(8); else app.quit() }
else if (helperMode) {
  // Deliberately separate from initialize(): no binding, print profile, journal,
  // polling, renderer, ticket or network discovery in installer maintenance.
  app.on('second-instance', () => { /* Installer owns this short-lived process. */ })
  app.whenReady().then(async () => {
    if (helper[0] === '--install-shortcuts') {
      await installShortcuts(silentShortcutArgs.length ? undefined : async item => {
        const name = item.subject === 'desktop' ? 'E-Shop.lnk' : item.subject === 'network-formal'
          ? 'E-Shop Network Print Add-on.lnk' : 'E-Shop Network Print Add-on (TEST ONLY).lnk'
        const result = await dialog.showMessageBox({ type: 'question', title: '店小二收银 · 整理旧桌面入口',
          message: `是否备份并收纳旧入口「${name}」？`,
          detail: `此文件的内容符合已安装产品的默认入口，但程序不能证明是谁创建的。只有你确认它由安装器创建、不是自建或修改时才能收纳。原文件会完整备份；程序、绑定与打印记录不会修改。\n当前文件 SHA-256：${item.sha256}`,
          checkboxLabel: '我确认此文件由产品安装器创建，不是用户自建或修改的入口', checkboxChecked: false,
          buttons: ['保留，稍后在管理与维护处理', '备份并收纳'], defaultId: 0, cancelId: 0, noLink: true })
        return result.response === 1 && result.checkboxChecked === true
      })
      // Upgrade only: preserve Windows' disabled/approved choice on an exact
      // existing product Run item. A missing item stays missing until opt-in.
      const login = currentLoginItem()
      if (login && !login.background) app.setLoginItemSettings({ name: 'EShopNetworkPrintAddon',
        path: process.execPath, args: ['--background'], openAtLogin: true, enabled: login.enabled })
      app.exit(shortcutCode === 'SHORTCUT_READY' ? 0 : 7)
    } else {
      await (await shortcutManager()).uninstall()
      app.exit(0)
    }
  }).catch(() => app.exit(8))
} else {
  app.on('second-instance', (_event, argv) => {
    if (argv.some(value => ['--install-shortcuts', '--uninstall-shortcuts'].includes(value))) return
    void app.whenReady().then(() => dispatchEntry(entryIntent(argv))).catch(() => showWindow())
  })
  app.on('window-all-closed', () => { /* Remain resident, existing Tray pattern. */ })
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault(); scanner?.abort()
    void entry.exit(async () => {
      if (quitting) return
      if (lifecycle) await lifecycle.safeExit()
      else { await poller?.stopAndWait(); await finishExit() }
    }).catch(error => { lastCode = code(error); showWindow() })
  })
  app.whenReady().then(async () => {
    ipcMain.handle('network-addon:action', async (event, action: unknown, value: unknown) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
        || event.senderFrame.url !== pathToFileURL(PAGE).toString()) return { ok: false, code: 'ADDON_IPC_REJECTED' }
      try { return { ok: true, value: await perform(action, value) } }
      catch (error) {
        const failure = code(error)
        if (action === 'shortcuts' || action === 'migrateShortcut') shortcutCode = failure
        else if (action !== 'cashier') lastCode = failure
        return { ok: false, code: failure }
      }
    })
    try {
      if (startupIntent === 'settings') await entry.initialize()
      else await entry.activate()
    } catch (error) { lastCode = code(error) }
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 20, height: 20 })
    tray = new Tray(icon)
    tray.setToolTip('店小二收银')
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '店小二收银', click: () => { void dispatchEntry('cashier') } },
      { label: '管理与维护', click: () => { void dispatchEntry('manage') } },
      { label: '安全退出', click: () => app.quit() }]))
    tray.on('double-click', () => { void dispatchEntry('cashier') })
    await dispatchEntry(startupIntent!)
  }).catch(() => { lastCode = 'ADDON_START_FAILED'; app.quit() })
}
