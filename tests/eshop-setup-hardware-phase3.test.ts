import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  KITCHEN_DISCOVERY_DEFERRED,
  LOGICAL_QUEUE_NAMES,
  WindowsHardwareProvisioningSystem,
  WindowsQueueProvisioningSystem,
  createFrontUsbPrinterCandidates,
  createHardwareProvisioningPhase3Adapters,
  createQueueProvisioningAdapter,
  kitchenPortName,
  queueInputFromDiscoveryResult,
  type DriverInspection,
  type FrontUsbPrinterInspection,
  type HardwareProvisioningPhase3System,
  type KitchenNetworkPrinterInspection,
  type ProvisionAction,
  type QueueProvisioningInput,
  type QueueProvisioningInspection,
  type QueueProvisioningSystem,
  type SetupStageContext,
  type SoftwareProvisioningSystem,
  type StageResult,
  type VerifiedDriverFamilyId,
  type WindowsPrinterMetadata,
} from '../tools/e-shop-setup/src'

const context: SetupStageContext = {
  runId: 'hardware-phase-3-test',
  bindingStatus: 'NOT_BOUND',
  previousResult: null,
}

const FRONT_SOURCE: WindowsPrinterMetadata & { Name: string } = {
  Name: 'Vendor USB Printer',
  DriverName: '80Normal',
  PortName: 'USB-DYNAMIC',
  PortMonitor: 'USB Monitor',
  PnpDeviceId: 'USBPRINT\\DYNAMIC_FRONT_DEVICE\\INSTANCE',
  Manufacturer: 'RongTa',
}

const FRONT_CANDIDATE_ID = createFrontUsbPrinterCandidates([FRONT_SOURCE])[0]!.candidateId
const KITCHEN_ENDPOINT = '10.20.30.80:9100'
const GOLDEN_KITCHEN_ENDPOINT = '192.168.18.49:9100'
const INPUT: QueueProvisioningInput = {
  frontCandidateId: FRONT_CANDIDATE_ID,
  frontDriverFamily: 'RONGTA_80MM',
  frontDriverName: '80Normal',
  frontPortName: 'USB-DYNAMIC',
  kitchenEndpoint: KITCHEN_ENDPOINT,
}

const GOLDEN_INPUT: QueueProvisioningInput = {
  ...INPUT,
  frontPortName: 'RongtaUSB PORT:',
  kitchenEndpoint: GOLDEN_KITCHEN_ENDPOINT,
}

function queueState(overrides: Partial<QueueProvisioningInspection> = {}): QueueProvisioningInspection {
  return {
    ready: false,
    inputResolved: true,
    driverReady: true,
    driverFamily: 'RONGTA_80MM',
    portProvisionable: true,
    front: { exists: false, mappingCorrect: false },
    kitchen: { exists: false, mappingCorrect: false, portReady: false },
    ...overrides,
  }
}

class FakeQueueSystem implements QueueProvisioningSystem {
  state = queueState()
  provisionCount = 0
  lastInput: QueueProvisioningInput | null = null

  async inspectQueues(input: QueueProvisioningInput): Promise<QueueProvisioningInspection> {
    this.lastInput = structuredClone(input)
    return structuredClone(this.state)
  }

  async provisionQueues(input: QueueProvisioningInput): Promise<ProvisionAction> {
    this.lastInput = structuredClone(input)
    this.provisionCount += 1
    this.state = queueState({
      ready: true,
      front: { exists: true, mappingCorrect: true },
      kitchen: { exists: true, mappingCorrect: true, portReady: true },
    })
    return { changed: true, verified: true }
  }
}

type SnapshotPrinter = WindowsPrinterMetadata & { Name: string }
type SnapshotPort = {
  Name: string
  PrinterHostAddress?: string | null
  PortNumber?: string | number | null
  Protocol?: string | number | null
}
type Snapshot = {
  Printers: SnapshotPrinter[]
  Ports: SnapshotPort[]
  Drivers: string[]
}

function queuePrinter(name: string, driverName: string, portName: string): SnapshotPrinter {
  return { Name: name, DriverName: driverName, PortName: portName, PortMonitor: null, PnpDeviceId: null }
}

function correctKitchenPort(name = kitchenPortName(KITCHEN_ENDPOINT)): SnapshotPort {
  return { Name: name, PrinterHostAddress: '10.20.30.80', PortNumber: 9100, Protocol: 1 }
}

function correctSnapshot(): Snapshot {
  const port = correctKitchenPort()
  return {
    Printers: [
      structuredClone(FRONT_SOURCE),
      queuePrinter(LOGICAL_QUEUE_NAMES.front, '80Normal', 'USB-DYNAMIC'),
      queuePrinter(LOGICAL_QUEUE_NAMES.kitchen, '80Normal', port.Name),
      queuePrinter('Unrelated Office Printer', 'Office Driver', 'OFFICE-PORT'),
    ],
    Ports: [port, { Name: 'OFFICE-PORT', PrinterHostAddress: '10.20.30.200', PortNumber: 515, Protocol: 2 }],
    Drivers: ['80Normal', 'Office Driver'],
  }
}

function selectKitchenPort(snapshot: Snapshot): SnapshotPort {
  const existing = snapshot.Ports.find((port) =>
    port.PrinterHostAddress === '10.20.30.80' && Number(port.PortNumber) === 9100 && String(port.Protocol) === '1',
  )
  if (existing) return existing
  for (let slot = 0; slot < 10; slot += 1) {
    const name = kitchenPortName(KITCHEN_ENDPOINT, slot)
    if (!snapshot.Ports.some((port) => port.Name === name)) {
      const created = correctKitchenPort(name)
      snapshot.Ports.push(created)
      return created
    }
  }
  throw new Error('test snapshot has no safe kitchen port slot')
}

function upsertTargetQueue(snapshot: Snapshot, name: string, driverName: string, portName: string): void {
  const current = snapshot.Printers.find((printer) => printer.Name === name)
  if (current) {
    current.DriverName = driverName
    current.PortName = portName
    return
  }
  snapshot.Printers.push(queuePrinter(name, driverName, portName))
}

function windowsHarness(initial: Snapshot) {
  const snapshot = structuredClone(initial)
  const provisioningScripts: string[] = []
  const inspectionScripts: string[] = []
  const system = new WindowsQueueProvisioningSystem({
    runtimePlatform: 'win32',
    runtimeArchitecture: 'x64',
    run: async (_file, args) => {
      const script = args.join(' ')
      if (script.includes('eshop.queue.inspection.v1')) {
        inspectionScripts.push(script)
        return Buffer.from(JSON.stringify(snapshot), 'utf8').toString('base64')
      }
      if (!script.includes('eshop.queue.provisioning.v1')) throw new Error('unexpected command')
      provisioningScripts.push(script)
      const kitchenPort = selectKitchenPort(snapshot)
      upsertTargetQueue(snapshot, LOGICAL_QUEUE_NAMES.front, '80Normal', 'USB-DYNAMIC')
      upsertTargetQueue(snapshot, LOGICAL_QUEUE_NAMES.kitchen, '80Normal', kitchenPort.Name)
      return ''
    },
  })
  return { system, snapshot, provisioningScripts, inspectionScripts }
}

function discoveryResult(): StageResult {
  return {
    status: 'READY',
    failureCode: null,
    message: 'resolved',
    retryable: false,
    evidence: {
      selectedCandidateId: FRONT_CANDIDATE_ID,
      driverFamilies: ['RONGTA_80MM'],
      selectedKitchenEndpoint: KITCHEN_ENDPOINT,
    },
  }
}

async function testDiscoveryResultBecomesLogicalQueueInput(): Promise<void> {
  const target = {
    candidateId: FRONT_CANDIDATE_ID,
    driverFamily: 'RONGTA_80MM' as const,
    driverName: '80Normal',
    portName: 'USB-DYNAMIC',
  }
  assert.deepEqual(queueInputFromDiscoveryResult(discoveryResult(), target), INPUT)
  assert.equal(queueInputFromDiscoveryResult({ ...discoveryResult(), status: 'BLOCKED' }, target), null)
}

async function testWindowsDiscoveryHandoffPreservesResolvedFrontMapping(): Promise<void> {
  const system = new WindowsHardwareProvisioningSystem({}, {
    runtimePlatform: 'win32',
    runtimeArchitecture: 'x64',
    run: async () => JSON.stringify([FRONT_SOURCE]),
  })
  const inspection = await system.inspectFrontUsbPrinters()
  assert.equal(inspection.selectedCandidateId, FRONT_CANDIDATE_ID)
  assert.deepEqual(system.getResolvedFrontQueueTarget(FRONT_CANDIDATE_ID), {
    candidateId: FRONT_CANDIDATE_ID,
    driverFamily: 'RONGTA_80MM',
    driverName: '80Normal',
    portName: 'USB-DYNAMIC',
  })
}

async function testFrontAndKitchenQueueCreationWithRawPort(): Promise<void> {
  const harness = windowsHarness({
    Printers: [
      structuredClone(FRONT_SOURCE),
      queuePrinter('Unrelated Office Printer', 'Office Driver', 'OFFICE-PORT'),
    ],
    Ports: [{ Name: 'OFFICE-PORT', PrinterHostAddress: '10.20.30.200', PortNumber: 515, Protocol: 2 }],
    Drivers: ['80Normal', 'Office Driver'],
  })
  const adapter = createQueueProvisioningAdapter(harness.system, () => INPUT)
  assert.equal((await adapter.detect(context)).status, 'NEEDS_ACTION')
  const result = await adapter.execute(context)
  assert.equal(result.status, 'READY')
  assert.deepEqual(result.evidence.logicalQueues, [LOGICAL_QUEUE_NAMES.front, LOGICAL_QUEUE_NAMES.kitchen])
  assert.equal(harness.provisioningScripts.length, 1)
  assert.match(harness.provisioningScripts[0]!, /Add-PrinterPort[\s\S]*PortNumber 9100/)
  assert.match(harness.provisioningScripts[0]!, /Add-Printer -Name \$frontQueue/)
  assert.match(harness.provisioningScripts[0]!, /Add-Printer -Name \$kitchenQueue/)
  assert.ok(harness.snapshot.Printers.some(({ Name }) => Name === LOGICAL_QUEUE_NAMES.front))
  assert.ok(harness.snapshot.Printers.some(({ Name }) => Name === LOGICAL_QUEUE_NAMES.kitchen))
}

async function testExistingCorrectQueuesAreReused(): Promise<void> {
  const harness = windowsHarness(correctSnapshot())
  const result = await createQueueProvisioningAdapter(harness.system, () => INPUT).detect(context)
  assert.equal(result.status, 'READY')
  assert.deepEqual(result.evidence.frontQueue, { name: LOGICAL_QUEUE_NAMES.front, exists: true, mappingCorrect: true })
  assert.deepEqual(result.evidence.kitchenQueue, {
    name: LOGICAL_QUEUE_NAMES.kitchen,
    exists: true,
    mappingCorrect: true,
    raw9100PortReady: true,
  })
  assert.equal(harness.provisioningScripts.length, 0)
}

async function testGoldenFrontMappingUsesDiscoveryDriverAndUsbPort(): Promise<void> {
  const harness = windowsHarness({
    Printers: [
      queuePrinter(LOGICAL_QUEUE_NAMES.front, '80Normal', 'RongtaUSB PORT:'),
      queuePrinter(LOGICAL_QUEUE_NAMES.kitchen, '80Normal', '192.168.18.49'),
    ],
    Ports: [{ Name: '192.168.18.49', PrinterHostAddress: '192.168.18.49', PortNumber: 9100, Protocol: 'RAW' }],
    Drivers: ['80Normal'],
  })
  const state = await harness.system.inspectQueues(GOLDEN_INPUT)
  assert.equal(state.front.exists, true)
  assert.equal(state.front.mappingCorrect, true)
  assert.equal(state.driverReady, true)
  assert.match(harness.inspectionScripts[0]!, /UTF8Encoding/)
  assert.match(harness.inspectionScripts[0]!, /ToBase64String/)
  assert.match(harness.inspectionScripts[0]!, /List\[object\]/)
  assert.equal(harness.provisioningScripts.length, 0)
}

async function testGoldenKitchenMappingUsesQueuePortEndpointMetadata(): Promise<void> {
  const runtimePort = kitchenPortName(GOLDEN_KITCHEN_ENDPOINT)
  const harness = windowsHarness({
    Printers: [
      queuePrinter(LOGICAL_QUEUE_NAMES.front, '80Normal', 'RongtaUSB PORT:'),
      queuePrinter(LOGICAL_QUEUE_NAMES.kitchen, '80Normal', '192.168.18.49'),
    ],
    Ports: [
      { Name: runtimePort, PrinterHostAddress: '192.168.18.49', PortNumber: 9100, Protocol: 1 },
      { Name: '192.168.18.49', PrinterHostAddress: '192.168.18.49', PortNumber: 9100, Protocol: 'RAW' },
    ],
    Drivers: ['80Normal', 'Office Driver'],
  })
  const state = await harness.system.inspectQueues(GOLDEN_INPUT)
  assert.equal(state.kitchen.exists, true)
  assert.equal(state.kitchen.portReady, true)
  assert.equal(state.kitchen.mappingCorrect, true)
  assert.equal(state.ready, true)
  assert.equal(harness.provisioningScripts.length, 0)
}

async function testWrongMappingsAreSafelyRepaired(): Promise<void> {
  const port = correctKitchenPort()
  const harness = windowsHarness({
    Printers: [
      structuredClone(FRONT_SOURCE),
      queuePrinter(LOGICAL_QUEUE_NAMES.front, '80Normal', 'WRONG-USB-PORT'),
      queuePrinter(LOGICAL_QUEUE_NAMES.kitchen, '80Normal', 'WRONG-KITCHEN-PORT'),
      queuePrinter('Unrelated Office Printer', 'Office Driver', 'OFFICE-PORT'),
    ],
    Ports: [
      port,
      { Name: 'WRONG-KITCHEN-PORT', PrinterHostAddress: '10.20.30.81', PortNumber: 9100, Protocol: 1 },
      { Name: 'OFFICE-PORT', PrinterHostAddress: '10.20.30.200', PortNumber: 515, Protocol: 2 },
    ],
    Drivers: ['80Normal', 'Office Driver'],
  })
  const before = await harness.system.inspectQueues(INPUT)
  assert.equal(before.front.mappingCorrect, false)
  assert.equal(before.kitchen.mappingCorrect, false)
  const result = await createQueueProvisioningAdapter(harness.system, () => INPUT).execute(context)
  assert.equal(result.status, 'READY')
  assert.match(harness.provisioningScripts[0]!, /Set-Printer -Name \$frontQueue/)
  assert.match(harness.provisioningScripts[0]!, /Set-Printer -Name \$kitchenQueue/)
  assert.equal(harness.snapshot.Printers.find(({ Name }) => Name === 'Unrelated Office Printer')?.PortName, 'OFFICE-PORT')
  assert.doesNotMatch(harness.provisioningScripts[0]!, /Remove-Printer|Remove-PrinterPort/)
}

async function testWrongRuntimePortUsesSafeRepairSlot(): Promise<void> {
  const baseName = kitchenPortName(KITCHEN_ENDPOINT)
  const harness = windowsHarness({
    Printers: [structuredClone(FRONT_SOURCE)],
    Ports: [{ Name: baseName, PrinterHostAddress: '10.20.30.99', PortNumber: 9100, Protocol: 1 }],
    Drivers: ['80Normal'],
  })
  const result = await createQueueProvisioningAdapter(harness.system, () => INPUT).execute(context)
  assert.equal(result.status, 'READY')
  assert.match(harness.provisioningScripts[0]!, new RegExp(`${baseName}-r1`))
  assert.equal(harness.snapshot.Ports.find(({ Name }) => Name === baseName)?.PrinterHostAddress, '10.20.30.99')
  assert.ok(harness.snapshot.Ports.some(({ Name }) => Name === `${baseName}-r1`))
}

async function testDriverNotReadyFailsClosed(): Promise<void> {
  const harness = windowsHarness({
    Printers: [structuredClone(FRONT_SOURCE)],
    Ports: [],
    Drivers: [],
  })
  const adapter = createQueueProvisioningAdapter(harness.system, () => INPUT)
  const result = await adapter.detect(context)
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.failureCode, 'QUEUE_PROVISION_FAILED')
  assert.equal(result.evidence.driverReady, false)
  assert.equal(harness.provisioningScripts.length, 0)
}

async function testQueueProvisioningIsIdempotentAndPreservesUnrelatedPrinters(): Promise<void> {
  const harness = windowsHarness({
    Printers: [
      structuredClone(FRONT_SOURCE),
      queuePrinter('Unrelated Office Printer', 'Office Driver', 'OFFICE-PORT'),
    ],
    Ports: [{ Name: 'OFFICE-PORT', PrinterHostAddress: '10.20.30.200', PortNumber: 515, Protocol: 2 }],
    Drivers: ['80Normal', 'Office Driver'],
  })
  const adapter = createQueueProvisioningAdapter(harness.system, () => INPUT)
  assert.equal((await adapter.execute(context)).status, 'READY')
  assert.equal((await adapter.detect(context)).status, 'READY')
  assert.equal(harness.provisioningScripts.length, 1)
  assert.equal(harness.snapshot.Printers.find(({ Name }) => Name === 'Unrelated Office Printer')?.DriverName, 'Office Driver')
  assert.equal(harness.snapshot.Ports.find(({ Name }) => Name === 'OFFICE-PORT')?.PortNumber, 515)
}

class FakeHardwareSystem implements HardwareProvisioningPhase3System {
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
    throw new Error('Driver installation must not run')
  }

  async inspectFrontUsbPrinters(): Promise<FrontUsbPrinterInspection> {
    return {
      candidates: [{
        candidateId: FRONT_CANDIDATE_ID,
        detectionSource: 'WINDOWS_PRINTER_PNP_METADATA',
        driverFamily: 'RONGTA_80MM',
      }],
      roleResolution: 'AUTO_RESOLVED',
      selectedCandidateId: FRONT_CANDIDATE_ID,
      kitchenDiscovery: KITCHEN_DISCOVERY_DEFERRED,
    }
  }

  async inspectKitchenNetworkPrinters(): Promise<KitchenNetworkPrinterInspection> {
    return {
      candidates: [{
        endpoint: KITCHEN_ENDPOINT,
        port: 9100,
        detectionSources: ['LOCAL_IPV4_SUBNET_PROBE'],
        raw9100Reachable: true,
        windowsPrinterPortAssociated: false,
      }],
      roleResolution: 'AUTO_RESOLVED',
      selectedEndpoint: KITCHEN_ENDPOINT,
    }
  }

  getResolvedFrontQueueTarget(candidateId: string) {
    return candidateId === FRONT_CANDIDATE_ID
      ? {
          candidateId,
          driverFamily: 'RONGTA_80MM' as const,
          driverName: '80Normal',
          portName: 'USB-DYNAMIC',
        }
      : null
  }
}

async function testPhase3StageHandoffUsesDiscoveryResult(): Promise<void> {
  const queueSystem = new FakeQueueSystem()
  queueSystem.state = queueState({
    ready: true,
    front: { exists: true, mappingCorrect: true },
    kitchen: { exists: true, mappingCorrect: true, portReady: true },
  })
  const adapters = createHardwareProvisioningPhase3Adapters(
    {} as SoftwareProvisioningSystem,
    new FakeHardwareSystem(),
    queueSystem,
  )
  const discovery = adapters.find(({ stage }) => stage === 'printer-discovery')!
  const queue = adapters.find(({ stage }) => stage === 'queue')!
  assert.equal((await discovery.detect(context)).status, 'READY')
  assert.equal((await queue.detect(context)).status, 'READY')
  assert.deepEqual(queueSystem.lastInput, INPUT)
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
}

async function testNoFixedIpOrPrintingMutation(): Promise<void> {
  const source = readFileSync(
    new URL('../tools/e-shop-setup/src/windowsQueueProvisioning.ts', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(source, /192\.168\.18\.49/)
  assert.doesNotMatch(source, /qz|printEscPos|Out-Printer|Write-Printer|Start-PrintJob/i)
  assert.doesNotMatch(source, /Remove-Printer|Remove-PrinterPort/)
  assert.doesNotMatch(source, /SNMP/i)
  assert.doesNotMatch(source, /Get-PnpDevice|Get-NetNeighbor|Get-NetIPConfiguration/)
  assert.match(source, /LOGICAL_QUEUE_NAMES\.front/)
  assert.match(source, /LOGICAL_QUEUE_NAMES\.kitchen/)
}

async function main(): Promise<void> {
  await testDiscoveryResultBecomesLogicalQueueInput()
  await testWindowsDiscoveryHandoffPreservesResolvedFrontMapping()
  await testFrontAndKitchenQueueCreationWithRawPort()
  await testExistingCorrectQueuesAreReused()
  await testGoldenFrontMappingUsesDiscoveryDriverAndUsbPort()
  await testGoldenKitchenMappingUsesQueuePortEndpointMetadata()
  await testWrongMappingsAreSafelyRepaired()
  await testWrongRuntimePortUsesSafeRepairSlot()
  await testDriverNotReadyFailsClosed()
  await testQueueProvisioningIsIdempotentAndPreservesUnrelatedPrinters()
  await testPhase3StageHandoffUsesDiscoveryResult()
  await testNoFixedIpOrPrintingMutation()
  console.log('E-Shop V1 Setup Hardware Provisioning Phase 3 tests passed (12/12)')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
