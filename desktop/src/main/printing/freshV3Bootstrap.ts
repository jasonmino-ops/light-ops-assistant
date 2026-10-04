import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { CredentialStore } from '../activation/credentialStore'
import type { V3ControlPlaneClient } from './controlPlaneClient'

export type FreshV3BootstrapResult =
  | { status: 'NOT_REQUESTED' }
  | { status: 'LOCAL_LEGACY_STATE'; marker: string }
  | { status: 'SERVER_NOT_ELIGIBLE' }
  | { status: 'BOOTSTRAPPED' }

type FreshV3BootstrapOptions = {
  appDataPath: string
  userDataPath: string
  credentialStore: CredentialStore
  client: V3ControlPlaneClient
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw new Error('FRESH_BOOTSTRAP_LOCAL_STATE_UNREADABLE')
  }
}

/**
 * Local evidence is only an additional deny gate. The server remains the
 * authority and independently proves that no store-scoped legacy/V2 state
 * exists before creating V3_ACTIVE.
 */
export async function attemptFreshV3Bootstrap(options: FreshV3BootstrapOptions): Promise<FreshV3BootstrapResult> {
  const metadata = await options.credentialStore.readMetadata()
  if (metadata?.freshV3BootstrapPending !== true) return { status: 'NOT_REQUESTED' }

  const legacyMarkers = [
    join(options.appDataPath, 'E-Shop 店小二'),
    join(options.appDataPath, 'E-Shop-Network-Print-Addon'),
    join(options.userDataPath, 'v3-printing', 'endpoints.json'),
    join(options.userDataPath, '.execution-ledger.json'),
    join(options.userDataPath, '.execution-outbox.json'),
  ]
  for (const marker of legacyMarkers) {
    if (!(await exists(marker))) continue
    await options.credentialStore.setFreshV3BootstrapPending(false)
    return { status: 'LOCAL_LEGACY_STATE', marker }
  }

  const result = await options.client.bootstrapFresh()
  if (result.ok) {
    await options.credentialStore.setFreshV3BootstrapPending(false)
    return { status: 'BOOTSTRAPPED' }
  }
  if (result.error === 'FRESH_BOOTSTRAP_NOT_ELIGIBLE') {
    await options.credentialStore.setFreshV3BootstrapPending(false)
    return { status: 'SERVER_NOT_ELIGIBLE' }
  }
  // Do not fall through to GET: that would create the legacy-safe V2 default
  // and permanently consume a truly fresh enrollment after a transient error.
  throw new Error(`FRESH_V3_BOOTSTRAP_UNAVAILABLE:${result.error}`)
}
