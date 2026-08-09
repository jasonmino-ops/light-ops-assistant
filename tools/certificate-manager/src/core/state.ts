import { existsSync, readFileSync, rmSync } from 'node:fs'
import type { Env } from './env'
import { eshopStatePath } from './env'
import { atomicWrite } from './fsAtomic'
import type { InstallState } from './types'

export const STATE_SCHEMA = 'eshop.certificate-manager.state/v1'

export function readState(env: Env): InstallState | null {
  const path = eshopStatePath(env)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as InstallState
    if (parsed.schema !== STATE_SCHEMA) return null
    return parsed
  } catch {
    return null
  }
}

export function writeState(env: Env, state: InstallState): void {
  atomicWrite(eshopStatePath(env), `${JSON.stringify(state, null, 2)}\n`)
}

export function clearState(env: Env): void {
  const path = eshopStatePath(env)
  if (existsSync(path)) rmSync(path, { force: true })
}
