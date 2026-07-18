import { app, dialog, screen, shell } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { getConfig } from './config'
import { getLogPaths } from './logger'
import { getHealthSnapshot, recordDeploymentFailure } from './runtimeHealth'
import {
  classifyDeploymentFailure,
  diagnosticsContentUnsafeReason,
  maskStoreCode,
  sanitizeDiagnosticMessage,
  shortenInstallationId,
  type DeploymentSystemInfo,
  type DiagnosticsContentScanContext,
  type DiagnosticsExportResult,
  type DiagnosticsManifest,
} from '../shared/deploymentDiagnostics'

export type ActivationDeploymentSummary = {
  state: string
  storeCodeHint?: string
  installationId?: string | null
}

export type ProviderDeploymentSummary = {
  state: string
  pid: number | null
  providerId?: string
  providerInstanceId?: string
  pipeNameHash?: string
  lastError: string | null
  restartAttempts?: number
}

const MAX_BUNDLE_BYTES = 20 * 1024 * 1024
const MAX_LOG_BYTES = 256 * 1024
const DEFAULT_DIAGNOSTICS_TIMEOUT_MS = 15_000

type DiagnosticEntry = {
  name: string
  data: Buffer
}

export function buildDeploymentSystemInfo(activation: ActivationDeploymentSummary | null): DeploymentSystemInfo {
  const health = getHealthSnapshot()
  const config = getConfig()
  const deployment = health.deployment
  const platform = process.platform === 'win32'
    ? ((process as NodeJS.Process & { getSystemVersion?: () => string }).getSystemVersion?.() ?? 'Windows unknown')
    : `${process.platform} ${process.version}`
  return {
    version: app.getVersion(),
    distributionClass: 'UNSIGNED_INTERNAL',
    shortInstallationId: shortenInstallationId(activation?.installationId),
    maskedStoreCode: maskStoreCode(activation?.storeCodeHint ?? config.storeCode),
    activationState: activation?.state ?? deployment.activation.state,
    cloudState: deployment.cloud.state,
    providerState: deployment.provider.state,
    displayState: deployment.displays.state,
    logsState: deployment.logs.state,
    lastError: health.lastError,
    lastFailureCode: deployment.lastFailure?.code ?? null,
    lastSuccessfulCloudLoadAt: deployment.lastSuccessfulCloudLoadAt,
    windowsVersion: platform,
    arch: process.arch,
    locale: app.getLocale?.() ?? 'unknown',
    uptimeSeconds: health.uptimeSeconds,
    runtimeHealth: deployment,
  }
}

export async function openDeploymentLogDirectory(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { logDir } = getLogPaths()
  if (!logDir) return { ok: false, error: 'LOG_DIR_UNAVAILABLE' }
  const result = await shell.openPath(logDir)
  if (result) return { ok: false, error: 'OPEN_LOGS_FAILED' }
  return { ok: true }
}

export async function exportDiagnosticsBundle(options: {
  activation: ActivationDeploymentSummary | null
  provider: ProviderDeploymentSummary | null
  timeoutMs?: number
  delayBeforeFinalRenameMs?: number
}): Promise<DiagnosticsExportResult> {
  const systemInfo = buildDeploymentSystemInfo(options.activation)
  const stamp = formatBundleTimestamp(new Date())
  const bundleName = `eshop-desktop-diagnostics-${stamp}-${systemInfo.shortInstallationId}.zip`
  const target = await dialog.showSaveDialog({
    title: '导出 E-Shop Desktop 诊断包',
    defaultPath: join(app.getPath('documents'), bundleName),
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  })
  if (target.canceled || !target.filePath) {
    return { ok: false, error: 'DIAGNOSTICS_EXPORT_WRITE_FAILED', message: 'CANCELED' }
  }
  const filePath = target.filePath.endsWith('.zip') ? target.filePath : `${target.filePath}.zip`
  const timeoutMs = options.timeoutMs ?? DEFAULT_DIAGNOSTICS_TIMEOUT_MS
  const controller = new AbortController()
  const started = Date.now()
  let timeout: NodeJS.Timeout | null = null
  try {
    const assembly = assembleAndWriteBundle({
      filePath,
      bundleName,
      systemInfo,
      activation: options.activation,
      provider: options.provider,
      signal: controller.signal,
      delayBeforeFinalRenameMs: options.delayBeforeFinalRenameMs,
    })
    const timeoutResult = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort()
        reject(new Error('DIAGNOSTICS_TIMEOUT'))
      }, timeoutMs)
    })
    const result = await Promise.race([assembly, timeoutResult])
    return result
  } catch (error) {
    const failure = classifyDeploymentFailure({
      component: 'DIAGNOSTICS',
      diagnosticsError: error instanceof Error && error.message === 'DIAGNOSTICS_TIMEOUT' ? 'TIMEOUT' : String(error),
      metadata: { stage: 'bundle-assembly' },
    })
    recordDeploymentFailure(failure)
    return {
      ok: false,
      error: failure.code,
      message: failure.title,
    }
  } finally {
    if (timeout) clearTimeout(timeout)
    const elapsedMs = Date.now() - started
    if (elapsedMs > timeoutMs) {
      recordDeploymentFailure(classifyDeploymentFailure({
        component: 'DIAGNOSTICS',
        diagnosticsError: 'TIMEOUT',
        metadata: { stage: 'bundle-finally' },
      }))
    }
  }
}

export async function assembleAndWriteBundle(input: {
  filePath: string
  bundleName: string
  systemInfo: DeploymentSystemInfo
  activation: ActivationDeploymentSummary | null
  provider: ProviderDeploymentSummary | null
  signal?: AbortSignal
  logPath?: string | null
  delayBeforeFinalRenameMs?: number
}): Promise<DiagnosticsExportResult> {
  assertNotAborted(input.signal)
  const health = getHealthSnapshot()
  const scanContext: DiagnosticsContentScanContext = {
    fullStoreCode: input.activation?.storeCodeHint ?? getConfig().storeCode,
    fullInstallationId: input.activation?.installationId ?? null,
  }
  const displayTopology = screen.getAllDisplays().map((display) => ({
    id: display.id,
    scaleFactor: display.scaleFactor,
    bounds: display.bounds,
    workArea: display.workArea,
    rotation: display.rotation,
    internal: display.internal,
  }))
  const activationRedacted = {
    state: input.activation?.state ?? 'unknown',
    shortInstallationId: input.systemInfo.shortInstallationId,
    maskedStoreCode: input.systemInfo.maskedStoreCode,
  }
  const networkFailures = health.deployment.lastFailure?.component === 'BUSINESS_CLOUD'
    ? [{
      code: health.deployment.lastFailure.code,
      occurredAt: health.deployment.lastFailure.occurredAt,
      metadata: health.deployment.lastFailure.metadata,
    }]
    : []
  const provider = safeProviderStatus(input.provider ?? health.providerRuntime)

  const entries: DiagnosticEntry[] = [
    jsonEntry('runtime-health.json', health.deployment),
    jsonEntry('system-info.json', input.systemInfo),
    jsonEntry('display-topology.json', displayTopology),
    jsonEntry('provider-status.json', provider),
    jsonEntry('activation-status-redacted.json', activationRedacted),
    jsonEntry('network-failures.json', networkFailures),
    textEntry('README.txt', [
      'E-Shop Desktop diagnostics bundle.',
      'This bundle is generated from allowlisted diagnostic schemas and capped recent logs.',
      'This bundle must contain support-safe runtime diagnostics only.',
    ].join('\n')),
  ]

  const mainLog = await recentLogEntry('recent-main-logs.jsonl', input.logPath ?? getLogPaths().logFile, scanContext)
  if (mainLog) entries.push(mainLog)
  assertNotAborted(input.signal)

  const files = entries.map((entry) => ({
    name: entry.name,
    bytes: entry.data.length,
    sha256: sha256(entry.data),
  }))
  const manifest: DiagnosticsManifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    bundleName: input.bundleName,
    shortInstallationId: input.systemInfo.shortInstallationId,
    maskedStoreCode: input.systemInfo.maskedStoreCode,
    appVersion: input.systemInfo.version,
    distributionClass: input.systemInfo.distributionClass,
    files,
    redaction: {
      policy: 'ALLOWLIST_THEN_SECRET_SCAN',
      finalSecretScan: 'PASS',
    },
  }
  const allEntries = [jsonEntry('manifest.json', manifest), ...entries]
  assertDiagnosticsEntriesSafe(allEntries, scanContext)
  const zip = createZip(allEntries)
  assertDiagnosticsArchiveSafe(zip, scanContext)
  if (zip.length > MAX_BUNDLE_BYTES) {
    throw new Error('DIAGNOSTICS_SIZE_LIMIT')
  }
  await writeAtomicDiagnosticsFile({
    filePath: input.filePath,
    data: zip,
    signal: input.signal,
    delayBeforeFinalRenameMs: input.delayBeforeFinalRenameMs,
  })
  return { ok: true, fileName: basename(input.filePath), manifest }
}

function jsonEntry(name: string, value: unknown): DiagnosticEntry {
  return textEntry(name, JSON.stringify(value, null, 2))
}

function textEntry(name: string, value: string): DiagnosticEntry {
  return { name, data: Buffer.from(value, 'utf8') }
}

async function recentLogEntry(
  name: string,
  path: string | null,
  context: DiagnosticsContentScanContext,
): Promise<DiagnosticEntry | null> {
  if (!path || !existsSync(path)) return null
  const raw = await readFile(path)
  const capped = raw.length > MAX_LOG_BYTES ? raw.subarray(raw.length - MAX_LOG_BYTES) : raw
  const safeLog = buildSafeRecentLogText(capped.toString('utf8'), context)
  return safeLog ? textEntry(name, safeLog) : null
}

export function buildSafeRecentLogText(value: string, context: DiagnosticsContentScanContext = {}): string {
  const safeLines = value
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-2000)
    .map((line) => safeLogLine(line, context))
    .filter((line): line is SafeLog => Boolean(line))
    .map((line) => JSON.stringify(line))
  return safeLines.length > 0 ? `${safeLines.join('\n')}\n` : ''
}

export function assertDiagnosticsEntriesSafe(
  entries: DiagnosticEntry[],
  context: DiagnosticsContentScanContext = {},
) {
  for (const entry of entries) {
    if (entry.name !== basename(entry.name) || entry.name.includes('..')) {
      throw new Error('DIAGNOSTICS_REDACTION_FAILED')
    }
    const text = entry.data.toString('utf8')
    if (diagnosticsContentUnsafeReason(text, context)) {
      throw new Error('DIAGNOSTICS_REDACTION_FAILED')
    }
  }
}

function assertDiagnosticsArchiveSafe(zip: Buffer, context: DiagnosticsContentScanContext) {
  const reason = diagnosticsContentUnsafeReason(zip.toString('utf8'), context)
  if (reason) throw new Error('DIAGNOSTICS_REDACTION_FAILED')
}

type SafeLog = {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  eventCode: string
  component?: string
  message?: string
  correlationId?: string
  attempt?: number
  stateFrom?: string
  stateTo?: string
}

function safeLogLine(line: string, context: DiagnosticsContentScanContext): SafeLog | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const eventCode = safeCode(parsed.event) ?? 'UNKNOWN_EVENT'
  const level = safeLevel(parsed.level)
  const timestamp = safeTimestamp(parsed.ts)
  const data = isRecord(parsed.data) ? parsed.data : {}
  const out: SafeLog = { timestamp, level, eventCode }
  const component = safeCode(data.component) ?? deriveComponent(eventCode)
  if (component) out.component = component
  const explicitEventCode = safeCode(data.eventCode)
  if (explicitEventCode) out.eventCode = explicitEventCode
  const message = safeOptionalMessage(data.safeMessage ?? data.message ?? data.reason, context)
  if (message) out.message = message
  const correlationId = safeCode(data.correlationId)
  if (correlationId) out.correlationId = correlationId
  const attempt = safeNumber(data.attempt)
  if (attempt !== null) out.attempt = attempt
  const stateFrom = safeCode(data.stateFrom)
  if (stateFrom) out.stateFrom = stateFrom
  const stateTo = safeCode(data.stateTo)
  if (stateTo) out.stateTo = stateTo
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function safeLevel(value: unknown): SafeLog['level'] {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error' ? value : 'info'
}

function safeTimestamp(value: unknown): string {
  if (typeof value !== 'string') return 'unknown'
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : 'unknown'
}

function safeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value
    .replace(/[^a-zA-Z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
  if (!normalized) return null
  if (diagnosticsContentUnsafeReason(normalized)) return null
  return normalized
}

function deriveComponent(eventCode: string): string | undefined {
  const first = eventCode.split('.')[0]
  return first && first !== eventCode ? first : undefined
}

function safeOptionalMessage(value: unknown, context: DiagnosticsContentScanContext): string | undefined {
  if (value == null) return undefined
  const safe = sanitizeDiagnosticMessage(value, context)
  return safe === 'none' ? undefined : safe
}

function safeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function safeProviderStatus(provider: ProviderDeploymentSummary | ReturnType<typeof getHealthSnapshot>['providerRuntime']) {
  return {
    state: provider.state,
    pid: provider.pid,
    pipeNameHash: provider.pipeNameHash ?? null,
    lastError: provider.lastError ? sanitizeDiagnosticMessage(provider.lastError) : null,
    restartAttempts: provider.restartAttempts ?? 0,
  }
}

async function writeAtomicDiagnosticsFile(input: {
  filePath: string
  data: Buffer
  signal?: AbortSignal
  delayBeforeFinalRenameMs?: number
}) {
  const tempPath = join(dirname(input.filePath), `.${basename(input.filePath)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    assertNotAborted(input.signal)
    await writeFile(tempPath, input.data, { signal: input.signal })
    assertNotAborted(input.signal)
    if (input.delayBeforeFinalRenameMs) await delayWithAbort(input.delayBeforeFinalRenameMs, input.signal)
    assertNotAborted(input.signal)
    await rename(tempPath, input.filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('DIAGNOSTICS_TIMEOUT')
}

function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
  assertNotAborted(signal)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeout)
      reject(new Error('DIAGNOSTICS_TIMEOUT'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function formatBundleTimestamp(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function createZip(entries: DiagnosticEntry[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, entry.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += local.length + name.length + entry.data.length
  }
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, centralDirectory, end])
}

const CRC_TABLE = new Uint32Array(256).map((_value, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit++) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return crc >>> 0
})

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
