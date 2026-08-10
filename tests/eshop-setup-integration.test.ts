import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EShopSetupOrchestrator,
  JsonLinesSetupLogger,
  KITCHEN_DISCOVERY_DEFERRED,
  SETUP_STAGE_ORDER,
  createIntegratedSetupAdapters,
  type CertificateInspection,
  type DesktopInspection,
  type DriverInspection,
  type FrontUsbPrinterInspection,
  type HardwareProvisioningPhase3System,
  type KitchenNetworkPrinterInspection,
  type PreflightInspection,
  type ProvisionAction,
  type QueueProvisioningInput,
  type QueueProvisioningInspection,
  type QueueProvisioningSystem,
  type QzInspection,
  type SetupCheckpoint,
  type SetupCheckpointStore,
  type SetupLogger,
  type SetupStageAdapter,
  type SetupStageLogEntry,
  type SoftwareProvisioningSystem,
  type VerifiedDriverFamilyId,
} from '../tools/e-shop-setup/src'

const FRONT_CANDIDATE = 'front-usb-1111111111111111'
const OTHER_FRONT_CANDIDATE = 'front-usb-2222222222222222'
const KITCHEN_ENDPOINT = '10.80.0.44:9100'
const OTHER_KITCHEN_ENDPOINT = '10.80.0.45:9100'

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
  readonly entries: SetupStageLogEntry[] = []

  async write(entry: SetupStageLogEntry): Promise<void> {
    this.entries.push(structuredClone(entry))
  }
}

class FakeSoftwareSystem implements SoftwareProvisioningSystem {
  desktopInstallCount = 0
  qzInstallCount = 0
  certificateProvisionCount = 0
  desktopStartCount = 0
  qzStartCount = 0

  private readonly desktop: DesktopInspection = {
    installed: true,
    version: '0.4.7',
    expectedVersion: '0.4.7',
    executablePresent: true,
    runtimeRunning: true,
  }

  private readonly qz: QzInspection = {
    installed: true,
    version: '2.2.6',
    expectedVersion: '2.2.6',
    running: true,
    port8181Ready: true,
    port8182Ready: true,
  }

  private readonly certificate: CertificateInspection = {
    ready: true,
    managerStatus: 'OK',
    packageValid: true,
    fingerprintMatch: true,
    overrideConfigured: true,
    qzAccepted: true,
    publicFingerprint: 'public-test-fingerprint',
  }

  async inspectPreflight(): Promise<PreflightInspection> {
    return {
      platform: 'win32',
      architecture: 'x64',
      environmentDetectionSource: 'WINDOWS_ENVIRONMENT',
      administrator: true,
      cloudReachable: true,
      printSpoolerRunning: true,
      freeDiskBytes: 20_000_000_000,
      requiredDiskBytes: 1_000_000_000,
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
    return { changed: true, verified: true }
  }

  async ensureDesktopRunning(): Promise<boolean> {
    this.desktopStartCount += 1
    return true
  }

  async inspectQz(): Promise<QzInspection> {
    return structuredClone(this.qz)
  }

  async installQz(): Promise<ProvisionAction> {
    this.qzInstallCount += 1
    return { changed: true, verified: true }
  }

  async ensureQzRunning(): Promise<boolean> {
    this.qzStartCount += 1
    return true
  }

  async inspectCertificate(): Promise<CertificateInspection> {
    return structuredClone(this.certificate)
  }

  async provisionCertificate(): Promise<ProvisionAction> {
    this.certificateProvisionCount += 1
    return { changed: true, verified: true }
  }
}

class FakeHardwareSystem implements HardwareProvisioningPhase3System {
  driverReady = true
  frontCandidateCount = 1
  kitchenCandidateCount = 1
  driverInstallCount = 0
  frontInspectionCount = 0
  kitchenInspectionCount = 0

  async inspectDriver(): Promise<DriverInspection> {
    return {
      ready: this.driverReady,
      resolvedFamily: 'RONGTA_80MM',
      resolutionSource: 'INSTALLED_DRIVER',
      detectedName: this.driverReady ? '80Normal' : null,
      version: this.driverReady ? '8.0' : null,
      manufacturer: 'Rongta',
      detectionSource: this.driverReady ? 'WINDOWS_PRINT_MANAGEMENT' : 'NOT_FOUND',
      payloadAvailable: false,
    }
  }

  async installExternalDriver(_family: VerifiedDriverFamilyId): Promise<ProvisionAction> {
    this.driverInstallCount += 1
    return { changed: false, verified: false }
  }

  async inspectFrontUsbPrinters(): Promise<FrontUsbPrinterInspection> {
    this.frontInspectionCount += 1
    const candidates = [FRONT_CANDIDATE, OTHER_FRONT_CANDIDATE]
      .slice(0, this.frontCandidateCount)
      .map((candidateId) => ({
        candidateId,
        detectionSource: 'WINDOWS_PRINTER_PNP_METADATA' as const,
        driverFamily: 'RONGTA_80MM' as const,
      }))
    return {
      candidates,
      roleResolution: candidates.length === 1
        ? 'AUTO_RESOLVED'
        : candidates.length > 1 ? 'USER_CONFIRM_REQUIRED' : 'NOT_FOUND',
      selectedCandidateId: candidates.length === 1 ? candidates[0]!.candidateId : null,
      kitchenDiscovery: KITCHEN_DISCOVERY_DEFERRED,
    }
  }

  async inspectKitchenNetworkPrinters(): Promise<KitchenNetworkPrinterInspection> {
    this.kitchenInspectionCount += 1
    const candidates = [KITCHEN_ENDPOINT, OTHER_KITCHEN_ENDPOINT]
      .slice(0, this.kitchenCandidateCount)
      .map((endpoint) => ({
        endpoint,
        port: 9100 as const,
        detectionSources: ['WINDOWS_STANDARD_TCPIP_PORT' as const],
        raw9100Reachable: true as const,
        windowsPrinterPortAssociated: true,
      }))
    return {
      candidates,
      roleResolution: candidates.length === 1
        ? 'AUTO_RESOLVED'
        : candidates.length > 1 ? 'USER_CONFIRM_REQUIRED' : 'NOT_FOUND',
      selectedEndpoint: candidates.length === 1 ? candidates[0]!.endpoint : null,
    }
  }

  getResolvedFrontQueueTarget(candidateId: string) {
    return candidateId === FRONT_CANDIDATE
      ? {
          candidateId,
          driverFamily: 'RONGTA_80MM' as const,
          driverName: '80Normal',
          portName: 'USB-RUNTIME-DISCOVERY',
        }
      : null
  }
}

class FakeQueueSystem implements QueueProvisioningSystem {
  ready = true
  failProvision = false
  inspectCount = 0
  provisionCount = 0
  lastInput: QueueProvisioningInput | null = null

  async inspectQueues(input: QueueProvisioningInput): Promise<QueueProvisioningInspection> {
    this.inspectCount += 1
    this.lastInput = structuredClone(input)
    return {
      ready: this.ready,
      inputResolved: true,
      driverReady: true,
      driverFamily: 'RONGTA_80MM',
      portProvisionable: true,
      front: { exists: this.ready, mappingCorrect: this.ready },
      kitchen: { exists: this.ready, mappingCorrect: this.ready, portReady: this.ready },
    }
  }

  async provisionQueues(input: QueueProvisioningInput): Promise<ProvisionAction> {
    this.provisionCount += 1
    this.lastInput = structuredClone(input)
    if (this.failProvision) return { changed: false, verified: false }
    this.ready = true
    return { changed: true, verified: true }
  }
}

function fixture() {
  const software = new FakeSoftwareSystem()
  const hardware = new FakeHardwareSystem()
  const queue = new FakeQueueSystem()
  const logger = new MemoryLogger()
  const checkpoint = new MemoryCheckpointStore()
  const adapters = createIntegratedSetupAdapters(software, hardware, queue)
  const orchestrator = new EShopSetupOrchestrator(adapters, checkpoint, logger)
  return { software, hardware, queue, logger, checkpoint, adapters, orchestrator }
}

async function testCompleteChainReachesReadyForBinding(): Promise<void> {
  const setup = fixture()
  const result = await setup.orchestrator.run('NOT_BOUND')
  assert.equal(result.state, 'READY_FOR_BINDING')
  assert.equal(result.stoppedAt, null)
  assert.deepEqual(
    setup.logger.entries.filter(({ event }) => event === 'START').map(({ stage }) => stage),
    [...SETUP_STAGE_ORDER],
  )
  assert.ok(SETUP_STAGE_ORDER.every((stage) => result.stageResults[stage]?.status === 'READY'))
  assert.equal(result.stageResults['runtime-health']?.evidence.merchantBinding, 'NOT_BOUND')
}

async function testBindingTriggersHealthRecheckAndReadyForBusiness(): Promise<void> {
  const setup = fixture()
  assert.equal((await setup.orchestrator.run('NOT_BOUND')).state, 'READY_FOR_BINDING')
  const result = await setup.orchestrator.run('VALID')
  assert.equal(result.state, 'READY_FOR_BUSINESS')
  assert.equal(result.stageResults['runtime-health']?.evidence.merchantBinding, 'VALID')
  assert.match(result.stageResults['runtime-health']?.message ?? '', /recheck passed/)
  assert.equal(
    setup.logger.entries.filter(({ stage, event }) => stage === 'runtime-health' && event === 'START').length,
    2,
  )
}

async function testMissingDriverFailsClosedAndStopsDownstream(): Promise<void> {
  const setup = fixture()
  setup.hardware.driverReady = false
  const result = await setup.orchestrator.run('NOT_BOUND')
  assert.equal(result.state, 'BLOCKED')
  assert.equal(result.stoppedAt, 'driver')
  assert.equal(result.stageResults.driver?.failureCode, 'EXTERNAL_DRIVER_REQUIRED')
  assert.equal(setup.hardware.driverInstallCount, 0)
  assert.equal(setup.hardware.frontInspectionCount, 0)
  assert.equal(setup.hardware.kitchenInspectionCount, 0)
  assert.equal(setup.queue.inspectCount, 0)
}

async function testMissingFrontPrinterStopsAtDiscovery(): Promise<void> {
  const setup = fixture()
  setup.hardware.frontCandidateCount = 0
  const result = await setup.orchestrator.run('NOT_BOUND')
  assert.equal(result.stoppedAt, 'printer-discovery')
  assert.equal(result.stageResults['printer-discovery']?.failureCode, 'PRINTER_NOT_FOUND')
  assert.equal(setup.queue.inspectCount, 0)
}

async function testMissingKitchenPrinterStopsAtDiscovery(): Promise<void> {
  const setup = fixture()
  setup.hardware.kitchenCandidateCount = 0
  const result = await setup.orchestrator.run('NOT_BOUND')
  assert.equal(result.stoppedAt, 'printer-discovery')
  assert.equal(result.stageResults['printer-discovery']?.failureCode, 'PRINTER_NOT_FOUND')
  assert.equal(setup.queue.inspectCount, 0)
}

async function testMultipleCandidatesRequireOnlyRoleConfirmation(): Promise<void> {
  const setup = fixture()
  setup.hardware.frontCandidateCount = 2
  const result = await setup.orchestrator.run('NOT_BOUND')
  assert.equal(result.stoppedAt, 'printer-discovery')
  assert.equal(result.stageResults['printer-discovery']?.failureCode, 'USER_CONFIRM_REQUIRED')
  assert.match(result.stageResults['printer-discovery']?.message ?? '', /role confirmation/)
  assert.equal(setup.queue.inspectCount, 0)
}

async function testQueueFailureStopsRuntimeHealth(): Promise<void> {
  const setup = fixture()
  setup.queue.ready = false
  setup.queue.failProvision = true
  const result = await setup.orchestrator.run('NOT_BOUND')
  assert.equal(result.stoppedAt, 'queue')
  assert.equal(result.stageResults.queue?.failureCode, 'QUEUE_PROVISION_FAILED')
  assert.equal(setup.queue.provisionCount, 1)
  assert.equal(setup.logger.entries.some(({ stage }) => stage === 'runtime-health'), false)
}

async function testCorrectExistingComponentsAreReused(): Promise<void> {
  const setup = fixture()
  const result = await setup.orchestrator.run('WAITING')
  assert.equal(result.state, 'READY_FOR_BINDING')
  assert.equal(setup.software.desktopInstallCount, 0)
  assert.equal(setup.software.desktopStartCount, 0)
  assert.equal(setup.software.qzInstallCount, 0)
  assert.equal(setup.software.qzStartCount, 0)
  assert.equal(setup.software.certificateProvisionCount, 0)
  assert.equal(setup.hardware.driverInstallCount, 0)
  assert.equal(setup.queue.provisionCount, 0)
  assert.equal(setup.queue.lastInput?.kitchenEndpoint, KITCHEN_ENDPOINT)
}

async function testNoFixedMachineEndpointOrPortDependency(): Promise<void> {
  const integrationSource = await readFile(
    new URL('../tools/e-shop-setup/src/setupIntegration.ts', import.meta.url),
    'utf8',
  )
  const cliSource = await readFile(
    new URL('../tools/e-shop-setup/src/integrationCli.ts', import.meta.url),
    'utf8',
  )
  const source = `${integrationSource}\n${cliSource}`
  assert.doesNotMatch(source, /192\.168\.18\.49/)
  assert.doesNotMatch(source, /RongtaUSB PORT:/)
  assert.doesNotMatch(source, /--(?:front|kitchen)-(?:ip|port)/i)
}

async function testRuntimeHealthRejectsInvalidBinding(): Promise<void> {
  const setup = fixture()
  const result = await setup.orchestrator.run('INVALID')
  assert.equal(result.state, 'BLOCKED')
  assert.equal(result.stoppedAt, 'runtime-health')
  assert.equal(result.stageResults['runtime-health']?.failureCode, 'HEALTH_CHECK_FAILED')
}

async function testIntegratedLogsExcludeSensitiveData(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'eshop-setup-integration-log-'))
  const logPath = join(directory, 'setup.log.jsonl')
  try {
    const setup = fixture()
    const desktopIndex = setup.adapters.findIndex(({ stage }) => stage === 'desktop')
    const desktop = setup.adapters[desktopIndex]!
    const adapters: SetupStageAdapter[] = [...setup.adapters]
    adapters[desktopIndex] = {
      stage: 'desktop',
      detect: async (context) => {
        const result = await desktop.detect(context)
        return {
          ...result,
          evidence: {
            ...result.evidence,
            token: 'forbidden-token-value',
            diagnostic: 'authorization=forbidden-authorization-value safe-diagnostic',
          },
        }
      },
      execute: desktop.execute,
    }
    const result = await new EShopSetupOrchestrator(
      adapters,
      new MemoryCheckpointStore(),
      new JsonLinesSetupLogger(logPath),
    ).run('NOT_BOUND')
    assert.equal(result.state, 'READY_FOR_BINDING')
    const log = await readFile(logPath, 'utf8')
    assert.doesNotMatch(log, /forbidden-token-value|forbidden-authorization-value/)
    assert.match(log, /safe-diagnostic/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  await testCompleteChainReachesReadyForBinding()
  await testBindingTriggersHealthRecheckAndReadyForBusiness()
  await testMissingDriverFailsClosedAndStopsDownstream()
  await testMissingFrontPrinterStopsAtDiscovery()
  await testMissingKitchenPrinterStopsAtDiscovery()
  await testMultipleCandidatesRequireOnlyRoleConfirmation()
  await testQueueFailureStopsRuntimeHealth()
  await testCorrectExistingComponentsAreReused()
  await testNoFixedMachineEndpointOrPortDependency()
  await testRuntimeHealthRejectsInvalidBinding()
  await testIntegratedLogsExcludeSensitiveData()
  console.log('E-Shop V1 Setup Integration tests passed (11/11)')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
