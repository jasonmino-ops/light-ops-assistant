import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EShopSetupOrchestrator,
  HARDWARE_PROVISIONING_DEFERRED,
  JsonLinesSetupLogger,
  SOFTWARE_PROVISIONING_READY,
  createSoftwareProvisioningAdapters,
  detectWindowsEnvironment,
  parseWindowsUninstallExecutablePath,
  type CertificateInspection,
  type DesktopInspection,
  type PreflightInspection,
  type ProvisionAction,
  type QzInspection,
  type SetupCheckpoint,
  type SetupCheckpointStore,
  type SetupLogger,
  type SetupStage,
  type SetupStageAdapter,
  type SetupStageContext,
  type SetupStageLogEntry,
  type SoftwareProvisioningSystem,
} from '../tools/e-shop-setup/src'

const context: SetupStageContext = {
  runId: 'phase-2-test-run',
  bindingStatus: 'NOT_BOUND',
  previousResult: null,
}

class MemoryCheckpointStore implements SetupCheckpointStore {
  value: SetupCheckpoint | null = null

  async load(): Promise<SetupCheckpoint | null> {
    return this.value ? structuredClone(this.value) : null
  }

  async save(checkpoint: SetupCheckpoint): Promise<void> {
    this.value = structuredClone(checkpoint)
  }
}

class MemoryLogger implements SetupLogger {
  entries: SetupStageLogEntry[] = []

  async write(entry: SetupStageLogEntry): Promise<void> {
    this.entries.push(structuredClone(entry))
  }
}

function desktopState(overrides: Partial<DesktopInspection> = {}): DesktopInspection {
  return {
    installed: false,
    version: null,
    expectedVersion: '0.4.7',
    executablePresent: false,
    runtimeRunning: false,
    ...overrides,
  }
}

function qzState(overrides: Partial<QzInspection> = {}): QzInspection {
  return {
    installed: false,
    version: null,
    expectedVersion: '2.2.6',
    running: false,
    port8181Ready: false,
    port8182Ready: false,
    ...overrides,
  }
}

function certificateState(overrides: Partial<CertificateInspection> = {}): CertificateInspection {
  return {
    ready: false,
    managerStatus: 'NOT_INSTALLED',
    packageValid: true,
    fingerprintMatch: false,
    overrideConfigured: false,
    qzAccepted: false,
    publicFingerprint: 'AA:BB:CC',
    ...overrides,
  }
}

class FakeSoftwareSystem implements SoftwareProvisioningSystem {
  platform: NodeJS.Platform = 'win32'
  architecture = 'x64'
  administrator = true
  cloudReachable = true
  printSpoolerRunning = true
  freeDiskBytes = 8 * 1024 * 1024 * 1024
  requiredDiskBytes = 2 * 1024 * 1024 * 1024
  desktop = desktopState()
  qz = qzState()
  certificate = certificateState()
  desktopInstallCount = 0
  desktopStartCount = 0
  qzInstallCount = 0
  qzStartCount = 0
  certificateProvisionCount = 0
  qzInspectCount = 0
  failDesktopInstall = false
  readonly machineIdentity = {
    installationId: 'installation-existing-machine',
    machineId: 'machine-existing',
  }
  readonly merchantBinding = {
    merchantNo: 'ST87CC8E11',
    status: 'ACTIVE',
  }

  async inspectPreflight(): Promise<PreflightInspection> {
    return {
      platform: this.platform,
      architecture: this.architecture,
      administrator: this.administrator,
      cloudReachable: this.cloudReachable,
      printSpoolerRunning: this.printSpoolerRunning,
      freeDiskBytes: this.freeDiskBytes,
      requiredDiskBytes: this.requiredDiskBytes,
      desktop: structuredClone(this.desktop),
      qz: structuredClone(this.qz),
      certificate: structuredClone(this.certificate),
    }
  }

  async inspectDesktop(): Promise<DesktopInspection> {
    return structuredClone(this.desktop)
  }

  async installDesktop(): Promise<ProvisionAction> {
    this.desktopInstallCount += 1
    if (this.failDesktopInstall) throw new Error('synthetic Desktop installer failure')
    this.desktop = desktopState({ installed: true, version: '0.4.7', executablePresent: true })
    return { changed: true, verified: true }
  }

  async ensureDesktopRunning(): Promise<boolean> {
    this.desktopStartCount += 1
    if (!this.desktop.executablePresent) return false
    this.desktop.runtimeRunning = true
    return true
  }

  async inspectQz(): Promise<QzInspection> {
    this.qzInspectCount += 1
    return structuredClone(this.qz)
  }

  async installQz(): Promise<ProvisionAction> {
    this.qzInstallCount += 1
    this.qz = qzState({ installed: true, version: '2.2.6' })
    return { changed: true, verified: true }
  }

  async ensureQzRunning(): Promise<boolean> {
    this.qzStartCount += 1
    if (!this.qz.installed) return false
    this.qz.running = true
    this.qz.port8181Ready = true
    this.qz.port8182Ready = true
    return true
  }

  async inspectCertificate(): Promise<CertificateInspection> {
    return structuredClone(this.certificate)
  }

  async provisionCertificate(): Promise<ProvisionAction> {
    this.certificateProvisionCount += 1
    this.certificate = certificateState({
      ready: true,
      managerStatus: 'OK',
      packageValid: true,
      fingerprintMatch: true,
      overrideConfigured: true,
      qzAccepted: true,
    })
    return { changed: true, verified: true }
  }
}

function stage(adapters: SetupStageAdapter[], name: SetupStage): SetupStageAdapter {
  const adapter = adapters.find(({ stage: adapterStage }) => adapterStage === name)
  assert.ok(adapter, `missing ${name} adapter`)
  return adapter
}

async function testPreflightPassAndBlocked(): Promise<void> {
  const system = new FakeSoftwareSystem()
  const adapter = stage(createSoftwareProvisioningAdapters(system), 'preflight')
  assert.equal((await adapter.detect(context)).status, 'READY')

  system.administrator = false
  assert.equal((await adapter.detect(context)).failureCode, 'ADMIN_REQUIRED')
  system.administrator = true
  system.cloudReachable = false
  assert.equal((await adapter.detect(context)).failureCode, 'CLOUD_OFFLINE')
  system.cloudReachable = true
  system.platform = 'darwin'
  assert.equal((await adapter.detect(context)).failureCode, 'UNSUPPORTED_WINDOWS')
}

async function testPreflightCimDeniedUsesFallback(): Promise<void> {
  let calls = 0
  const detected = await detectWindowsEnvironment({
    runtimePlatform: 'win32',
    runtimeArchitecture: 'x64',
    run: async () => {
      calls += 1
      if (calls === 1) throw new Error('HRESULT 0x80041003 WBEM_E_ACCESS_DENIED')
      return JSON.stringify({
        Platform: 'Win32NT',
        Is64BitOperatingSystem: true,
        ProcessorArchitecture: 'AMD64',
        ProcessorArchitectureW6432: null,
      })
    },
  })
  assert.deepEqual(detected, {
    platform: 'win32',
    architecture: 'x64',
    source: 'WINDOWS_ENVIRONMENT',
  })
  const system = new FakeSoftwareSystem()
  system.platform = detected.platform
  system.architecture = detected.architecture
  const result = await stage(createSoftwareProvisioningAdapters(system), 'preflight').detect(context)
  assert.equal(result.status, 'READY')
}

async function testPreflightFailsWhenEnvironmentCannotBeConfirmed(): Promise<void> {
  const detected = await detectWindowsEnvironment({
    runtimePlatform: 'win32',
    runtimeArchitecture: 'unknown',
    run: async () => { throw new Error('probe unavailable') },
  })
  assert.equal(detected.source, 'UNCONFIRMED')
  const system = new FakeSoftwareSystem()
  system.platform = detected.platform
  system.architecture = detected.architecture
  const result = await stage(createSoftwareProvisioningAdapters(system), 'preflight').detect(context)
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.failureCode, 'UNSUPPORTED_WINDOWS')
}

async function testQuotedUninstallExecutableParsing(): Promise<void> {
  assert.equal(
    parseWindowsUninstallExecutablePath('"C:\\Program Files\\E-Shop\\Uninstall E-Shop.exe" /allusers'),
    'C:\\Program Files\\E-Shop\\Uninstall E-Shop.exe',
  )
}

async function testUnquotedUninstallExecutableParsing(): Promise<void> {
  assert.equal(
    parseWindowsUninstallExecutablePath('C:\\Program Files\\E-Shop\\Uninstall E-Shop.exe /allusers'),
    'C:\\Program Files\\E-Shop\\Uninstall E-Shop.exe',
  )
}

async function testMalformedUninstallExecutableFailsSafe(): Promise<void> {
  for (const value of [
    '"C:\\Program Files\\E-Shop\\Uninstall E-Shop.exe /allusers',
    '"C:\\Program Files\\E-Shop\\Uninstall E-Shop.exe"/allusers',
    'C:\\bad|path\\uninstall.exe /allusers',
    'cmd.exe /c uninstall.exe',
    '',
    null,
  ]) {
    assert.equal(parseWindowsUninstallExecutablePath(value), null)
  }
}

async function testDesktopAlreadyInstalled(): Promise<void> {
  const system = new FakeSoftwareSystem()
  system.desktop = desktopState({ installed: true, version: '0.4.7', executablePresent: true, runtimeRunning: true })
  const adapter = stage(createSoftwareProvisioningAdapters(system), 'desktop')
  assert.equal((await adapter.detect(context)).status, 'READY')
  assert.equal((await adapter.execute(context)).status, 'READY')
  assert.equal(system.desktopInstallCount, 0)
  assert.equal(system.desktopStartCount, 1)
}

async function testDesktopInstallRequired(): Promise<void> {
  const system = new FakeSoftwareSystem()
  const adapter = stage(createSoftwareProvisioningAdapters(system), 'desktop')
  assert.equal((await adapter.detect(context)).status, 'NEEDS_ACTION')
  assert.equal((await adapter.execute(context)).status, 'READY')
  assert.equal(system.desktopInstallCount, 1)
  assert.equal(system.desktopStartCount, 1)
}

async function testQzAlreadyCorrect(): Promise<void> {
  const system = new FakeSoftwareSystem()
  system.qz = qzState({
    installed: true,
    version: '2.2.6',
    running: true,
    port8181Ready: true,
    port8182Ready: true,
  })
  const adapter = stage(createSoftwareProvisioningAdapters(system), 'qz')
  assert.equal((await adapter.detect(context)).status, 'READY')
  assert.equal((await adapter.execute(context)).status, 'READY')
  assert.equal(system.qzInstallCount, 0)
  assert.equal(system.qzStartCount, 1)
}

async function testQzInstallRequired(): Promise<void> {
  const system = new FakeSoftwareSystem()
  const adapter = stage(createSoftwareProvisioningAdapters(system), 'qz')
  assert.equal((await adapter.detect(context)).status, 'NEEDS_ACTION')
  assert.equal((await adapter.execute(context)).status, 'READY')
  assert.equal(system.qzInstallCount, 1)
  assert.equal(system.qzStartCount, 1)
}

async function testCertificateFirstInstall(): Promise<void> {
  const system = new FakeSoftwareSystem()
  const adapter = stage(createSoftwareProvisioningAdapters(system), 'certificate')
  assert.equal((await adapter.detect(context)).status, 'NEEDS_ACTION')
  const result = await adapter.execute(context)
  assert.equal(result.status, 'READY')
  assert.equal(result.evidence.softwareState, SOFTWARE_PROVISIONING_READY)
  assert.equal(system.certificateProvisionCount, 1)
}

async function testCertificateIdempotentRerun(): Promise<void> {
  const system = new FakeSoftwareSystem()
  const adapter = stage(createSoftwareProvisioningAdapters(system), 'certificate')
  assert.equal((await adapter.execute(context)).status, 'READY')
  assert.equal((await adapter.execute(context)).status, 'READY')
  assert.equal(system.certificateProvisionCount, 1)
}

async function testFailureStopsDownstream(): Promise<void> {
  const system = new FakeSoftwareSystem()
  system.failDesktopInstall = true
  const orchestrator = new EShopSetupOrchestrator(
    createSoftwareProvisioningAdapters(system),
    new MemoryCheckpointStore(),
    new MemoryLogger(),
  )
  const result = await orchestrator.run('NOT_BOUND')
  assert.equal(result.state, 'BLOCKED')
  assert.equal(result.stoppedAt, 'desktop')
  assert.equal(result.stageResults.desktop?.failureCode, 'DESKTOP_INSTALL_FAILED')
  assert.equal(system.qzInspectCount, 0)
  assert.equal(system.certificateProvisionCount, 0)

  system.failDesktopInstall = false
  const recovered = await orchestrator.run('NOT_BOUND')
  assert.equal(recovered.stoppedAt, 'driver')
  assert.ok(system.qzInspectCount > 0, 'downstream stages must continue after the external failure is fixed')
  assert.equal(system.certificateProvisionCount, 1)
}

async function testSecondRunReusesSoftwareStages(): Promise<void> {
  const system = new FakeSoftwareSystem()
  const store = new MemoryCheckpointStore()
  const orchestrator = new EShopSetupOrchestrator(
    createSoftwareProvisioningAdapters(system),
    store,
    new MemoryLogger(),
  )
  const first = await orchestrator.run('NOT_BOUND')
  assert.equal(first.state, 'BLOCKED')
  assert.equal(first.stoppedAt, 'driver')
  assert.equal(first.stageResults.certificate?.evidence.softwareState, SOFTWARE_PROVISIONING_READY)
  assert.equal(first.stageResults.driver?.evidence.implementationStatus, HARDWARE_PROVISIONING_DEFERRED)
  const counts = {
    desktop: system.desktopInstallCount,
    qz: system.qzInstallCount,
    certificate: system.certificateProvisionCount,
  }
  const identityBeforeRerun = structuredClone(system.machineIdentity)
  const bindingBeforeRerun = structuredClone(system.merchantBinding)

  const second = await orchestrator.run('NOT_BOUND')
  assert.equal(second.state, 'BLOCKED', 'Phase 2 must not emit READY_FOR_BINDING')
  assert.equal(second.stoppedAt, 'driver')
  assert.deepEqual({
    desktop: system.desktopInstallCount,
    qz: system.qzInstallCount,
    certificate: system.certificateProvisionCount,
  }, counts)
  assert.deepEqual(system.machineIdentity, identityBeforeRerun)
  assert.deepEqual(system.merchantBinding, bindingBeforeRerun)
}

async function testLogsExcludeSecrets(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'eshop-setup-phase2-log-'))
  const logPath = join(directory, 'setup.log.jsonl')
  try {
    const logger = new JsonLinesSetupLogger(logPath)
    await logger.write({
      runId: 'phase-2-safe-run',
      stage: 'certificate',
      event: 'END',
      startedAt: '2026-08-09T00:00:00.000Z',
      endedAt: '2026-08-09T00:00:01.000Z',
      result: 'BLOCKED',
      failureCode: 'CERTIFICATE_CONFIG_FAILED',
      retryable: true,
      evidenceSummary: {
        publicFingerprint: 'AA:BB:CC',
        privateKey: 'forbidden-private-material',
        credential: 'forbidden-credential',
        deviceSecret: 'forbidden-device-secret',
        message: 'token=forbidden-token safe-evidence',
      },
    })
    const text = await readFile(logPath, 'utf8')
    assert.match(text, /AA:BB:CC/)
    assert.match(text, /safe-evidence/)
    for (const value of ['forbidden-private-material', 'forbidden-credential', 'forbidden-device-secret', 'forbidden-token']) {
      assert.doesNotMatch(text, new RegExp(value))
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  await testPreflightPassAndBlocked()
  await testPreflightCimDeniedUsesFallback()
  await testPreflightFailsWhenEnvironmentCannotBeConfirmed()
  await testQuotedUninstallExecutableParsing()
  await testUnquotedUninstallExecutableParsing()
  await testMalformedUninstallExecutableFailsSafe()
  await testDesktopAlreadyInstalled()
  await testDesktopInstallRequired()
  await testQzAlreadyCorrect()
  await testQzInstallRequired()
  await testCertificateFirstInstall()
  await testCertificateIdempotentRerun()
  await testFailureStopsDownstream()
  await testSecondRunReusesSoftwareStages()
  await testLogsExcludeSecrets()
  console.log('E-Shop V1 Setup software provisioning tests passed (15/15)')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
