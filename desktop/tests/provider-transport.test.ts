import { describe, expect, it } from 'vitest'
import { HRT_CONTRACT_VERSION, HrtFrame } from '@eshop/hrt-contract'
import { buildWindowsProviderPipeName } from '../src/main/provider/providerPipeName'
import { ProviderFrameDecoder, encodeProviderEnvelope, MAX_PROVIDER_FRAME_BYTES } from '../src/main/provider/providerTransportFraming'
import { resolveWindowsProviderEntry } from '../src/main/provider/providerProcess'
import { WINDOWS_PROVIDER_COMPATIBILITY_MATRIX, WINDOWS_PROVIDER_ID } from '../src/main/provider/providerCompatibility'

function frame(id: string): HrtFrame {
  return {
    contractVersion: HRT_CONTRACT_VERSION,
    messageType: 'health.snapshot',
    correlationId: id,
    instanceId: 'desktop-runtime-test',
    sequence: 1,
    timestamp: new Date().toISOString(),
    payload: { request: true },
  }
}

describe('Windows Provider transport adapter', () => {
  it('uses the formal provider compatibility matrix without mutating the frozen contract package', () => {
    expect(WINDOWS_PROVIDER_ID).toBe('windows-provider')
    expect(WINDOWS_PROVIDER_COMPATIBILITY_MATRIX.providerId).toBe('windows-provider')
    expect(WINDOWS_PROVIDER_COMPATIBILITY_MATRIX.requiredCapabilities).toEqual(['printer.receipt'])
  })

  it('builds a scoped pipe name with no business data', () => {
    const name = buildWindowsProviderPipeName({ platform: 'win32', sessionScope: 'User One', suffix: 'test run' })
    expect(name).toBe('\\\\.\\pipe\\eshop-windows-provider-v1-user-one-test-run')
    expect(name).not.toContain('STORE')
    expect(name).not.toContain('SALE')
  })

  it('decodes fragmented and back-to-back frames', () => {
    const first = encodeProviderEnvelope({ supervisorToken: 'token', frame: frame('one') })
    const second = encodeProviderEnvelope({ supervisorToken: 'token', frame: frame('two') })
    const decoder = new ProviderFrameDecoder()
    expect(decoder.push(first.subarray(0, 3))).toEqual([])
    const decoded = decoder.push(Buffer.concat([first.subarray(3), second]))
    expect(decoded).toHaveLength(2)
    expect(decoded[0]).toMatchObject({ ok: true, envelope: { frame: { correlationId: 'one' } } })
    expect(decoded[1]).toMatchObject({ ok: true, envelope: { frame: { correlationId: 'two' } } })
  })

  it('rejects zero and oversized frames', () => {
    const decoder = new ProviderFrameDecoder()
    const zero = Buffer.alloc(4)
    zero.writeUInt32LE(0, 0)
    expect(decoder.push(zero)[0]).toMatchObject({ ok: false, code: 'FRAME_ZERO_LENGTH' })

    const oversized = Buffer.alloc(4)
    oversized.writeUInt32LE(MAX_PROVIDER_FRAME_BYTES + 1, 0)
    expect(new ProviderFrameDecoder().push(oversized)[0]).toMatchObject({ ok: false, code: 'FRAME_OVERSIZED' })
  })

  it('resolves dev and packaged provider entries without assuming system Node', () => {
    expect(resolveWindowsProviderEntry({ env: { ESHOP_WINDOWS_PROVIDER_ENTRY: __filename } }).source).toBe('env-entry')
    expect(resolveWindowsProviderEntry({ env: {}, resourcesPath: __dirname, cwd: __dirname })).toMatchObject({ entryPath: null, source: 'missing' })
  })

})
