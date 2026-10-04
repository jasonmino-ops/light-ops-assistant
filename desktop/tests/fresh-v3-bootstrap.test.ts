import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attemptFreshV3Bootstrap } from '../src/main/printing/freshV3Bootstrap'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function fixture(pending = true) {
  const root = await mkdtemp(join(os.tmpdir(), 'fresh-v3-bootstrap-'))
  roots.push(root)
  let metadata = { schemaVersion: 1 as const, freshV3BootstrapPending: pending }
  const credentialStore = {
    readMetadata: vi.fn(async () => metadata),
    setFreshV3BootstrapPending: vi.fn(async (value: boolean) => { metadata = { ...metadata, freshV3BootstrapPending: value } }),
  }
  const client = { bootstrapFresh: vi.fn(async () => ({ ok: true as const, controlPlane: {} })) }
  return { root, credentialStore, client, options: {
    appDataPath: root,
    userDataPath: join(root, 'eshop-desktop'),
    credentialStore: credentialStore as any,
    client: client as any,
  } }
}

describe('fresh V3 bootstrap client gate', () => {
  it('requests bootstrap only for a pending new activation and clears the marker after success', async () => {
    const value = await fixture()
    await expect(attemptFreshV3Bootstrap(value.options)).resolves.toEqual({ status: 'BOOTSTRAPPED' })
    expect(value.client.bootstrapFresh).toHaveBeenCalledTimes(1)
    expect(value.credentialStore.setFreshV3BootstrapPending).toHaveBeenCalledWith(false)
  })

  it('preserves legacy machines locally without calling the fresh transition', async () => {
    const value = await fixture()
    await mkdir(join(value.root, 'E-Shop 店小二'), { recursive: true })
    await expect(attemptFreshV3Bootstrap(value.options)).resolves.toMatchObject({ status: 'LOCAL_LEGACY_STATE' })
    expect(value.client.bootstrapFresh).not.toHaveBeenCalled()
    expect(value.credentialStore.setFreshV3BootstrapPending).toHaveBeenCalledWith(false)
  })

  it('does not consume pending enrollment or fall through to legacy GET on transient bootstrap failure', async () => {
    const value = await fixture()
    value.client.bootstrapFresh.mockResolvedValue({ ok: false as const, error: 'CONTROL_PLANE_NETWORK_ERROR' } as any)
    await expect(attemptFreshV3Bootstrap(value.options)).rejects.toThrow('FRESH_V3_BOOTSTRAP_UNAVAILABLE')
    expect(value.credentialStore.setFreshV3BootstrapPending).not.toHaveBeenCalled()
  })

  it('does nothing for credentials that predate the explicit fresh-enrollment marker', async () => {
    const value = await fixture(false)
    await expect(attemptFreshV3Bootstrap(value.options)).resolves.toEqual({ status: 'NOT_REQUESTED' })
    expect(value.client.bootstrapFresh).not.toHaveBeenCalled()
  })

  it('fails closed when local installation evidence cannot be inspected', async () => {
    const value = await fixture()
    const invalidPath = join(value.root, '\0-unreadable')
    const options = { ...value.options, appDataPath: invalidPath }
    await expect(attemptFreshV3Bootstrap(options)).rejects.toThrow('FRESH_BOOTSTRAP_LOCAL_STATE_UNREADABLE')
    expect(value.client.bootstrapFresh).not.toHaveBeenCalled()
    expect(value.credentialStore.setFreshV3BootstrapPending).not.toHaveBeenCalled()
  })
})
