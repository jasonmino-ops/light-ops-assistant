import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { beforeAll, describe, expect, it, vi } from 'vitest'

type CompileRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string
    stdio: 'pipe'
    encoding: 'utf8'
    timeout: number
    shell: false
  },
) => string | Buffer

type FakeElement = {
  textContent: string
  hidden: boolean
  disabled: boolean
  value: string
  onclick: (() => void) | null
  focus: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
}

const desktopRoot = join(__dirname, '..')
const rendererJsPath = join(desktopRoot, 'dist/renderer/activation/activationRenderer.js')
const rendererHtmlPath = join(desktopRoot, 'dist/renderer/activation/index.html')
const preloadJsPath = join(desktopRoot, 'dist/preload/activationPreload.js')

function resolveNpmCommand(platform: NodeJS.Platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm'
}

function runDesktopCompile(runner: CompileRunner = execFileSync, platform: NodeJS.Platform = process.platform) {
  runner(resolveNpmCommand(platform), ['run', 'compile'], {
    cwd: desktopRoot,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 120_000,
    shell: false,
  })
}

function makeElement(): FakeElement {
  return {
    textContent: '',
    hidden: false,
    disabled: false,
    value: '',
    onclick: null,
    focus: vi.fn(),
    addEventListener: vi.fn(),
  }
}

function makeDom() {
  const elements = new Map<string, FakeElement>()
  for (const selector of [
    '#activation-form',
    '#store-code',
    '#pin',
    '#state-title',
    '#state-detail',
    '#status-code',
    '#activate-button',
    '#retry-button',
    '#reset-button',
    '#quit-button',
    '#busy',
  ]) {
    elements.set(selector, makeElement())
  }
  return {
    elements,
    document: {
      querySelector: vi.fn((selector: string) => elements.get(selector) ?? null),
    },
  }
}

function activationState(kind = 'UNACTIVATED') {
  return {
    kind,
    isBusy: kind === 'BOOTING',
    canActivate: kind === 'UNACTIVATED',
    canRetryVerify: false,
    canResetLocal: false,
    canQuit: true,
    storeCodeHint: 'STORE-A',
  }
}

async function flushAsyncRendererWork() {
  await Promise.resolve()
  await new Promise((resolve) => setImmediate(resolve))
}

function checkpointStages(checkpoints: unknown[]) {
  return checkpoints.map((checkpoint) => (checkpoint as { stage?: string }).stage)
}

describe('compiled activation renderer bootstrap', () => {
  beforeAll(() => {
    runDesktopCompile()
  })

  it('resolves npm command portably without shell execution', () => {
    expect(resolveNpmCommand('win32')).toBe('npm.cmd')
    expect(resolveNpmCommand('darwin')).toBe('npm')
    expect(resolveNpmCommand('linux')).toBe('npm')

    const runner = vi.fn<CompileRunner>(() => '')
    runDesktopCompile(runner, 'win32')

    expect(runner).toHaveBeenCalledWith('npm.cmd', ['run', 'compile'], {
      cwd: desktopRoot,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 120_000,
      shell: false,
    })
  })

  it('propagates npm compile failures instead of hiding status or ENOENT', () => {
    const nonZero = new Error('compile failed with exit code 1')
    const enoent = Object.assign(new Error('spawnSync npm ENOENT'), { code: 'ENOENT' })

    expect(() => runDesktopCompile(() => {
      throw nonZero
    }, 'linux')).toThrow(nonZero)
    expect(() => runDesktopCompile(() => {
      throw enoent
    }, 'win32')).toThrow(enoent)
  })

  it('emits browser-compatible classic script output for activationRenderer.js', () => {
    const html = readFileSync(rendererHtmlPath, 'utf8')
    const source = readFileSync(rendererJsPath, 'utf8')
    const preload = readFileSync(preloadJsPath, 'utf8')

    expect(html).toContain('<script src="./activationRenderer.js"></script>')
    expect(html).not.toMatch(/<script[^>]+type=["']module["']/i)
    expect(source).not.toMatch(/Object\.defineProperty\(exports|exports\.__esModule|\bexports\b|\brequire\s*\(|module\.exports/)
    expect(source).not.toMatch(/import\s+[\w{*]/)
    expect(preload).toContain('contextBridge.exposeInMainWorld')
  })

  it('executes the compiled renderer without Node globals and renders UNACTIVATED', async () => {
    const source = readFileSync(rendererJsPath, 'utf8')
    const { elements, document } = makeDom()
    const checkpoints: unknown[] = []
    const consoleError = vi.fn()
    const windowListeners = new Map<string, ((event?: unknown) => void)[]>()
    const context = vm.createContext({
      document,
      console: { error: consoleError },
      setTimeout,
      clearTimeout,
      window: {
        confirm: vi.fn(() => true),
        location: { reload: vi.fn() },
        addEventListener: vi.fn((event: string, listener: (event?: unknown) => void) => {
          windowListeners.set(event, [...(windowListeners.get(event) ?? []), listener])
        }),
        eshopDesktopActivation: {
          getState: vi.fn(async () => ({ ok: true, state: activationState() })),
          activate: vi.fn(),
          retryVerification: vi.fn(),
          resetLocalActivation: vi.fn(),
          quit: vi.fn(),
          onStateChanged: vi.fn(() => vi.fn()),
          reportStartupCheckpoint: vi.fn(async (checkpoint: unknown) => {
            checkpoints.push(checkpoint)
            return { ok: true }
          }),
        },
      },
    })

    expect(() => vm.runInContext(source, context, { filename: 'activationRenderer.js' })).not.toThrow()
    await flushAsyncRendererWork()

    expect(consoleError).not.toHaveBeenCalled()
    expect(checkpointStages(checkpoints)).toEqual([
      'script-started',
      'bridge-detected',
      'subscribed',
      'get-state-started',
      'get-state-succeeded',
      'rendered',
    ])
    expect(elements.get('#state-title')?.textContent).toBe('激活此收银台')
    expect(elements.get('#activation-form')?.hidden).toBe(false)
    expect(elements.get('#store-code')?.value).toBe('STORE-A')
  })

  it('keeps compiled bootstrap fallback visible when DOM initialization fails', async () => {
    const source = readFileSync(rendererJsPath, 'utf8')
    const { elements, document } = makeDom()
    elements.delete('#activation-form')
    const checkpoints: unknown[] = []
    const context = vm.createContext({
      document,
      console: { error: vi.fn() },
      setTimeout,
      clearTimeout,
      window: {
        confirm: vi.fn(() => true),
        location: { reload: vi.fn() },
        addEventListener: vi.fn(),
        eshopDesktopActivation: {
          getState: vi.fn(),
          activate: vi.fn(),
          retryVerification: vi.fn(),
          resetLocalActivation: vi.fn(),
          quit: vi.fn(),
          onStateChanged: vi.fn(),
          reportStartupCheckpoint: vi.fn(async (checkpoint: unknown) => {
            checkpoints.push(checkpoint)
            return { ok: true }
          }),
        },
      },
    })

    expect(() => vm.runInContext(source, context, { filename: 'activationRenderer.js' })).not.toThrow()
    await flushAsyncRendererWork()

    expect(checkpointStages(checkpoints)).toEqual([
      'script-started',
      'bridge-detected',
      'startup-error',
    ])
    expect(elements.get('#state-title')?.textContent).toBe('启动失败')
    expect(elements.get('#status-code')?.textContent).toBe('状态: ACTIVATION_RENDERER_INIT_FAILED')
  })
})
