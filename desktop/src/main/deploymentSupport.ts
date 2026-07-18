import { app, dialog, screen, shell } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { getConfig } from './config'
import { getLogPaths } from './logger'
import { getHealthSnapshot, recordDeploymentFailure } from './runtimeHealth'
import {
  classifyDeploymentFailure,
  containsSecretPattern,
  maskStoreCode,
  shortenInstallationId,
  type DeploymentSystemInfo,
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
    lastError: health.lastError ? `${health.lastError.scope}: ${health.lastError.message}` : null,
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
  const started = Date.now()
  try {
    const result = await Promise.race([
      assembleAndWriteBundle({ filePath, bundleName, systemInfo, activation: options.activation, provider: options.provider }),
      timeoutAfter(15_000),
    ])
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
    const elapsedMs = Date.now() - started
    if (elapsedMs > 15_000) {
      recordDeploymentFailure(classifyDeploymentFailure({
        component: 'DIAGNOSTICS',
        diagnosticsError: 'TIMEOUT',
        metadata: { stage: 'bundle-finally' },
      }))
    }
  }
}

async function assembleAndWriteBundle(input: {
  filePath: string
  bundleName: string
  systemInfo: DeploymentSystemInfo
  activation: ActivationDeploymentSummary | null
  provider: ProviderDeploymentSummary | null
}): Promise<DiagnosticsExportResult> {
  const health = getHealthSnapshot()
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

  const entries: DiagnosticEntry[] = [
    jsonEntry('runtime-health.json', health.deployment),
    jsonEntry('system-info.json', input.systemInfo),
    jsonEntry('display-topology.json', displayTopology),
    jsonEntry('provider-status.json', input.provider ?? health.providerRuntime),
    jsonEntry('activation-status-redacted.json', activationRedacted),
    jsonEntry('network-failures.json', networkFailures),
    textEntry('README.txt', [
      'E-Shop Desktop diagnostics bundle.',
      'This bundle is generated from allowlisted diagnostic schemas and capped recent logs.',
      'Do not add raw credentials, customer records, receipts, environment variables, or arbitrary files.',
    ].join('\n')),
  ]

  const mainLog = await recentLogEntry('recent-main-logs.txt', getLogPaths().logFile)
  if (mainLog) entries.push(mainLog)

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
  assertNoSecrets(allEntries)
  const zip = createZip(allEntries)
  if (zip.length > MAX_BUNDLE_BYTES) {
    throw new Error('DIAGNOSTICS_SIZE_LIMIT')
  }
  await writeFile(input.filePath, zip)
  return { ok: true, filePath: input.filePath, manifest }
}

function jsonEntry(name: string, value: unknown): DiagnosticEntry {
  return textEntry(name, JSON.stringify(value, null, 2))
}

function textEntry(name: string, value: string): DiagnosticEntry {
  return { name, data: Buffer.from(value, 'utf8') }
}

async function recentLogEntry(name: string, path: string | null): Promise<DiagnosticEntry | null> {
  if (!path || !existsSync(path)) return null
  const raw = await readFile(path)
  const capped = raw.length > MAX_LOG_BYTES ? raw.subarray(raw.length - MAX_LOG_BYTES) : raw
  return textEntry(name, redactText(capped.toString('utf8')))
}

function redactText(value: string): string {
  const home = app.getPath('home')
  const userData = app.getPath('userData')
  return value
    .replaceAll(home, '[home-redacted]')
    .replaceAll(userData, '[user-data-redacted]')
    .split('\n')
    .slice(-2000)
    .join('\n')
}

function assertNoSecrets(entries: DiagnosticEntry[]) {
  for (const entry of entries) {
    if (entry.name !== basename(entry.name) || entry.name.includes('..')) {
      throw new Error('DIAGNOSTICS_REDACTION_FAILED')
    }
    const text = entry.data.toString('utf8')
    if (containsSecretPattern({ name: entry.name, text })) {
      throw new Error('DIAGNOSTICS_REDACTION_FAILED')
    }
  }
}

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error('DIAGNOSTICS_TIMEOUT')), ms)
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
