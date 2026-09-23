import { isAbsolute } from 'node:path'
import { lstat, readFile } from 'node:fs/promises'
import type { V3PrintingRuntime } from './v3PrintingRuntime'

const PREFIX = '--v3-endpoint-provision='
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export async function applyAuthorizedEndpointProvisioning(
  runtime: Pick<V3PrintingRuntime, 'provisionEndpoints'>,
  identity: { storeId: string; deviceId: string },
  argv: readonly string[] = process.argv,
): Promise<boolean> {
  const flags = argv.filter(value => value.startsWith(PREFIX))
  if (flags.length === 0) return false
  if (flags.length !== 1) throw new Error('ENDPOINT_PROVISION_ARGUMENT_INVALID')
  const file = flags[0]!.slice(PREFIX.length)
  if (!file || !isAbsolute(file)) throw new Error('ENDPOINT_PROVISION_PATH_INVALID')
  const stat = await lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('ENDPOINT_PROVISION_FILE_INVALID')
  if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())) {
    throw new Error('ENDPOINT_PROVISION_FILE_NOT_PRIVATE')
  }
  const body = record(JSON.parse(await readFile(file, 'utf8')))
  if (!body || Object.keys(body).sort().join(',') !== 'deviceId,endpoints,revision,schemaVersion,storeId' || body.schemaVersion !== 1 ||
    body.storeId !== identity.storeId || body.deviceId !== identity.deviceId || !Number.isInteger(body.revision)) {
    throw new Error('ENDPOINT_PROVISION_IDENTITY_INVALID')
  }
  await runtime.provisionEndpoints({ revision: Number(body.revision), endpoints: body.endpoints as any })
  return true
}
