import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, lstat, realpath } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { ShortcutLifecycle } from '../../e-shop-tray/network-addon/shortcutLifecycle'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

// Exercise the actual Add-on factory + actual durable shortcut lifecycle.
// Only Windows/Electron native ports are substituted; NSIS check paths are
// read independently from its actual two verification macros. This catches
// cross-component path mismatch even when an OS-effects VM agrees with NSIS.
async function fixture() {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'rc2-shortcut-contract-')); roots.push(root)
  const programs = path.join(root, 'Programs'), desktop = path.join(root, 'Desktop'), appData = path.join(root, 'Roaming')
  const addon = path.join(root, 'Addon'), modern = path.join(root, 'Modern')
  for (const directory of [programs, desktop, appData, addon, modern]) await mkdir(directory)
  const executable = path.join(addon, 'E-Shop-Network-Print-Addon.exe'), uninstaller = path.join(addon, 'Uninstall E-Shop-Network-Print-Addon.exe')
  const modernExe = path.join(modern, 'E-Shop Desktop.exe')
  for (const file of [executable, uninstaller, modernExe]) await writeFile(file, 'native executable verified by Windows adapter port')
  const filename = path.resolve(__dirname, '../../e-shop-tray/network-addon/main.ts'), raw = await readFile(filename, 'utf8')
  const source = ts.createSourceFile(filename, raw, ts.ScriptTarget.ES2022, true)
  const declarations = source.statements.filter(node =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'shortcutManager'
      || ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === 'USER_DATA'))
  expect(declarations).toHaveLength(2)
  const code = ts.transpileModule(declarations.map(node => node.getText(source)).join('\n') + '\nshortcutManager',
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const assertNormalShortcutDirectory = async (file: string) => { const entry = await lstat(file); if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('UNSAFE_FIXTURE_DIRECTORY') }
  const context = { path, mkdir, ShortcutLifecycle, process: { execPath: executable },
    app: { getPath: (name: string) => name === 'appData' ? appData : name === 'desktop' ? desktop : (() => { throw new Error('UNEXPECTED_PATH') })() },
    readShortcutRegistration: async () => ({ programs, registrations: [] }),
    networkUninstaller: async () => uninstaller, desktopRegistration: vi.fn(async () => null), networkRegistration: async () => null,
    managedDesktopRegistration: async () => ({ source: 'windows-registry', hive: 'HKCU', registryKey: 'Software\\be247cb9-f9cd-575f-b032-177e26afd518',
      appId: 'com.eshop.desktop', version: '0.3.0-rc.6', installLocation: modern, executable: modernExe, shortcutName: 'E-Shop Desktop', executableVerified: true }),
    assertNormalShortcutDirectory, assertNormalShortcutFile: async (file: string) => { if (!(await lstat(file)).isFile()) throw new Error('UNSAFE_FIXTURE_FILE') },
    protectNetworkDirectory: vi.fn(async () => {}), shell: {
      readShortcutLink: (file: string) => JSON.parse(readFileSync(file, 'utf8')),
      writeShortcutLink: (file: string, _operation: string, spec: unknown) => { writeFileSync(file, JSON.stringify(spec)); return true },
    } }
  const factory = runInNewContext(code, context, { filename, timeout: 1000 }) as (managed: boolean) => Promise<ShortcutLifecycle>
  const manager = await factory(true)
  async function publicLinks() {
    const links: string[] = []
    async function walk(directory: string) { for (const item of await readdir(directory, { withFileTypes: true })) { const file = path.join(directory, item.name); if (item.isDirectory()) await walk(file); else if (item.name.endsWith('.lnk')) links.push(file) } }
    await walk(desktop); await walk(programs); return links.sort()
  }
  const nsis = await readFile(path.resolve(__dirname, '../build/installer.nsh'), 'utf8')
  function checkedPaths(macro: string) {
    const body = nsis.split(`!macro ${macro}\n`)[1].split('!macroend')[0]
    return [...body.matchAll(/IfFileExists "(\$(?:SMPROGRAMS|DESKTOP)\\[^"\n]+\.lnk)"/g)]
      .map(([, file]) => file.replace('$SMPROGRAMS', programs).replace('$DESKTOP', desktop).replaceAll('\\', path.sep)).sort()
  }
  return { manager, publicLinks, checkedPaths, context }
}

describe('actual NSIS / Add-on shortcut path contract', () => {
  it('accepts precisely the management/uninstall entries produced by actual prerequisite code', async () => {
    const f = await fixture()
    for (const role of ['manage', 'uninstall'] as const) expect((await f.manager.ensure(role)).status).toBe('CREATED')
    expect(f.checkedPaths('eshopVerifyAddonPrerequisite')).toEqual(await f.publicLinks())
    expect(f.context.desktopRegistration).not.toHaveBeenCalled()
  })
  it('accepts all four actual final entries including modern binding under the maintenance directory', async () => {
    const f = await fixture()
    for (const role of ['cashier', 'manage', 'desktop-binding', 'uninstall'] as const) expect((await f.manager.ensure(role)).status).toBe('CREATED')
    expect(f.checkedPaths('eshopVerifyManagedAddonLifecycle')).toEqual(await f.publicLinks())
    expect(f.context.desktopRegistration).not.toHaveBeenCalled()
  })
})
