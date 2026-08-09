import assert from 'node:assert/strict'

import {
  EShopSetupOrchestrator,
  KITCHEN_DISCOVERY_DEFERRED,
  VERIFIED_DRIVER_CATALOG,
  createDriverProvisioningAdapter,
  createFrontUsbPrinterCandidates,
  createFrontUsbPrinterDetectionAdapter,
  createHardwareProvisioningPhase1Adapters,
  WindowsHardwareProvisioningSystem,
  type CertificateInspection,
  type DesktopInspection,
  type DriverInspection,
  type FrontUsbPrinterInspection,
  type HardwareProvisioningSystem,
  type PreflightInspection,
  type ProvisionAction,
  type QzInspection,
  type SetupCheckpoint,
  type SetupCheckpointStore,
  type SetupLogger,
  type SetupStageContext,
  type SetupStageLogEntry,
  type SoftwareProvisioningSystem,
  type VerifiedDriverFamilyId,
} from '../tools/e-shop-setup/src'

const context: SetupStageContext = {
  runId: 'hardware-phase-1-test',
  bindingStatus: 'NOT_BOUND',
  previousResult: null,
}

function driverState(overrides: Partial<DriverInspection> = {}): DriverInspection {
  return {
    ready: false,
    resolvedFamily: null,
    resolutionSource: 'UNRESOLVED',
    detectedName: null,
    version: null,
    manufacturer: null,
    detectionSource: 'NOT_FOUND',
    payloadAvailable: false,
    ...overrides,
  }
}

function frontState(
  candidateIds: string[] = [],
  driverFamily: VerifiedDriverFamilyId = 'RONGTA_80MM',
): FrontUsbPrinterInspection {
  return {
    candidates: candidateIds.map((candidateId) => ({
      candidateId,
      detectionSource: 'WINDOWS_PRINTER_PORT_METADATA' as const,
      driverFamily,
    })),
    roleResolution: candidateIds.length === 1
      ? 'AUTO_RESOLVED'
      : candidateIds.length > 1
        ? 'USER_CONFIRM_REQUIRED'
        : 'NOT_FOUND',
    selectedCandidateId: candidateIds.length === 1 ? candidateIds[0]! : null,
    kitchenDiscovery: KITCHEN_DISCOVERY_DEFERRED,
  }
}

class FakeHardwareSystem implements HardwareProvisioningSystem {
  driver = driverState()
  front = frontState()
  installCount = 0
  frontInspectCount = 0
  failInstall = false
  selectedInstallerFamilies: VerifiedDriverFamilyId[] = []

  async inspectDriver(): Promise<DriverInspection> {
    return structuredClone(this.driver)
  }

  async installExternalDriver(family: VerifiedDriverFamilyId): Promise<ProvisionAction> {
    this.installCount += 1
    this.selectedInstallerFamilies.push(family)
    if (this.failInstall) throw new Error('synthetic external driver installer failure')
    this.driver = driverState({
      ready: true,
      resolvedFamily: family,
      resolutionSource: 'INSTALLED_DRIVER',
      detectedName: family === 'RONGTA_80MM' ? '80Normal' : 'Xprinter XP-N160II',
      version: '8.0',
      manufacturer: family === 'RONGTA_80MM' ? 'RongTa' : 'Xprinter',
      detectionSource: 'WINDOWS_PRINT_MANAGEMENT',
      payloadAvailable: true,
    })
    return { changed: true, verified: true }
  }

  async inspectFrontUsbPrinters(): Promise<FrontUsbPrinterInspection> {
    this.frontInspectCount += 1
    return structuredClone(this.front)
  }
}

const readyDesktop: DesktopInspection = {
  installed: true,
  version: '0.4.7',
  expectedVersion: '0.4.7',
  executablePresent: true,
  runtimeRunning: true,
}

const readyQz: QzInspection = {
  installed: true,
  version: '2.2.6',
  expectedVersion: '2.2.6',
  running: true,
  port8181Ready: true,
  port8182Ready: true,
}

const readyCertificate: CertificateInspection = {
  ready: true,
  managerStatus: 'OK',
  packageValid: true,
  fingerprintMatch: true,
  overrideConfigured: true,
  qzAccepted: true,
  publicFingerprint: 'PUBLIC-FINGERPRINT',
}

class ReadySoftwareSystem implements SoftwareProvisioningSystem {
  async inspectPreflight(): Promise<PreflightInspection> {
    return {
      platform: 'win32',
      architecture: 'x64',
      administrator: true,
      cloudReachable: true,
      printSpoolerRunning: true,
      freeDiskBytes: 8 * 1024 * 1024 * 1024,
      requiredDiskBytes: 2 * 1024 * 1024 * 1024,
      desktop: readyDesktop,
      qz: readyQz,
      certificate: readyCertificate,
    }
  }

  async inspectDesktop(): Promise<DesktopInspection> { return structuredClone(readyDesktop) }
  async installDesktop(): Promise<ProvisionAction> { throw new Error('Desktop install must not run') }
  async ensureDesktopRunning(): Promise<boolean> { return true }
  async inspectQz(): Promise<QzInspection> { return structuredClone(readyQz) }
  async installQz(): Promise<ProvisionAction> { throw new Error('QZ install must not run') }
  async ensureQzRunning(): Promise<boolean> { return true }
  async inspectCertificate(): Promise<CertificateInspection> { return structuredClone(readyCertificate) }
  async provisionCertificate(): Promise<ProvisionAction> { throw new Error('Certificate provisioning must not run') }
}

class MemoryCheckpointStore implements SetupCheckpointStore {
  value: SetupCheckpoint | null = null
  async load(): Promise<SetupCheckpoint | null> { return this.value ? structuredClone(this.value) : null }
  async save(checkpoint: SetupCheckpoint): Promise<void> { this.value = structuredClone(checkpoint) }
}

class MemoryLogger implements SetupLogger {
  entries: SetupStageLogEntry[] = []
  async write(entry: SetupStageLogEntry): Promise<void> { this.entries.push(structuredClone(entry)) }
}

async function testExisting80NormalIsReady(): Promise<void> {
  const system = new FakeHardwareSystem()
  system.driver = driverState({
    ready: true,
    resolvedFamily: 'RONGTA_80MM',
    resolutionSource: 'INSTALLED_DRIVER',
    detectedName: '80Normal',
    version: '8.0',
    manufacturer: 'RongTa',
    detectionSource: 'WINDOWS_PRINT_MANAGEMENT',
  })
  const result = await createDriverProvisioningAdapter(system).detect(context)
  assert.equal(result.status, 'READY')
  assert.equal(result.failureCode, null)
  assert.equal(result.evidence.detectedDriverName, '80Normal')
  assert.equal(result.evidence.resolvedFamily, 'RONGTA_80MM')
  assert.equal(result.evidence.version, '8.0')
  assert.equal(result.evidence.detectionSource, 'WINDOWS_PRINT_MANAGEMENT')
  assert.equal(system.installCount, 0)
}

async function testVerifiedCatalogContainsOnlyTwoUnknownRedistributionFamilies(): Promise<void> {
  assert.deepEqual(
    VERIFIED_DRIVER_CATALOG.map(({ id }) => id),
    ['RONGTA_80MM', 'XPRINTER_80MM'],
  )
  assert.ok(VERIFIED_DRIVER_CATALOG.every(({ redistribution }) => redistribution === 'UNKNOWN'))
}

async function testKnownFamilyWithoutPayloadRequiresExternalInstaller(): Promise<void> {
  const system = new FakeHardwareSystem()
  system.driver = driverState({
    resolvedFamily: 'XPRINTER_80MM',
    resolutionSource: 'USB_DEVICE_METADATA',
  })
  const result = await createDriverProvisioningAdapter(system).detect(context)
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.failureCode, 'EXTERNAL_DRIVER_REQUIRED')
  assert.equal(result.evidence.resolvedFamily, 'XPRINTER_80MM')
  assert.equal(result.evidence.payloadAvailable, false)
  assert.equal(result.evidence.classification, 'EXTERNAL_INSTALLER')
  assert.equal(result.evidence.redistribution, 'UNKNOWN')
  assert.equal(system.installCount, 0)
}

async function testUnknownPrinterDoesNotInstallUnknownDriver(): Promise<void> {
  const system = new FakeHardwareSystem()
  const result = await createDriverProvisioningAdapter(system).detect(context)
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.failureCode, 'EXTERNAL_DRIVER_REQUIRED')
  assert.equal(result.evidence.resolvedFamily, null)
  assert.equal(result.evidence.resolutionSource, 'UNRESOLVED')
  assert.equal(system.installCount, 0)
  assert.deepEqual(system.selectedInstallerFamilies, [])
}

async function verifyFamilyInstallerSelection(
  family: VerifiedDriverFamilyId,
  expectedDriverName: string,
): Promise<void> {
  const system = new FakeHardwareSystem()
  system.driver = driverState({
    resolvedFamily: family,
    resolutionSource: 'USB_DEVICE_METADATA',
    payloadAvailable: true,
  })
  const adapter = createDriverProvisioningAdapter(system)
  assert.equal((await adapter.detect(context)).status, 'NEEDS_ACTION')
  const result = await adapter.execute(context)
  assert.equal(result.status, 'READY')
  assert.equal(result.evidence.detectedDriverName, expectedDriverName)
  assert.equal(result.evidence.selectedInstallerFamily, family)
  assert.equal(result.evidence.installerInvoked, true)
  assert.equal(system.installCount, 1)
  assert.deepEqual(system.selectedInstallerFamilies, [family])
}

async function testRongtaCandidateSelectsRongtaInstallerAdapter(): Promise<void> {
  await verifyFamilyInstallerSelection('RONGTA_80MM', '80Normal')
}

async function testXprinterCandidateSelectsXprinterInstallerAdapter(): Promise<void> {
  await verifyFamilyInstallerSelection('XPRINTER_80MM', 'Xprinter XP-N160II')
}

async function testWindowsDriverDetectionMapsPrintManagementEvidence(): Promise<void> {
  const scripts: string[] = []
  const system = new WindowsHardwareProvisioningSystem({}, {
    runtimePlatform: 'win32',
    runtimeArchitecture: 'x64',
    run: async (_file, args) => {
      const script = args.join(' ')
      scripts.push(script)
      return script.includes('Get-PrinterDriver')
        ? JSON.stringify([{
            Name: '80Normal',
            Version: '8.0',
            Manufacturer: 'RongTa',
            DetectionSource: 'WINDOWS_PRINT_MANAGEMENT',
          }])
        : '[]'
    },
  })
  const state = await system.inspectDriver()
  assert.equal(state.ready, true)
  assert.equal(state.resolvedFamily, 'RONGTA_80MM')
  assert.equal(state.detectedName, '80Normal')
  assert.equal(state.version, '8.0')
  assert.equal(state.detectionSource, 'WINDOWS_PRINT_MANAGEMENT')
  assert.ok(scripts.some((script) => /Get-PrinterDriver/.test(script)))
  assert.ok(scripts.some((script) => /Windows x64\\Drivers\\Version-3/.test(script)))
}

async function testSingleFrontCandidateAutoResolves(): Promise<void> {
  const system = new FakeHardwareSystem()
  system.front = frontState(['front-usb-1111111111111111'])
  const result = await createFrontUsbPrinterDetectionAdapter(system).detect(context)
  assert.equal(result.status, 'READY')
  assert.equal(result.evidence.candidateCount, 1)
  assert.deepEqual(result.evidence.driverFamilies, ['RONGTA_80MM'])
  assert.equal(result.evidence.roleResolution, 'AUTO_RESOLVED')
  assert.equal(result.evidence.selectedCandidateId, 'front-usb-1111111111111111')
  assert.equal(result.evidence.kitchenDiscovery, KITCHEN_DISCOVERY_DEFERRED)
}

async function testMultipleFrontCandidatesRequireConfirmation(): Promise<void> {
  const system = new FakeHardwareSystem()
  system.front = frontState(['front-usb-1111111111111111', 'front-usb-2222222222222222'])
  const result = await createFrontUsbPrinterDetectionAdapter(system).detect(context)
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.failureCode, 'USER_CONFIRM_REQUIRED')
  assert.equal(result.evidence.candidateCount, 2)
  assert.equal(result.evidence.selectedCandidateId, null)
}

async function testNoFrontCandidateIsNotFound(): Promise<void> {
  const result = await createFrontUsbPrinterDetectionAdapter(new FakeHardwareSystem()).detect(context)
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.failureCode, 'PRINTER_NOT_FOUND')
  assert.equal(result.evidence.candidateCount, 0)
}

async function testDiscoveryUsesDynamicMetadataWithoutLeakingIt(): Promise<void> {
  const unrelatedDeviceMarker = 'PERSONAL-USB-DEVICE-SERIAL-DO-NOT-LOG'
  const candidates = createFrontUsbPrinterCandidates([
    {
      Name: 'Arbitrary Front Thermal Printer',
      DriverName: '80Normal',
      PortName: 'Port selected dynamically by Windows',
      PortMonitor: 'Vendor monitor',
      PnpDeviceId: 'USBPRINT\\DYNAMIC_MODEL\\8&ABC&0&DYNAMIC',
    },
    {
      Name: 'Unrelated Office Printer',
      DriverName: 'OfficePrinterDriver',
      PortName: 'USB003',
      PnpDeviceId: `USBPRINT\\OFFICE\\${unrelatedDeviceMarker}`,
    },
    {
      Name: 'Network printer using expected driver',
      DriverName: '80Normal',
      PortName: '10.20.30.40',
      PortMonitor: 'Standard TCP/IP Port',
    },
  ])
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]!.driverFamily, 'RONGTA_80MM')
  assert.match(candidates[0]!.candidateId, /^front-usb-[a-f0-9]{16}$/)
  const serialized = JSON.stringify(candidates)
  assert.doesNotMatch(serialized, /Arbitrary Front Thermal Printer|Port selected dynamically by Windows|DYNAMIC_MODEL/)
  assert.doesNotMatch(serialized, new RegExp(unrelatedDeviceMarker))
  assert.doesNotMatch(serialized, /10\.20\.30\.40/)
}

async function testWindowsFrontDiscoveryUsesPrinterPnpAndPortMetadata(): Promise<void> {
  let script = ''
  const system = new WindowsHardwareProvisioningSystem({}, {
    runtimePlatform: 'win32',
    runtimeArchitecture: 'x64',
    run: async (_file, args) => {
      script = args.join(' ')
      return JSON.stringify([{
        Name: 'Windows-assigned thermal printer',
        DriverName: '80Normal',
        PortName: 'Dynamic Windows Port',
        PortMonitor: 'Vendor Monitor',
        PnpDeviceId: 'USBPRINT\\MODEL_FROM_WINDOWS\\INSTANCE_FROM_WINDOWS',
      }])
    },
  })
  const state = await system.inspectFrontUsbPrinters()
  assert.equal(state.roleResolution, 'AUTO_RESOLVED')
  assert.equal(state.candidates.length, 1)
  assert.equal(state.candidates[0]!.driverFamily, 'RONGTA_80MM')
  assert.match(script, /Get-PnpDevice/)
  assert.match(script, /Get-Printer/)
  assert.match(script, /Get-PrinterPort/)
  assert.doesNotMatch(script, /USB001|VID_|PID_|192\.168|9100/)
  assert.doesNotMatch(JSON.stringify(state), /Windows-assigned|Dynamic Windows Port|MODEL_FROM_WINDOWS/)
}

async function testXprinterMetadataMapsToVerifiedFamilyWithoutFixedVidPid(): Promise<void> {
  const candidates = createFrontUsbPrinterCandidates([{
    Name: 'Xprinter XP-N160II',
    DriverName: null,
    PortName: 'Windows Dynamic Port',
    PortMonitor: 'Vendor Monitor',
    PnpDeviceId: 'USBPRINT\\XPRINTER_DEVICE\\DYNAMIC_INSTANCE',
    Manufacturer: '芯烨',
  }])
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]!.driverFamily, 'XPRINTER_80MM')
  assert.doesNotMatch(JSON.stringify(candidates), /XP-N160II|DYNAMIC_INSTANCE|芯烨/)
}

async function testDriverFailureStopsFrontAndFrontFailureStopsQueue(): Promise<void> {
  const hardware = new FakeHardwareSystem()
  const store = new MemoryCheckpointStore()
  const orchestrator = new EShopSetupOrchestrator(
    createHardwareProvisioningPhase1Adapters(new ReadySoftwareSystem(), hardware),
    store,
    new MemoryLogger(),
  )

  const driverBlocked = await orchestrator.run('NOT_BOUND')
  assert.equal(driverBlocked.stoppedAt, 'driver')
  assert.equal(driverBlocked.stageResults.driver?.failureCode, 'EXTERNAL_DRIVER_REQUIRED')
  assert.equal(hardware.frontInspectCount, 0)
  assert.equal(driverBlocked.stageResults['printer-discovery'], undefined)

  hardware.driver = driverState({
    ready: true,
    resolvedFamily: 'RONGTA_80MM',
    resolutionSource: 'INSTALLED_DRIVER',
    detectedName: '80Normal',
    detectionSource: 'WINDOWS_PRINT_MANAGEMENT',
  })
  const printerBlocked = await orchestrator.run('NOT_BOUND')
  assert.equal(printerBlocked.stoppedAt, 'printer-discovery')
  assert.equal(printerBlocked.stageResults['printer-discovery']?.failureCode, 'PRINTER_NOT_FOUND')
  assert.ok(hardware.frontInspectCount > 0)
  assert.equal(printerBlocked.stageResults.queue, undefined)
}

async function testQueueAndKitchenRemainDeferred(): Promise<void> {
  const hardware = new FakeHardwareSystem()
  hardware.driver = driverState({
    ready: true,
    resolvedFamily: 'RONGTA_80MM',
    resolutionSource: 'INSTALLED_DRIVER',
    detectedName: '80Normal',
    detectionSource: 'WINDOWS_PRINT_MANAGEMENT',
  })
  hardware.front = frontState(['front-usb-1111111111111111'])
  const result = await new EShopSetupOrchestrator(
    createHardwareProvisioningPhase1Adapters(new ReadySoftwareSystem(), hardware),
    new MemoryCheckpointStore(),
    new MemoryLogger(),
  ).run('NOT_BOUND')
  assert.equal(result.stoppedAt, 'queue')
  assert.equal(result.stageResults['printer-discovery']?.status, 'READY')
  assert.equal(result.stageResults['printer-discovery']?.evidence.kitchenDiscovery, KITCHEN_DISCOVERY_DEFERRED)
  assert.equal(result.stageResults.queue?.evidence.provisioningImplemented, false)
}

async function main(): Promise<void> {
  await testExisting80NormalIsReady()
  await testVerifiedCatalogContainsOnlyTwoUnknownRedistributionFamilies()
  await testKnownFamilyWithoutPayloadRequiresExternalInstaller()
  await testUnknownPrinterDoesNotInstallUnknownDriver()
  await testRongtaCandidateSelectsRongtaInstallerAdapter()
  await testXprinterCandidateSelectsXprinterInstallerAdapter()
  await testWindowsDriverDetectionMapsPrintManagementEvidence()
  await testSingleFrontCandidateAutoResolves()
  await testMultipleFrontCandidatesRequireConfirmation()
  await testNoFrontCandidateIsNotFound()
  await testDiscoveryUsesDynamicMetadataWithoutLeakingIt()
  await testWindowsFrontDiscoveryUsesPrinterPnpAndPortMetadata()
  await testXprinterMetadataMapsToVerifiedFamilyWithoutFixedVidPid()
  await testDriverFailureStopsFrontAndFrontFailureStopsQueue()
  await testQueueAndKitchenRemainDeferred()
  console.log('E-Shop V1 Setup Hardware Provisioning Phase 1 tests passed (15/15)')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
