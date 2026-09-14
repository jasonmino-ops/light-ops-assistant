import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAutoFullscreenEnabled, parseConfigFile } from '../src/main/config'

const windowManagerSource = readFileSync(
  join(__dirname, '..', 'src', 'main', 'windowManager.ts'),
  'utf8',
)

function methodBody(source: string, methodName: string): string {
  const start = source.indexOf(`${methodName}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  const brace = source.indexOf('{', start)
  let depth = 0
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(brace, index + 1)
  }
  throw new Error(`missing body for ${methodName}`)
}

describe('P1A fullscreen foundation', () => {
  it('enables automatic fullscreen by default and supports an explicit per-launch opt-out', () => {
    expect(isAutoFullscreenEnabled({})).toBe(true)
    expect(isAutoFullscreenEnabled({ ESHOP_DESKTOP_DISABLE_AUTO_FULLSCREEN: '0' })).toBe(true)
    expect(isAutoFullscreenEnabled({ ESHOP_DESKTOP_DISABLE_AUTO_FULLSCREEN: '1' })).toBe(false)
  })

  it('does not persist the temporary opt-out in config.json', () => {
    const parsed = parseConfigFile(JSON.stringify({ autoFullscreen: false }))
    expect(parsed.autoFullscreen).toBeUndefined()
  })

  it('enters native fullscreen when the authorized employee window is created', () => {
    const body = methodBody(windowManagerSource, 'createEmployeeWindow')
    expect(body).toContain('getConfig().autoFullscreen')
    expect(body).toContain('win.setFullScreen(true)')
  })

  it('never persists physical fullscreen bounds as normal window state', () => {
    const body = methodBody(windowManagerSource, 'saveEmployeeState')
    const fullscreenGuard = body.indexOf('this.employeeWindow.isFullScreen()')
    const boundsRead = body.indexOf('this.employeeWindow.getBounds()')
    expect(fullscreenGuard).toBeGreaterThanOrEqual(0)
    expect(boundsRead).toBeGreaterThan(fullscreenGuard)
  })
})
