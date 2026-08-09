import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  KITCHEN_DISCOVERY_DEFERRED,
  WindowsHardwareProvisioningSystem,
  createHardwarePrinterDiscoveryAdapter,
  createHardwareProvisioningPhase2Adapters,
  createKitchenNetworkPrinterCandidates,
  createKitchenNetworkPrinterDetectionAdapter,
  type DriverInspection,
  type FrontUsbPrinterInspection,
  type HardwareProvisioningPhase2System,
  type KitchenNetworkDiscoverySystem,
  type KitchenNetworkPrinterInspection,
  type ProvisionAction,
  type SetupStageContext,
  type SoftwareProvisioningSystem,
  type VerifiedDriverFamilyId,
} from '../tools/e-shop-setup/src'

const context: SetupStageContext = {
  runId: 'hardware-phase-2-test',
  bindingStatus: 'NOT_BOUND',
  previousResult: null,
}

function kitchenState(endpoints: string[] = []): KitchenNetworkPrinterInspection {
  return {
    candidates: endpoints.map((endpoint) => ({
      endpoint,
      port: 9100,
      detectionSources: ['LOCAL_IPV4_SUBNET_PROBE'],
      raw9100Reachable: true,
      windowsPrinterPortAssociated: false,
    })),
    roleResolution: endpoints.length === 1
      ? 'AUTO_RESOLVED'
      : endpoints.length > 1
        ? 'USER_CONFIRM_REQUIRED'
        : 'NOT_FOUND',
    selectedEndpoint: endpoints.length === 1 ? endpoints[0]! : null,
  }
}

class FakeKitchenSystem implements KitchenNetworkDiscoverySystem {
  state = kitchenState()
  async inspectKitchenNetworkPrinters(): Promise<KitchenNetworkPrinterInspection> {
    return structuredClone(this.state)
  }
}

class FakePhase2System implements HardwareProvisioningPhase2System {
  kitchen = kitchenState()
  front: FrontUsbPrinterInspection = {
    candidates: [{
      candidateId: 'front-usb-1111111111111111',
      detectionSource: 'WINDOWS_PRINTER_PNP_METADATA',
      driverFamily: 'RONGTA_80MM',
    }],
    roleResolution: 'AUTO_RESOLVED',
    selectedCandidateId: 'front-usb-1111111111111111',
    kitchenDiscovery: KITCHEN_DISCOVERY_DEFERRED,
  }

  async inspectDriver(): Promise<DriverInspection> {
    return {
      ready: true,
      resolvedFamily: 'RONGTA_80MM',
      resolutionSource: 'INSTALLED_DRIVER',
      detectedName: '80Normal',
      version: '8.0',
      manufacturer: 'RongTa',
      detectionSource: 'WINDOWS_PRINT_MANAGEMENT',
      payloadAvailable: false,
    }
  }

  async installExternalDriver(_family: VerifiedDriverFamilyId): Promise<ProvisionAction> {
    throw new Error('Driver installation is outside Hardware Phase 2 discovery tests')
  }

  async inspectFrontUsbPrinters(): Promise<FrontUsbPrinterInspection> {
    return structuredClone(this.front)
  }

  async inspectKitchenNetworkPrinters(): Promise<KitchenNetworkPrinterInspection> {
    return structuredClone(this.kitchen)
  }
}

async function testSingleRaw9100CandidateAutoResolves(): Promise<void> {
  const candidates = createKitchenNetworkPrinterCandidates([{
    Address: '10.20.30.40',
    Port: 9100,
    DetectionSources: ['WINDOWS_STANDARD_TCPIP_PORT', 'LOCAL_IPV4_SUBNET_PROBE'],
    Raw9100Reachable: true,
    WindowsPrinterPortAssociated: true,
  }])
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]!.endpoint, '10.20.30.40:9100')
  assert.equal(candidates[0]!.raw9100Reachable, true)
  assert.equal(candidates[0]!.windowsPrinterPortAssociated, true)

  const system = new FakeKitchenSystem()
  system.state = kitchenState(['10.20.30.40:9100'])
  const result = await createKitchenNetworkPrinterDetectionAdapter(system).detect(context)
  assert.equal(result.status, 'READY')
  assert.equal(result.failureCode, null)
  assert.equal(result.evidence.selectedKitchenEndpoint, '10.20.30.40:9100')
  assert.equal(result.evidence.userManualIpInputRequired, false)
}

async function testMultipleCandidatesRequireConfirmation(): Promise<void> {
  const system = new FakeKitchenSystem()
  system.state = kitchenState(['10.20.30.40:9100', '10.20.30.41:9100'])
  const result = await createKitchenNetworkPrinterDetectionAdapter(system).detect(context)
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.failureCode, 'USER_CONFIRM_REQUIRED')
  assert.equal(result.evidence.kitchenCandidateCount, 2)
  assert.equal(result.evidence.selectedKitchenEndpoint, null)
  assert.equal(result.evidence.userManualIpInputRequired, false)
}

async function testNoCandidateIsNotFound(): Promise<void> {
  const result = await createKitchenNetworkPrinterDetectionAdapter(new FakeKitchenSystem()).detect(context)
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.failureCode, 'PRINTER_NOT_FOUND')
  assert.equal(result.evidence.kitchenCandidateCount, 0)
}

async function testOnlyReachableRaw9100Ipv4EvidenceBecomesCandidate(): Promise<void> {
  const candidates = createKitchenNetworkPrinterCandidates([
    {
      Address: '10.20.30.50',
      Port: 9100,
      DetectionSources: 'WINDOWS_NETWORK_NEIGHBOR',
      Raw9100Reachable: false,
      WindowsPrinterPortAssociated: false,
    },
    {
      Address: '10.20.30.51',
      Port: 515,
      DetectionSources: 'WINDOWS_STANDARD_TCPIP_PORT',
      Raw9100Reachable: true,
      WindowsPrinterPortAssociated: true,
    },
    {
      Address: 'not-an-ip',
      Port: 9100,
      DetectionSources: 'LOCAL_IPV4_SUBNET_PROBE',
      Raw9100Reachable: true,
      WindowsPrinterPortAssociated: false,
    },
  ])
  assert.deepEqual(candidates, [])
}

async function testWindowsDiscoveryUsesOnlyReadOnlyLocalEvidenceAndRawProbe(): Promise<void> {
  let script = ''
  const system = new WindowsHardwareProvisioningSystem({}, {
    runtimePlatform: 'win32',
    runtimeArchitecture: 'x64',
    run: async (_file, args) => {
      script = args.join(' ')
      return JSON.stringify([{
        Address: '10.20.30.60',
        Port: 9100,
        DetectionSources: ['WINDOWS_NETWORK_NEIGHBOR', 'LOCAL_IPV4_SUBNET_PROBE'],
        Raw9100Reachable: true,
        WindowsPrinterPortAssociated: false,
      }])
    },
  })
  const result = await system.inspectKitchenNetworkPrinters()
  assert.equal(result.roleResolution, 'AUTO_RESOLVED')
  assert.equal(result.selectedEndpoint, '10.20.30.60:9100')
  assert.match(script, /Get-Printer/)
  assert.match(script, /Get-PrinterPort/)
  assert.match(script, /Get-NetNeighbor/)
  assert.match(script, /Get-NetIPConfiguration/)
  assert.match(script, /TcpClient/)
  assert.match(script, /targetPort=9100/)
  assert.doesNotMatch(script, /Add-Printer|Add-PrinterPort|Set-Printer|Remove-Printer|Out-Printer|Write-Printer/)
  assert.doesNotMatch(script, /Read-Host|Send|Write\(/)
}

async function testHistoricalGoldenIpAndManualIpAreNotContracts(): Promise<void> {
  const source = readFileSync(
    new URL('../tools/e-shop-setup/src/windowsHardwareProvisioning.ts', import.meta.url),
    'utf8',
  )
  const cli = readFileSync(new URL('../tools/e-shop-setup/src/hardwareCli.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /192\.168\.18\.49/)
  assert.doesNotMatch(source, /defaultKitchen|kitchenIp|Read-Host/)
  assert.doesNotMatch(cli, /kitchen-ip|kitchenIp/)
}

async function testCombinedPrinterDiscoveryRequiresFrontAndKitchen(): Promise<void> {
  const system = new FakePhase2System()
  system.kitchen = kitchenState(['10.20.30.70:9100'])
  const ready = await createHardwarePrinterDiscoveryAdapter(system).detect(context)
  assert.equal(ready.status, 'READY')
  assert.equal(ready.evidence.kitchenDiscovery, 'IMPLEMENTED')
  assert.equal(ready.evidence.queueProvisioning, 'DEFERRED')
  assert.equal(ready.evidence.printerPortCreation, 'DEFERRED')

  system.front.candidates = []
  system.front.roleResolution = 'NOT_FOUND'
  system.front.selectedCandidateId = null
  const missingFront = await createHardwarePrinterDiscoveryAdapter(system).detect(context)
  assert.equal(missingFront.failureCode, 'PRINTER_NOT_FOUND')
}

async function testFixedStageOrderAndQueueRemainDeferred(): Promise<void> {
  const adapters = createHardwareProvisioningPhase2Adapters(
    {} as SoftwareProvisioningSystem,
    new FakePhase2System(),
  )
  assert.deepEqual(adapters.map(({ stage }) => stage), [
    'preflight',
    'desktop',
    'qz',
    'certificate',
    'driver',
    'printer-discovery',
    'queue',
    'runtime-health',
  ])
  const queue = adapters.find(({ stage }) => stage === 'queue')!
  const result = await queue.detect(context)
  assert.equal(result.status, 'NEEDS_ACTION')
  assert.equal(result.failureCode, null)
  assert.equal(result.evidence.provisioningImplemented, false)
}

async function main(): Promise<void> {
  await testSingleRaw9100CandidateAutoResolves()
  await testMultipleCandidatesRequireConfirmation()
  await testNoCandidateIsNotFound()
  await testOnlyReachableRaw9100Ipv4EvidenceBecomesCandidate()
  await testWindowsDiscoveryUsesOnlyReadOnlyLocalEvidenceAndRawProbe()
  await testHistoricalGoldenIpAndManualIpAreNotContracts()
  await testCombinedPrinterDiscoveryRequiresFrontAndKitchen()
  await testFixedStageOrderAndQueueRemainDeferred()
  console.log('E-Shop V1 Setup Hardware Provisioning Phase 2 tests passed (8/8)')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
