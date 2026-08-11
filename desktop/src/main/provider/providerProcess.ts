import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'

export interface ProviderEntryResolutionOptions {
  env?: NodeJS.ProcessEnv
  resourcesPath?: string
  cwd?: string
}

export interface ProviderEntryResolution {
  entryPath: string | null
  source: 'env-entry' | 'env-dir' | 'resources' | 'dev-artifact' | 'missing'
}

export interface SpawnWindowsProviderOptions {
  entryPath: string
  pipeName: string
  supervisorToken: string
  parentPid?: number
  executablePath?: string
  env?: NodeJS.ProcessEnv
  printerName?: string
}

export function generateSupervisorToken(): string {
  return randomBytes(32).toString('base64url')
}

export function resolveWindowsProviderEntry(options: ProviderEntryResolutionOptions = {}): ProviderEntryResolution {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const resourcesPath = options.resourcesPath ?? process.resourcesPath
  const explicitEntry = env.ESHOP_WINDOWS_PROVIDER_ENTRY
  if (explicitEntry) return existsSync(explicitEntry) ? { entryPath: explicitEntry, source: 'env-entry' } : { entryPath: null, source: 'missing' }

  const explicitDir = env.ESHOP_WINDOWS_PROVIDER_DIR
  if (explicitDir) {
    const entryPath = join(explicitDir, 'dist', 'index.js')
    return existsSync(entryPath) ? { entryPath, source: 'env-dir' } : { entryPath: null, source: 'missing' }
  }

  const resourceEntry = join(resourcesPath, 'eshop-windows-provider', 'dist', 'index.js')
  if (existsSync(resourceEntry)) return { entryPath: resourceEntry, source: 'resources' }

  const devEntry = resolve(cwd, '..', 'eshop-windows-provider', 'artifacts', 'eshop-windows-provider', 'dist', 'index.js')
  if (existsSync(devEntry)) return { entryPath: devEntry, source: 'dev-artifact' }

  return { entryPath: null, source: 'missing' }
}

export function spawnWindowsProvider(options: SpawnWindowsProviderOptions): ChildProcessWithoutNullStreams {
  return spawn(options.executablePath ?? process.execPath, [options.entryPath], {
    cwd: dirname(options.entryPath),
    detached: false,
    windowsHide: true,
    env: {
      ...process.env,
      ...options.env,
      ...(options.printerName ? { ESHOP_PRINTER_NAME: options.printerName } : {}),
      ELECTRON_RUN_AS_NODE: '1',
      ESHOP_PROVIDER_PIPE_NAME: options.pipeName,
      ESHOP_PROVIDER_SUPERVISOR_TOKEN: options.supervisorToken,
      ESHOP_PROVIDER_PARENT_PID: String(options.parentPid ?? process.pid),
    },
  })
}
