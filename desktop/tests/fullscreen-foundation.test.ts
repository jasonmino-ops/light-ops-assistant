import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { isAutoFullscreenEnabled, parseConfigFile } from '../src/main/config'
import { getPersistableEmployeeState } from '../src/main/windowManager'

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: vi.fn(),
  screen: {},
}))

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

  it('skips state persistence while the employee window is fullscreen', () => {
    const getNormalBounds = vi.fn(() => ({ x: 20, y: 30, width: 1200, height: 760 }))
    const state = getPersistableEmployeeState({
      isDestroyed: () => false,
      isFullScreen: () => true,
      getNormalBounds,
    })

    expect(state).toBeNull()
    expect(getNormalBounds).not.toHaveBeenCalled()
  })

  it('uses normal bounds when fullscreen transition state has not settled', () => {
    const normalBounds = { x: 20, y: 30, width: 1200, height: 760 }
    const getNormalBounds = vi.fn(() => normalBounds)
    const state = getPersistableEmployeeState({
      isDestroyed: () => false,
      isFullScreen: () => false,
      getNormalBounds,
    })

    expect(state).toEqual(normalBounds)
    expect(getNormalBounds).toHaveBeenCalledOnce()
  })

  it('skips state persistence after the employee window is destroyed', () => {
    const getNormalBounds = vi.fn(() => ({ x: 20, y: 30, width: 1200, height: 760 }))
    const state = getPersistableEmployeeState({
      isDestroyed: () => true,
      isFullScreen: () => false,
      getNormalBounds,
    })

    expect(state).toBeNull()
    expect(getNormalBounds).not.toHaveBeenCalled()
  })
})
