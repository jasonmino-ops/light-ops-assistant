import { createHash } from 'node:crypto'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'

export interface BuildProviderPipeNameOptions {
  suffix?: string
  sessionScope?: string
  platform?: NodeJS.Platform
}

function sanitize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'session'
}

export function stableProviderSessionScope(): string {
  const basis = `${process.env.SESSIONNAME ?? ''}|${process.env.USERNAME ?? ''}|${process.env.USER ?? userInfo().username}|${homedir()}`
  return createHash('sha256').update(basis).digest('hex').slice(0, 16)
}

export function buildWindowsProviderPipeName(options: BuildProviderPipeNameOptions = {}): string {
  const platform = options.platform ?? process.platform
  const scope = sanitize(options.sessionScope ?? stableProviderSessionScope())
  const suffix = options.suffix ? `-${sanitize(options.suffix)}` : ''
  const baseName = `eshop-windows-provider-v1-${scope}${suffix}`
  if (platform === 'win32') return `\\\\.\\pipe\\${baseName}`
  return join(tmpdir(), `eshop-wp-v1-${scope.slice(0, 12)}${suffix.slice(0, 18)}.sock`)
}

export function safePipeIdentifier(pipeName: string): string {
  return createHash('sha256').update(pipeName).digest('hex').slice(0, 16)
}
