import { readFile } from 'node:fs/promises'
import path from 'node:path'

const DESKTOP_PRODUCT_DIRECTORY = 'E-Shop 店小二'
const IDENTITY_FILENAME = 'identity.json'
const MAX_IDENTITY_BYTES = 64 * 1024
const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
const DEVICE_SECRET_PATTERN = /^ecc_v1_[A-Za-z0-9_-]{32,128}$/
const STORE_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export type DesktopBindingIdentity = {
  installationId: string
  deviceSecret: string
  bindingState: 'CLOUD_BOUND'
  computerId: string
  storeCode: string
  boundAt: string
}

export class DesktopBindingIdentityError extends Error {
  constructor(public readonly code: string, options?: { cause?: unknown }) {
    super(code, options)
    this.name = 'DesktopBindingIdentityError'
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function desktopBindingIdentityPath(appDataPath: string): string {
  return path.join(appDataPath, DESKTOP_PRODUCT_DIRECTORY, IDENTITY_FILENAME)
}

/** Read-only adapter over the Desktop 0.4.7 ComputerBinding identity. */
export async function readDesktopBindingIdentity(identityPath: string): Promise<DesktopBindingIdentity> {
  let raw: Buffer
  try {
    raw = await readFile(identityPath)
  } catch (cause) {
    throw new DesktopBindingIdentityError('DESKTOP_BINDING_IDENTITY_UNAVAILABLE', { cause })
  }
  if (raw.byteLength === 0 || raw.byteLength > MAX_IDENTITY_BYTES) {
    throw new DesktopBindingIdentityError('DESKTOP_BINDING_IDENTITY_INVALID')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch (cause) {
    throw new DesktopBindingIdentityError('DESKTOP_BINDING_IDENTITY_INVALID', { cause })
  }
  const identity = object(parsed)
  if (!identity) throw new DesktopBindingIdentityError('DESKTOP_BINDING_IDENTITY_INVALID')

  const installationId = typeof identity.installationId === 'string' ? identity.installationId.trim() : ''
  const deviceSecret = typeof identity.deviceSecret === 'string' ? identity.deviceSecret.trim() : ''
  const computerId = typeof identity.cloudComputerId === 'string' ? identity.cloudComputerId.trim() : ''
  const storeCode = typeof identity.cloudStoreCode === 'string' ? identity.cloudStoreCode.trim() : ''
  const boundAt = typeof identity.cloudBoundAt === 'string' ? identity.cloudBoundAt.trim() : ''

  if (
    identity.bindingSource !== 'cloud'
    || !INSTALLATION_ID_PATTERN.test(installationId)
    || !DEVICE_SECRET_PATTERN.test(deviceSecret)
    || computerId.length === 0
    || computerId.length > 128
    || !STORE_CODE_PATTERN.test(storeCode)
    || !boundAt
    || !Number.isFinite(Date.parse(boundAt))
  ) throw new DesktopBindingIdentityError('DESKTOP_BINDING_NOT_ACTIVE')

  return {
    installationId,
    deviceSecret,
    bindingState: 'CLOUD_BOUND',
    computerId,
    storeCode,
    boundAt,
  }
}
