import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const rendererPath = join(__dirname, '../src/renderer/activation/activationRenderer.ts')
const activationWindowControllerPath = join(
  __dirname,
  '../src/main/activation/activationWindowController.ts',
)

function compileRenderer(): string {
  return ts.transpileModule(readFileSync(rendererPath, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
    fileName: rendererPath,
    reportDiagnostics: true,
  }).outputText
}

type FakeElement = {
  textContent: string
  hidden: boolean
  disabled: boolean
  value: string
  addEventListener: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
}

function fakeElement(): FakeElement {
  return {
    textContent: '',
    hidden: false,
    disabled: false,
    value: '',
    addEventListener: vi.fn(),
    focus: vi.fn(),
  }
}

describe('activation renderer packaged boot compatibility', () => {
  it('retains the hardened Activation BrowserWindow boundary', () => {
    const controller = readFileSync(activationWindowControllerPath, 'utf8')

    expect(controller).toMatch(/contextIsolation:\s*true/)
    expect(controller).toMatch(/sandbox:\s*true/)
    expect(controller).toMatch(/nodeIntegration:\s*false/)
    expect(controller).toMatch(/webSecurity:\s*true/)
    expect(controller).not.toMatch(/contextIsolation:\s*false/)
    expect(controller).not.toMatch(/sandbox:\s*false/)
    expect(controller).not.toMatch(/nodeIntegration:\s*true/)
    expect(controller).not.toMatch(/webSecurity:\s*false/)
  })

  it('compiles as a classic browser script without CommonJS runtime globals', () => {
    const compiled = compileRenderer()

    expect(compiled).not.toMatch(/\bexports\b/)
    expect(compiled).not.toMatch(/\brequire\s*\(/)
    expect(compiled).not.toMatch(/\bmodule\b/)
    expect(() => new vm.Script(compiled, { filename: 'activationRenderer.js' })).not.toThrow()
  })

  it('initializes through the preload bridge and reveals the unactivated form', async () => {
    const elements = new Map<string, FakeElement>([
      ['#activation-form', fakeElement()],
      ['#store-code', fakeElement()],
      ['#pin', fakeElement()],
      ['#state-title', fakeElement()],
      ['#state-detail', fakeElement()],
      ['#status-code', fakeElement()],
      ['#activate-button', fakeElement()],
      ['#retry-button', fakeElement()],
      ['#reset-button', fakeElement()],
      ['#quit-button', fakeElement()],
      ['#busy', fakeElement()],
    ])
    const state = {
      kind: 'UNACTIVATED',
      storeCodeHint: 'ST169E7000',
      isBusy: false,
      canActivate: true,
      canRetryVerify: false,
      canResetLocal: false,
      canQuit: true,
    }
    const getState = vi.fn(async () => ({ ok: true, state }))
    const onStateChanged = vi.fn(() => vi.fn())
    const windowObject = {
      eshopDesktopActivation: {
        getState,
        activate: vi.fn(),
        retryVerification: vi.fn(),
        resetLocalActivation: vi.fn(),
        quit: vi.fn(),
        onStateChanged,
      },
      addEventListener: vi.fn(),
      confirm: vi.fn(() => false),
    }
    const context = vm.createContext({
      document: {
        querySelector: (selector: string) => elements.get(selector) ?? null,
      },
      window: windowObject,
    })

    new vm.Script(compileRenderer(), { filename: 'activationRenderer.js' }).runInContext(context)
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(onStateChanged).toHaveBeenCalledOnce()
    expect(getState).toHaveBeenCalledOnce()
    expect(elements.get('#state-title')?.textContent).toBe('激活此收银台')
    expect(elements.get('#state-detail')?.textContent).toBe('请输入门店码和老板提供的 6 位 PIN。')
    expect(elements.get('#activation-form')?.hidden).toBe(false)
    expect(elements.get('#store-code')?.value).toBe('ST169E7000')
    expect(elements.get('#store-code')?.disabled).toBe(false)
    expect(elements.get('#pin')?.disabled).toBe(false)
    expect(elements.get('#activate-button')?.disabled).toBe(false)
    expect('exports' in context).toBe(false)
    expect('require' in context).toBe(false)
    expect('module' in context).toBe(false)
  })
})
