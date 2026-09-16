import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { customerUrl, employeeUrl, type DesktopConfig } from '../src/main/config'

const desktopRoot = join(__dirname, '..')
const read = (path: string) => readFileSync(join(desktopRoot, path), 'utf8')

const config: DesktopConfig = {
  baseUrl: 'https://elifekh.com',
  storeCode: '',
  lang: 'zh',
  forceCustomerWindow: false,
  autoFullscreen: true,
}

describe('authorized Desktop launch context', () => {
  it('installs verified device context before either formal window is created', () => {
    const source = read('src/main/main.ts')
    const setContext = source.indexOf('windowManager.setAuthorizedLaunchContext({ storeCode: context.device.storeCode })')
    const createEmployee = source.indexOf('windowManager.createEmployeeWindow()', setContext)
    const ensureCustomer = source.indexOf("windowManager.ensureCustomerWindow('startup')", setContext)

    expect(source).not.toContain('startAuthorizedDesktopRuntime(_context')
    expect(setContext).toBeGreaterThanOrEqual(0)
    expect(createEmployee).toBeGreaterThan(setContext)
    expect(ensureCustomer).toBeGreaterThan(setContext)
  })

  it('builds the first-Activation and credential-restore employee POS URL from verified storeCode', () => {
    const verifiedConfig = { ...config, storeCode: 'ST169E7000' }
    expect(employeeUrl(verifiedConfig)).toBe(
      'https://elifekh.com/desktop/pos?storeCode=ST169E7000&lang=zh&mode=pos',
    )
  })

  it('uses the same verified store context for Customer Display', () => {
    const verifiedConfig = { ...config, storeCode: 'ST169E7000' }
    expect(customerUrl(verifiedConfig)).toBe(
      'https://elifekh.com/desktop/display?storeCode=ST169E7000&lang=zh',
    )
  })

  it('keeps the existing non-authorized config URL behavior unchanged', () => {
    expect(employeeUrl(config)).toBe('https://elifekh.com/desktop?lang=zh')
    expect(employeeUrl({ ...config, storeCode: 'LEGACY-STORE' })).toBe(
      'https://elifekh.com/desktop/pos?storeCode=LEGACY-STORE&lang=zh&mode=pos',
    )
  })

  it('binds both WindowManager URL builders to the in-memory authorized context', () => {
    const source = read('src/main/windowManager.ts')
    expect(source).toContain('private authorizedLaunchContext: AuthorizedLaunchContext | null = null')
    expect(source).toContain('{ ...config, storeCode: this.authorizedLaunchContext.storeCode }')
    expect(source).toContain('employeeUrl(this.launchConfig())')
    expect(source).toContain('customerUrl(this.launchConfig())')
    expect(source).not.toMatch(/writeFileSync\([^)]*authorizedLaunchContext/s)
  })
})
