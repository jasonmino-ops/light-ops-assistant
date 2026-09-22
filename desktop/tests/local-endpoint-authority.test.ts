import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalEndpointAuthority } from '../src/main/printing/localEndpointAuthority'

const roots: string[] = []
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`sealed:${value}`),
  decryptString: (value: Buffer) => {
    const text = value.toString()
    if (!text.startsWith('sealed:')) throw new Error('tampered')
    return text.slice(7)
  },
}
async function authority(identity = { storeId: 'store-a', deviceId: 'device-a' }) {
  const root = await mkdtemp(join(os.tmpdir(), 'v3-endpoint-'))
  roots.push(root)
  return { root, value: new LocalEndpointAuthority(root, identity, storage) }
}
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('LocalEndpointAuthority', () => {
  it('binds configuration to store/device and resolves roles independently', async () => {
    const { root, value } = await authority()
    await value.provision({ revision: 1, endpoints: { FRONT: { host: '192.168.1.10', port: 9100 }, KITCHEN: { host: '192.168.1.11', port: 9100 } } })
    expect(await value.resolve('FRONT')).toEqual({ ok: true, endpointKey: '192.168.1.10:9100' })
    expect(await value.resolve('KITCHEN')).toEqual({ ok: true, endpointKey: '192.168.1.11:9100' })
    expect((await new LocalEndpointAuthority(root, { storeId: 'store-b', deviceId: 'device-a' }, storage).resolve('FRONT')).ok).toBe(false)
    expect((await new LocalEndpointAuthority(root, { storeId: 'store-a', deviceId: 'device-b' }, storage).resolve('FRONT')).ok).toBe(false)
    await expect(value.provision({ revision: 1, endpoints: { FRONT: { host: '10.0.0.1', port: 9100 } } })).rejects.toThrow('ENDPOINT_CONFIG_REVISION_STALE')
  })

  it('fails closed for missing roles, malformed endpoints and tampering', async () => {
    const { root, value } = await authority()
    await expect(value.provision({ revision: 1, endpoints: { FRONT: { host: '8.8.8.8', port: 9100 } } })).rejects.toThrow('ENDPOINT_CONFIG_INVALID')
    await value.provision({ revision: 1, endpoints: { FRONT: { host: '10.0.0.8', port: 9100 } } })
    expect(await value.resolve('KITCHEN')).toEqual({ ok: false, code: 'ENDPOINT_KITCHEN_MISSING' })
    const file = join(root, 'v3-printing', 'endpoints.json')
    const outer = JSON.parse(await readFile(file, 'utf8'))
    outer.ciphertextBase64 = Buffer.from('tampered').toString('base64')
    await writeFile(file, JSON.stringify(outer))
    expect((await value.resolve('FRONT')).ok).toBe(false)
  })

  it('allows the same trusted endpoint for both roles without cross-role fallback', async () => {
    const { value } = await authority()
    await value.provision({ revision: 2, endpoints: { FRONT: { host: '172.16.1.9', port: 9100 }, KITCHEN: { host: '172.16.1.9', port: 9100 } } })
    expect(await value.resolve('FRONT')).toEqual(await value.resolve('KITCHEN'))
  })
})
