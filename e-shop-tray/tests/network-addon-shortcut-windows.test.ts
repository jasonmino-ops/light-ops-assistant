import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { parseShortcutRegistration } from '../network-addon/shortcutWindows'

const row = { hive: 'CurrentUser', id: '1acbd53d-b2f7-5af7-b432-3048068fa60f',
  location: 'C:\\Users\\Cashier\\Apps\\Desktop', shortcut: 'E-Shop', version: '0.4.7',
  uninstall: '"C:\\Users\\Cashier\\Apps\\Desktop\\Uninstall E-Shop 店小二.exe" /currentuser' }
const payload = (change = {}) => JSON.stringify({ programs: 'C:\\Users\\Cashier\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs', registrations: [row], ...change })

describe('fixed Windows shortcut registration reader', () => {
  it('accepts exact product records, current-user Known Folder and both legitimate install hives', () => {
    expect(parseShortcutRegistration(payload()).registrations[0]).toMatchObject({ hive: 'HKCU', version: '0.4.7' })
    expect(parseShortcutRegistration(payload({ registrations: [{ ...row, hive: 'LocalMachine' }] })).registrations[0].hive).toBe('HKLM')
    expect(parseShortcutRegistration(payload({ registrations: [] })).registrations).toEqual([])
  })
  it('rejects arbitrary keys, oversized output, partial registration and nonlocal/noncanonical paths', () => {
    for (const change of [{ other: true }, { registrations: null }, { registrations: Array(9).fill(row) },
      { registrations: [{ ...row, id: 'other-product' }] }, { registrations: [{ ...row, hive: 'ClassesRoot' }] },
      { registrations: [{ ...row, location: null }] }, { registrations: [{ ...row, version: null }] }]) {
      expect(() => parseShortcutRegistration(payload(change))).toThrow()
    }
    for (const invalid of ['\\\\host\\share', 'C:\\one\\..\\two', 'relative', 'C:\\Apps\\', 'C:\\a*b', 'C:\\a?b',
      'C:\\a\0b', 'C:\\a\nb', 'C:\\a\rb', 'C:\\a\tb', 'C:\\a\u0001b', 'C:\\a\u001fb']) {
      expect(() => parseShortcutRegistration(payload({ programs: invalid }))).toThrow()
      expect(() => parseShortcutRegistration(payload({ registrations: [{ ...row, location: invalid }] }))).toThrow()
    }
    expect(() => parseShortcutRegistration(' '.repeat(32769))).toThrow()
  })
  it('uses bounded read-only fixed cmdlets without security-policy changes or registry writes', async () => {
    const source = await readFile(path.join(__dirname, '../network-addon/shortcutWindows.ts'), 'utf8')
    expect(source).toContain("['-NoProfile', '-NonInteractive', '-Command', SCRIPT]")
    expect(source).toContain('timeout: 10000, maxBuffer: 32768')
    expect(source).toContain("[Environment]::GetFolderPath('Programs')")
    expect(source).toContain('readUInt16LE(4) !== 0x8664')
    expect(source).toContain('packaged.name !== packageName || packaged.version !== version')
    expect(source).not.toMatch(/ExecutionPolicy|Set-Item|SetValue|DeleteValue|Invoke-Expression|shell: true|deviceSecret/)
  })
})

async function compiledFunctions(file: string, names: string[], constants: string[] = []) {
  const filename = path.join(__dirname, '../network-addon', file), source = await readFile(filename, 'utf8')
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const statements = [...constants.map(name => {
    const matches = parsed.statements.filter(statement => ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name))
    expect(matches).toHaveLength(1)
    return matches[0]
  }), ...names.map(name => {
    const matches = parsed.statements.filter(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name)
    expect(matches).toHaveLength(1)
    return matches[0]
  })]
  // Execute real declarations selected by TS AST, never a copied initializer
  // or a source substring assertion. Only filesystem/native/Electron ports
  // are substituted, so changes in await order affect these tests directly.
  const compiled = ts.transpileModule(`${statements.map(statement => statement.getText(parsed)).join('\n')}\n${names.at(-1)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: filename,
  }).outputText
  return { compiled, filename }
}

async function shortcutManagerFixture(blocked?: 'appData' | 'userData', existingUserData = false) {
  const source = await compiledFunctions('main.ts', ['shortcutManager'], ['USER_DATA'])
  const appData = 'C:\\Users\\Cashier\\AppData\\Roaming', desktop = 'C:\\Users\\Cashier\\Desktop'
  const userData = path.win32.join(appData, 'E-Shop-Network-Print-Addon'), directory = path.win32.join(userData, 'shortcuts')
  const programs = path.win32.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  const trace: Array<[string, string]> = []
  const mkdir = vi.fn(async (file: string) => {
    trace.push(['mkdir', file])
    if (existingUserData && file === userData) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
  })
  const assertNormalShortcutDirectory = vi.fn(async (file: string) => {
    trace.push(['validate', file])
    if (file === (blocked === 'appData' ? appData : blocked === 'userData' ? userData : undefined)) throw new Error('SHORTCUT_UNSAFE_DIRECTORY')
  })
  const protectNetworkDirectory = vi.fn(async (file: string) => { trace.push(['protect', file]) })
  const assertNormalShortcutFile = vi.fn(async (_file: string) => {})
  const ShortcutLifecycle = vi.fn(function (_options: unknown) {})
  const context = { path: path.win32, Error, process: { execPath: 'C:\\Network\\E-Shop-Network-Print-Addon.exe' },
    app: { getPath(name: string) { if (name === 'appData') return appData; if (name === 'desktop') return desktop; throw new Error('unexpected app path') } },
    readShortcutRegistration: vi.fn(async () => ({ programs, registrations: [] })),
    networkUninstaller: vi.fn(async () => undefined), desktopRegistration: vi.fn(async () => null), networkRegistration: vi.fn(async () => null),
    mkdir, assertNormalShortcutDirectory, assertNormalShortcutFile, protectNetworkDirectory, ShortcutLifecycle,
    shell: { readShortcutLink: vi.fn(), writeShortcutLink: vi.fn() } }
  const shortcutManager = runInNewContext(source.compiled, context, { filename: source.filename, timeout: 1000 }) as () => Promise<unknown>
  return { shortcutManager, appData, userData, directory, programs, trace, ...context }
}

describe('actual shortcutManager initialization and ACL ordering', () => {
  it.each(['appData', 'userData'] as const)('does not create shortcuts or invoke ACL protection if native %s ancestry validation rejects', async blocked => {
    const f = await shortcutManagerFixture(blocked)
    await expect(f.shortcutManager()).rejects.toThrow('SHORTCUT_UNSAFE_DIRECTORY')
    expect(f.protectNetworkDirectory).not.toHaveBeenCalled()
    expect(f.mkdir.mock.calls.map(([file]) => file)).not.toContain(f.directory)
    expect(f.ShortcutLifecycle).not.toHaveBeenCalled()
    if (blocked === 'appData') expect(f.mkdir.mock.calls.map(([file]) => file)).not.toContain(f.userData)
  })
  it.each([false, true])('validates appData, USER_DATA and shortcuts before ACL protection and revalidates afterwards (existing USER_DATA=%s)', async existing => {
    const f = await shortcutManagerFixture(undefined, existing)
    await f.shortcutManager()
    expect(f.trace.filter(([, file]) => [f.appData, f.userData, f.directory].includes(file))).toEqual([
      ['validate', f.appData], ['mkdir', f.userData], ['validate', f.userData],
      ['mkdir', f.directory], ['validate', f.directory], ['protect', f.directory], ['validate', f.directory],
    ])
    expect(f.protectNetworkDirectory).toHaveBeenCalledTimes(1)
    expect(f.ShortcutLifecycle).toHaveBeenCalledWith(expect.objectContaining({ directory: f.directory,
      startMenuDirectory: path.win32.join(f.programs, '店小二', '管理与维护'),
      assertNormalDirectory: f.assertNormalShortcutDirectory, assertNormalFile: f.assertNormalShortcutFile }))
  })
})

async function executableFixture(blocked?: 'executable' | 'archive') {
  const source = await compiledFunctions('shortcutWindows.ts', ['fail', 'localPath', 'physicalFs', 'regularLocal', 'verifyExecutable'])
  const executable = 'C:\\Programs\\Original Desktop\\E-Shop 店小二.exe'
  const archive = path.win32.join(path.win32.dirname(executable), 'resources', 'app.asar')
  const trace: Array<[string, string]> = []
  const assertNormalShortcutFile = vi.fn(async (file: string) => {
    trace.push(['native-file', file])
    if (file === (blocked === 'executable' ? executable : blocked === 'archive' ? archive : undefined)) throw new Error('SHORTCUT_UNSAFE_DIRECTORY')
  })
  const lstat = vi.fn(async (_file: string) => ({ isSymbolicLink: () => false, isFile: () => true }))
  const realpath = vi.fn(async (file: string) => file)
  const close = vi.fn(async () => {})
  const read = vi.fn(async (buffer: Buffer, _offset: number, length: number, position: number) => {
    if (position === 0) { buffer.writeUInt16LE(0x5a4d, 0); buffer.writeUInt32LE(128, 60) }
    else { expect(position).toBe(128); buffer.writeUInt32LE(0x4550, 0); buffer.writeUInt16LE(0x8664, 4) }
    return { bytesRead: length, buffer }
  })
  const open = vi.fn(async (file: string) => { trace.push(['open', file]); return { read, close } })
  const readFile = vi.fn(async (file: string) => {
    trace.push(['metadata-read', file])
    return JSON.stringify({ name: 'eshop-desktop-prototype', version: '0.4.7' })
  })
  const asarAwareLstat = vi.fn(async () => { throw new Error('ASAR_AWARE_FS_MUST_NOT_VALIDATE_PHYSICAL_FILES') })
  const context = { path: { ...path.win32, win32: path.win32 }, Error, Buffer, assertNormalShortcutFile,
    require: (name: string) => name === 'original-fs' ? { promises: { lstat, realpath, open } } : (() => { throw new Error('unexpected import') })(),
    lstat: asarAwareLstat, realpath, open, readFile }
  const verifyExecutable = runInNewContext(source.compiled, context, { filename: source.filename, timeout: 1000 }) as (file: string, name: string, version: string) => Promise<void>
  return { verifyExecutable, executable, archive, trace, close, read, physicalLstat: lstat, asarAwareLstat, ...context }
}

describe('actual executable and ASAR native file validation', () => {
  it('does not open/read a program after regularLocal native file validation rejects it', async () => {
    const f = await executableFixture('executable')
    await expect(f.verifyExecutable(f.executable, 'eshop-desktop-prototype', '0.4.7')).rejects.toThrow('SHORTCUT_UNSAFE_DIRECTORY')
    expect(f.assertNormalShortcutFile.mock.calls).toEqual([[f.executable]])
    expect(f.physicalLstat).not.toHaveBeenCalled(); expect(f.realpath).not.toHaveBeenCalled()
    expect(f.open).not.toHaveBeenCalled(); expect(f.readFile).not.toHaveBeenCalled()
  })
  it('does not read packaged metadata after regularLocal native file validation rejects the ASAR', async () => {
    const f = await executableFixture('archive')
    await expect(f.verifyExecutable(f.executable, 'eshop-desktop-prototype', '0.4.7')).rejects.toThrow('SHORTCUT_UNSAFE_DIRECTORY')
    expect(f.assertNormalShortcutFile.mock.calls).toEqual([[f.executable], [f.archive]])
    expect(f.open.mock.calls).toEqual([[f.executable, 'r']])
    expect(f.read).toHaveBeenCalledTimes(2); expect(f.close).toHaveBeenCalledTimes(1)
    expect(f.physicalLstat.mock.calls.map(([file]) => file)).not.toContain(f.archive)
    expect(f.readFile).not.toHaveBeenCalled()
  })
  it('checks both ordinary file paths before opening the executable or reading its packaged metadata', async () => {
    const f = await executableFixture()
    await f.verifyExecutable(f.executable, 'eshop-desktop-prototype', '0.4.7')
    expect(f.trace).toEqual([
      ['native-file', f.executable], ['open', f.executable], ['native-file', f.archive],
      ['metadata-read', path.win32.join(f.archive, 'package.json')],
    ])
    expect(f.asarAwareLstat).not.toHaveBeenCalled()
  })
})

describe('actual packaged uninstaller registration', () => {
  it('accepts the builder hyphenated basename and rejects other executable names or arguments before IO', async () => {
    const source = await compiledFunctions('shortcutWindows.ts', ['fail', 'localPath', 'uniqueRow', 'networkUninstaller'], ['NETWORK_KEY'])
    const executable = 'C:\\Users\\Cashier\\Apps\\Network\\E-Shop-Network-Print-Addon.exe'
    const location = path.win32.dirname(executable), file = path.win32.join(location, 'Uninstall E-Shop-Network-Print-Addon.exe')
    const regularLocal = vi.fn(async (_file: string) => {})
    const fn = runInNewContext(source.compiled, { exports: {}, path: { ...path.win32, win32: path.win32 }, Error, regularLocal }, { timeout: 1000 })
    const snapshot = (uninstall: string) => ({ registrations: [{ hive: 'HKCU', id: '3b0d00d3-14c9-55d6-bef2-f6474bb2de71', location, uninstall }] })
    await expect(fn(snapshot(`"${file}" /currentuser`), executable)).resolves.toBe(file)
    for (const invalid of [`"${path.win32.join(location, 'other.exe')}" /currentuser`, `"${file}" /allusers`, `"${file}" /currentuser /extra`]) {
      await expect(fn(snapshot(invalid), executable)).rejects.toThrow()
    }
    expect(regularLocal.mock.calls).toEqual([[file]])
  })
})

describe('required entry readiness without automatic public Desktop migration', () => {
  it('requires the four Network entries but treats retained legacy links only as manual-review warnings', async () => {
    const file = path.join(__dirname, '../network-addon/main.ts'), source = await readFile(file, 'utf8')
    expect(source).not.toContain('CommonDesktopDirectory')
    expect(source).not.toContain('desktop-public')
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true)
    const declaration = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'shortcutsReady')
    expect(declaration).toBeTruthy()
    const compiled = ts.transpileModule(`${declaration!.getText(parsed)}\nshortcutsReady`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file }).outputText
    const fn = runInNewContext(compiled, { SHORTCUT_ROLES: ['cashier', 'manage', 'desktop-binding', 'uninstall'] }, { timeout: 1000 })
    const required = ['cashier', 'manage', 'desktop-binding', 'uninstall']
    const base = required.map(subject => ({ subject, status: 'CREATED' }))
    for (const legacyStatus of ['NEEDS_CONFIRMATION', 'PRESERVED', 'UNAVAILABLE']) {
      expect(fn([...base, { subject: 'desktop', status: legacyStatus }])).toBe(true)
    }
    expect(fn(base.slice(1))).toBe(false)
    expect(fn([...base, { subject: 'cashier', status: 'UNAVAILABLE' }])).toBe(false)
  })
})
