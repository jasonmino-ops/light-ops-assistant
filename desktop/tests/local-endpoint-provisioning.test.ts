import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAuthorizedEndpointProvisioning } from '../src/main/printing/localEndpointProvisioning'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))
async function fixture(value: unknown) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'endpoint-provision-')); roots.push(root)
  const file = path.join(root, 'provision.json')
  await writeFile(file, JSON.stringify(value), { mode: 0o600 }); await chmod(file, 0o600)
  return file
}

describe('authorized endpoint provisioning path', () => {
  it('does nothing without an explicit internal command flag', async () => {
    const runtime = { provisionEndpoints: vi.fn() }
    expect(await applyAuthorizedEndpointProvisioning(runtime, { storeId: 'store-a', deviceId: 'device-a' }, [])).toBe(false)
    expect(runtime.provisionEndpoints).not.toHaveBeenCalled()
  })

  it('applies one exact identity-bound private file without exposing a renderer API', async () => {
    const file = await fixture({ schemaVersion: 1, storeId: 'store-a', deviceId: 'device-a', revision: 4,
      endpoints: { FRONT: { host: '192.168.1.20', port: 9100 } } })
    const runtime = { provisionEndpoints: vi.fn(async () => undefined) }
    expect(await applyAuthorizedEndpointProvisioning(runtime, { storeId: 'store-a', deviceId: 'device-a' }, [`--v3-endpoint-provision=${file}`])).toBe(true)
    expect(runtime.provisionEndpoints).toHaveBeenCalledWith({ revision: 4, endpoints: { FRONT: { host: '192.168.1.20', port: 9100 } } })
  })

  it('rejects another store/device and non-private files', async () => {
    const file = await fixture({ schemaVersion: 1, storeId: 'store-b', deviceId: 'device-a', revision: 1, endpoints: {} })
    const runtime = { provisionEndpoints: vi.fn() }
    await expect(applyAuthorizedEndpointProvisioning(runtime, { storeId: 'store-a', deviceId: 'device-a' }, [`--v3-endpoint-provision=${file}`]))
      .rejects.toThrow('ENDPOINT_PROVISION_IDENTITY_INVALID')
    if (process.platform !== 'win32') {
      await chmod(file, 0o644)
      await expect(applyAuthorizedEndpointProvisioning(runtime, { storeId: 'store-b', deviceId: 'device-a' }, [`--v3-endpoint-provision=${file}`]))
        .rejects.toThrow('ENDPOINT_PROVISION_FILE_NOT_PRIVATE')
    }
  })
})
