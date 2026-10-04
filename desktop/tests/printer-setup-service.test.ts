import { describe, expect, it, vi } from 'vitest'
import { PrinterSetupService } from '../src/main/printing/printerSetupService'
import type { PrinterCandidate } from '../src/main/printing/printerDiscovery'

const candidate: PrinterCandidate = {
  id: '192.168.50.2:9100@aa-bb-cc-dd-ee-f0',
  ip: '192.168.50.2',
  port: 9100,
  hardwareAddress: 'aa-bb-cc-dd-ee-f0',
  interfaceName: 'Ethernet',
  localAddress: '192.168.50.1',
}

function harness(outcome: 'CROSSED' | 'UNKNOWN' = 'CROSSED') {
  let configuration: any = { ok: false as const, code: 'ENDPOINT_CONFIG_UNAVAILABLE' }
  const runtime = {
    endpointConfiguration: vi.fn(async () => configuration),
    refreshEndpointReadiness: vi.fn(async () => ({ FRONT: true, KITCHEN: true })),
    provisionEndpoints: vi.fn(async (input: any) => {
      configuration = { ok: true as const, value: input }
    }),
  }
  const discovery = {
    discover: vi.fn(async () => ({ status: 'COMPLETE' as const, candidates: [candidate], attempted: 1, totalTargets: 1 })),
    validate: vi.fn(async () => true),
  }
  const boundary = {
    cross: vi.fn(async () => outcome === 'CROSSED'
      ? { outcome: 'CROSSED' as const, allBytesWritten: true as const, flushAndFinConfirmed: true as const }
      : { outcome: 'UNKNOWN' as const, reason: 'TIMEOUT' }),
  }
  const service = new PrinterSetupService(runtime as any, '0.3.0-commercial-pilot.1', discovery as any, boundary)
  return { service, runtime, discovery, boundary }
}

describe('PrinterSetupService', () => {
  it('requires role assignment and separate successful test prints before encrypted endpoint provisioning', async () => {
    const { service, runtime, boundary } = harness()
    await service.initialize()
    await service.discover()
    service.assign('FRONT', candidate.id)
    service.assign('KITCHEN', candidate.id)
    expect((await service.test('FRONT')).tested.FRONT).toBe(true)
    expect((await service.test('KITCHEN')).tested.KITCHEN).toBe(true)
    const saved = await service.save()

    expect(saved.state).toBe('READY')
    expect(runtime.provisionEndpoints).toHaveBeenCalledWith({
      revision: 1,
      endpoints: {
        FRONT: { host: candidate.ip, port: 9100, hardwareAddress: candidate.hardwareAddress },
        KITCHEN: { host: candidate.ip, port: 9100, hardwareAddress: candidate.hardwareAddress },
      },
    })
    expect(boundary.cross).toHaveBeenCalledTimes(2)
    const calls = (boundary.cross as any).mock.calls
    expect(Buffer.from(calls[0][0].payload).toString('ascii')).toContain('FRONT TEST PRINT')
    expect(Buffer.from(calls[1][0].payload).toString('ascii')).toContain('KITCHEN TEST PRINT')
  })

  it('fails closed when a test print has an unknown crossing outcome', async () => {
    const { service, runtime } = harness('UNKNOWN')
    await service.discover()
    service.assign('FRONT', candidate.id)
    service.assign('KITCHEN', candidate.id)
    expect((await service.test('FRONT')).errorCode).toBe('PRINTER_TEST_CROSSING_UNKNOWN')
    expect((await service.save()).errorCode).toBe('PRINTER_TEST_REQUIRED')
    expect(runtime.provisionEndpoints).not.toHaveBeenCalled()
  })

  it('restores Ready from the encrypted LocalEndpointAuthority projection after reboot', async () => {
    const endpoints = {
      FRONT: { host: '192.168.50.2', port: 9100, hardwareAddress: 'aa-bb-cc-dd-ee-f0' },
      KITCHEN: { host: '192.168.50.3', port: 9100, hardwareAddress: 'aa-bb-cc-dd-ee-f1' },
    }
    const runtime = {
      endpointConfiguration: vi.fn(async () => ({ ok: true as const, value: { revision: 4, endpoints } })),
      refreshEndpointReadiness: vi.fn(async () => ({ FRONT: true, KITCHEN: true })),
    }
    const service = new PrinterSetupService(runtime as any, '0.3.0-commercial-pilot.1')
    await expect(service.initialize()).resolves.toMatchObject({ state: 'READY', configured: endpoints })
  })

  it('does not allow assignment changes while a role test is in flight', async () => {
    const { service, discovery } = harness()
    let releaseValidation!: (value: boolean) => void
    discovery.validate.mockImplementationOnce(() => new Promise<boolean>((resolve) => { releaseValidation = resolve }))
    await service.discover()
    service.assign('FRONT', candidate.id)
    const testing = service.test('FRONT')
    await vi.waitFor(() => expect(discovery.validate).toHaveBeenCalledTimes(1))
    expect(() => service.assign('FRONT', candidate.id)).toThrow('PRINTER_SETUP_BUSY')
    releaseValidation(true)
    await expect(testing).resolves.toMatchObject({ tested: { FRONT: true } })
  })
})
