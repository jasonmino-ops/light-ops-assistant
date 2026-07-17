import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

function bodyOf(source: string, functionName: string): string {
  const start = source.indexOf(`function ${functionName}`)
  expect(start).toBeGreaterThanOrEqual(0)
  const brace = source.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') depth -= 1
    if (depth === 0) return source.slice(brace, i + 1)
  }
  throw new Error(`missing body for ${functionName}`)
}

describe('activation runtime gate', () => {
  it('keeps formal runtime startup behind startAuthorizedDesktopRuntime', () => {
    const main = read('src/main/main.ts')
    const initialize = bodyOf(main, 'initializeApplication')
    const authorized = bodyOf(main, 'startAuthorizedDesktopRuntime')

    for (const formalCall of [
      'createDefaultHardwareManager()',
      'registerIpcHandlers(windowManager)',
      'windowManager.createEmployeeWindow()',
      "windowManager.ensureCustomerWindow('startup')",
      'windowManager.watchDisplays()',
      'new WindowsProviderSupervisor()',
      'createTray(windowManager',
    ]) {
      expect(initialize).not.toContain(formalCall)
      expect(authorized).toContain(formalCall)
    }
  })

  it('routes second-instance to activation before authorization and employee after authorization', () => {
    const main = read('src/main/main.ts')
    expect(main).toMatch(/activationRuntime\?\.isAuthorized\(\)\)\s*windowManager\.focusEmployeeWindow\(\)/)
    expect(main).toMatch(/else activationWindowController\?\.focus\(\)/)
  })

  it('installs a unified WindowManager formal runtime guard', () => {
    const windowManager = read('src/main/windowManager.ts')
    expect(windowManager).toContain('setFormalRuntimeGuard')
    expect(windowManager).toContain('isFormalRuntimeAllowed')
    for (const method of [
      'employee-window.create',
      'employee-window.focus',
      'customer-window.ensure',
      'customer-window.create',
      'customer-window.recovery',
      'customer-window.toggle',
      'displays.watch',
    ]) {
      expect(windowManager).toContain(method)
    }
  })

  it('does not register formal IPC before activation succeeds', () => {
    const main = read('src/main/main.ts')
    const initialize = bodyOf(main, 'initializeApplication')
    expect(initialize).toContain('registerActivationIpcHandlers')
    expect(initialize).not.toContain('registerIpcHandlers(windowManager)')
  })
})
