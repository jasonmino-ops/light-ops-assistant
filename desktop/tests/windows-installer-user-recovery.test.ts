import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, '../build/installer.nsh'), 'utf8')
// Execute the actual NSIS control flow, replacing only OS/plugin effects.
// This is fault injection, NOT Windows/DPAPI/installer FIELD evidence.
type Op = { text: string; target?: number; conditions?: string[] }
class Installer {
  vars: Record<string, string> = { INSTDIR: 'C:\\Desktop', LOCALAPPDATA: 'C:\\User',
    PLUGINSDIR: 'C:\\Private', TEMP: 'C:\\Temp', DESKTOP: 'C:\\Links', SMPROGRAMS: 'C:\\Menu', installMode: 'CurrentUser' }
  registry = new Map<string, string>()
  files = new Set<string>()
  events: string[] = []
  stack: string[] = []
  context = 'current'
  errors = false
  exit = 0
  user = 'cashier'
  shellUser = 'cashier'
  shellSession = '1'
  session = '1'
  consoleSession = '1'
  nativeAMD64 = true
  allUsersParameter = false
  parameterResult = ''
  machineKeys = new Map<string, number>()
  shell = true
  admin = false
  inner = false
  updated = false
  nativeFailure = ''
  failAt = ''
  processResults: number[] = []
  oldDesktop = true
  addonAttempts = 0
  installerHash = 'a'.repeat(64)
  allocations = 0
  constructor() {
    this.setReg('SHELL_CONTEXT', '${INSTALL_REGISTRY_KEY}', 'InstallLocation', '$INSTDIR')
    this.setReg('SHELL_CONTEXT', '${UNINSTALL_REGISTRY_KEY}', 'UninstallString', "'\"$INSTDIR\\${UNINSTALL_FILENAME}\"'")
    this.files.add(this.value('$INSTDIR\\${APP_EXECUTABLE_FILENAME}'))
    this.files.add(this.value('$INSTDIR\\${UNINSTALL_FILENAME}'))
  }
  value(s: string): string {
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1)
    for (let i = 0; i < 5; i++) s = s.replace(/\$\{(ESHOP_\w+)\}/g, (raw, key) => {
      const m = source.match(new RegExp(`!define ${key} "([^"\\n]*)"`)); return m?.[1] ?? raw
    }).replace(/\$(R?\d|[a-zA-Z]\w*)/g, (_, key) => this.vars[key] ?? '')
    return s
  }
  key(hive: string, path: string, name: string): string {
    return `${hive === 'SHELL_CONTEXT' ? (this.context === 'all' ? 'HKLM' : 'HKCU') : hive}|${this.value(path)}|${this.value(name)}`
  }
  setReg(h: string, p: string, n: string, v: string) { this.registry.set(this.key(h, p, n), this.value(v)) }
  reg(p: string, n: string) { return this.registry.get(this.key('HKCU', p, n)) ?? '' }
  body(name: string): string {
    if (name === 'eshopCheckInteractiveUser' || name === 'un.eshopCheckInteractiveUser') {
      return source.match(/Function \$\{prefix\}eshopCheckInteractiveUser\n([\s\S]*?)FunctionEnd/)![1]
    }
    const m = source.match(new RegExp(`!macro ${name}\\b([^\\n]*)\\n([\\s\\S]*?)!macroend`))
    if (!m) throw new Error(`unknown source macro ${name}`)
    return m[2]
  }
  expand(name: string, args: string[] = []): string[] {
    let text = this.body(name)
    const params = source.match(new RegExp(`!macro ${name}\\b([^\\n]*)`))?.[1].trim().split(/\s+/) ?? []
    params.forEach((p, i) => { if (p && args[i]) text = text.replaceAll('${' + p + '}', args[i]) })
    const lines: string[] = []; const included = [true]
    for (let line of text.split('\n')) {
      line = line.trim(); if (!line || line.startsWith(';')) continue
      const ifdef = line.match(/^!(ifn?def) BUILD_UNINSTALLER/)
      if (ifdef) { included.push(included.at(-1)! && ifdef[1] === 'ifndef'); continue }
      if (line === '!else') { const old = included.pop(); included.push(included.at(-1)! && !old); continue }
      if (line === '!endif') { included.pop(); continue }
      if (!included.at(-1)) continue
      if (line.startsWith('!define ESHOP_MANAGED_ADDON_EXIT_ID')) continue
      if (line.startsWith('!undef ')) continue
      line = line.replaceAll('${ESHOP_MANAGED_ADDON_EXIT_ID}', args[0] ?? '')
      const macro = line.match(/^!insertmacro (\w+)(.*)$/)
      if (macro && macro[1] !== 'eshopGetQuotedPath') lines.push(...this.expand(macro[1], (macro[2].match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(v => /^['"]/.test(v) ? v.slice(1, -1) : v)))
      else lines.push(line)
    }
    return lines
  }
  condition(s: string): boolean {
    if (s === '${IsNativeAMD64}') return this.nativeAMD64
    if (s === '${Errors}') return this.errors
    if (s === '${UAC_IsAdmin}') return this.admin
    if (s === '${UAC_IsInnerInstance}') return this.inner
    if (s === '${isUpdated}') return this.updated
    const file = s.match(/^\$\{FileExists\} (.+)$/)
    if (file) return this.files.has(this.value(file[1]))
    const m = s.match(/^(\S+) (==|!=) (.+)$/)
    if (!m) throw new Error(`unmodelled source condition ${s}`)
    return (this.value(m[1]) === this.value(m[3])) === (m[2] === '==')
  }
  compile(lines: string[]): Op[] {
    const ops: Op[] = []; let i = 0
    const block = () => {
      while (i < lines.length && !/^\$\{(?:Else|ElseIf|EndIf)/.test(lines[i])) {
        const start = lines[i++].match(/^\$\{(If|IfNot)\} (.*)$/)
        if (!start) { ops.push({ text: lines[i - 1] }); continue }
        const exits: Op[] = []; let condition = (start[1] === 'IfNot' ? '!' : '') + start[2]
        while (true) {
          const conditions = [condition]
          while (i < lines.length && /^\$\{(?:AndIf|OrIf)/.test(lines[i])) conditions.push(lines[i++])
          const branch: Op = { text: '@if', conditions }; ops.push(branch); block()
          const exit: Op = { text: '@goto' }; ops.push(exit); exits.push(exit); branch.target = ops.length
          const next = lines[i++]
          if (next?.startsWith('${ElseIf} ')) { condition = next.slice(10); continue }
          if (next === '${Else}') { block(); if (lines[i++] !== '${EndIf}') throw new Error('unbalanced else') }
          else if (next !== '${EndIf}') throw new Error(`unbalanced if ${next}`)
          exits.forEach(op => { op.target = ops.length }); break
        }
      }
    }
    block(); return ops
  }
  native(text: string) {
    this.events.push(text)
    if (text.includes('RegOpenKeyExW')) {
      const key = this.value(text.match(/w "([^"]+)"/)![1]); const view = text.includes('0x20219') ? '32' : '64'
      const registered = view === '64' && [...this.registry.keys()].some(k => k.startsWith('HKLM|' + key + '|'))
      const result = this.machineKeys.get(view + '|' + key) ?? (registered ? 0 : 2)
      this.vars['0'] = result === 0 ? '1004' : '0'; this.vars['1'] = String(result)
    }
    else if (text.includes('GetShellWindow')) this.vars['6'] = this.shell ? '100' : '0'
    else if (text.includes('GetWindowThreadProcessId')) { this.vars['7'] = '101'; this.vars['8'] = '1' }
    else if (text.includes('GetCurrentProcessId')) this.vars['8'] = '202'
    else if (text.includes('ProcessIdToSessionId(i r7')) { this.vars['4'] = this.shellSession; this.vars['8'] = '1' }
    else if (text.includes('ProcessIdToSessionId(i r8')) { this.vars['9'] = this.session; this.vars['8'] = '1' }
    else if (text.includes('WTSGetActiveConsoleSessionId')) this.vars['8'] = this.consoleSession
    else if (text.includes('::OpenProcess(')) this.vars['0'] = '1001'
    else if (text.includes('OpenProcessToken')) { this.vars[text.includes('p r0') ? '1' : '5'] = '1002'; this.vars['8'] = '1' }
    else if (text.includes('GetTokenInformation')) this.vars['8'] = '1'
    else if (text.includes('GetCurrentProcess()')) this.vars['4'] = '-1'
    else if (text.includes('*$2')) this.vars['6'] = this.shellUser
    else if (text.includes('*$3')) this.vars['7'] = this.user
    else if (text.includes('IsValidSid')) this.vars['8'] = '1'
    else if (text.includes('EqualSid')) this.vars['8'] = this.vars['6'] === this.vars['7'] ? '1' : '0'
    else if (text.includes('ConvertSidToStringSidW')) { this.vars['9'] = '1003'; this.vars['8'] = '1' }
    else if (text.includes('*$9(&w')) this.vars['8'] = this.user
    else if (!text.includes('CloseHandle') && !text.includes('LocalFree') && !text.includes('RegCloseKey')) throw new Error(`unmodelled API ${text}`)
    if (this.nativeFailure && text.includes(this.nativeFailure)) {
      const result = text.match(/[ip]\.r(\d)'$/)?.[1]; if (result) this.vars[result] = '0'
    }
  }
  run(name: string) {
    const ops = this.compile(this.expand(name)); const labels = new Map<string, number>()
    ops.forEach((o, i) => {
      if (o.text.endsWith(':')) {
        const label = o.text.slice(0, -1)
        if (labels.has(label)) throw new Error(`duplicate source label ${label}`)
        labels.set(label, i)
      }
    })
    const jump = (target: string, pc: number) => target === '0' ? pc + 1 : labels.get(target) ?? (() => { throw new Error(`unknown jump ${target}`) })()
    for (let pc = 0, budget = 10000; pc < ops.length; budget--) {
      if (!budget) throw new Error('source loop budget')
      const op = ops[pc], t = op.text; let next = pc + 1
      if (t === '@goto') next = op.target!
      else if (t === '@if') {
        let yes = op.conditions![0].startsWith('!') ? !this.condition(op.conditions![0].slice(1)) : this.condition(op.conditions![0])
        for (const term of op.conditions!.slice(1)) {
          const m = term.match(/^\$\{(AndIf|OrIf)(Not)?\} (.*)$/)!; const v = this.condition(m[3]) !== Boolean(m[2]); yes = m[1] === 'AndIf' ? yes && v : yes || v
        }
        if (!yes) next = op.target!
      } else if (t.startsWith('StrCpy ')) { const m = t.match(/^StrCpy \$(\w+) (.+)$/)!; this.vars[m[1]] = this.value(m[2]) }
      else if (t.startsWith('StrLen ')) { const m = t.split(' '); this.vars[m[1].slice(1)] = String(this.value(m[2]).length) }
      else if (t.startsWith('${StdUtils.TestParameter} ')) this.vars.R0 = this.parameterResult || (this.allUsersParameter ? 'true' : 'false')
      else if (t.startsWith('${StdUtils.HashFile} ')) this.vars.eshopInstallerSha256 = this.installerHash
      else if (t.startsWith('StrCmp ')) { const m = t.match(/'[^']*'|"[^"]*"|\S+/g)!; next = jump(this.value(m[1]) === this.value(m[2]) ? m[3] : m[4] ?? '0', pc) }
      else if (t.startsWith('Goto ')) next = jump(t.slice(5), pc)
      else if (t.startsWith('Call ')) this.run(t.slice(5))
      else if (t === 'Quit') throw new Error(`QUIT:${this.exit}`)
      else if (t.startsWith('SetErrorLevel ')) this.exit = Number(t.slice(14))
      else if (t === 'ClearErrors') this.errors = false
      else if (t.startsWith('SetShellVarContext ')) this.context = t.slice(19)
      else if (t.startsWith('ReadRegStr ')) { const m = t.match(/^ReadRegStr \$(\w+) (\w+) "([^"]+)" (.+)$/)!; this.vars[m[1]] = this.registry.get(this.key(m[2], m[3], m[4])) ?? '' }
      else if (t.startsWith('WriteRegStr ')) {
        const m = t.match(/^WriteRegStr (\w+) "([^"]+)" ("[^"]+"|\S+) (.+)$/)!; this.events.push('registry-write:' + this.value(m[3])); this.errors = this.failAt === 'registry' || (this.failAt === 'desktop-run' && m[2] === '${ESHOP_DESKTOP_AUTOSTART_KEY}')
        if (!this.errors) this.setReg(m[1], m[2], m[3], m[4])
      } else if (t.startsWith('DeleteRegValue ')) { const m = t.match(/^DeleteRegValue (\w+) "([^"]+)" (.+)$/)!; this.registry.delete(this.key(m[1], m[2], m[3])) }
      else if (t.startsWith('DeleteRegKey ')) { const m = t.match(/^DeleteRegKey (\w+) "([^"]+)"$/)!; const prefix = this.key(m[1], m[2], ''); for (const key of this.registry.keys()) if (key.startsWith(prefix)) this.registry.delete(key) }
      else if (t.startsWith('IfFileExists ')) { const m = t.match(/^IfFileExists "([^"]+)" (\S+) (\S+)$/)!; next = jump(this.files.has(this.value(m[1])) ? m[2] : m[3], pc) }
      else if (t.startsWith('nsProcess::')) this.stack.push(String(this.processResults.shift() ?? 603))
      else if (t.startsWith('Pop ')) this.vars[t.slice(5)] = this.stack.pop() ?? ''
      else if (t.startsWith('System::Alloc')) this.stack.push(String(++this.allocations))
      else if (t.startsWith('System::Call')) this.native(t)
      else if (t.startsWith('System::Store') || t.startsWith('System::Free')) this.events.push(t)
      else if (t.startsWith('!insertmacro eshopGetQuotedPath')) this.vars.R3 = this.vars.R2.match(/"([^"]+)"/)?.[1] ?? ''
      else if (t.startsWith('ExecWait ')) {
        const event = t.includes('preflight.exe') ? 'addon-install' : t.includes('--desktop-install-complete') ? 'shortcuts-complete' : t.includes('--install-shortcuts') ? 'shortcuts' : t.includes('eshop-current-uninstaller') ? 'desktop-remove' : t.includes('${ESHOP_NETWORK_ADDON_UNINSTALLER}') ? 'addon-uninstall' : 'safe-exit'
        this.events.push(event); const fail = this.failAt === event; this.errors = false; this.vars[t.match(/\$(R\d)$/)![1]] = fail ? '5' : '0'
        if (event === 'addon-install') {
          if (!t.includes('/desktop-prerequisite')) throw new Error('managed prerequisite flag missing')
          this.addonAttempts++; if (!fail) this.installAddon(true)
        }
        if (event === 'shortcuts-complete' && !fail) {
          const ready = this.reg('${INSTALL_REGISTRY_KEY}', 'InstallLocation') === this.value('$INSTDIR')
            && this.files.has(this.value('$INSTDIR\\${APP_EXECUTABLE_FILENAME}'))
          if (ready) this.publishBusinessLinks()
          else this.vars[t.match(/\$(R\d)$/)![1]] = '8'
        }
        if (event === 'desktop-remove' && !fail) { this.oldDesktop = false; this.registry.delete(this.key('SHELL_CONTEXT', '${INSTALL_REGISTRY_KEY}', 'InstallLocation')); this.registry.delete(this.key('SHELL_CONTEXT', '${UNINSTALL_REGISTRY_KEY}', 'UninstallString')); this.files.delete(this.value('$INSTDIR\\${APP_EXECUTABLE_FILENAME}')) }
      } else if (t === 'IntOp $R3 $R3 + 1') this.vars.R3 = String(Number(this.vars.R3) + 1)
      else if (t.startsWith('IntCmp ')) { const m = t.split(' '); next = jump(m[Number(this.value(m[1])) === Number(m[2]) ? 3 : Number(this.value(m[1])) < Number(m[2]) ? 4 : 5], pc) }
      else if (t.startsWith('Sleep ')) this.events.push('sleep:' + t.slice(6))
      else if (t === 'IfSilent +2 0' || /^MessageBox MB_OK\|MB_ICONSTOP "/.test(t)) { /* diagnostic-only OK dialog */ }
      else if (!/^(DetailPrint|InitPluginsDir|SetOutPath|File |[\w$\{\}-]+:)/.test(t)) throw new Error(`unmodelled instruction ${t}`)
      pc = next
    }
  }
  installAddon(prerequisite = false) {
    for (const [key, value] of [['InstallLocation', '${ESHOP_NETWORK_ADDON_ROOT}'], ['KeepShortcuts', 'true'], ['ShortcutName', 'E-Shop Network Print Add-on']]) this.setReg('HKCU', '${ESHOP_NETWORK_ADDON_INSTALL_REGISTRY_KEY}', key, value)
    this.setReg('HKCU', '${ESHOP_NETWORK_ADDON_UNINSTALL_REGISTRY_KEY}', 'UninstallString', '"${ESHOP_NETWORK_ADDON_UNINSTALLER}" /currentuser')
    this.setReg('HKCU', '${ESHOP_NETWORK_ADDON_UNINSTALL_REGISTRY_KEY}', 'DisplayVersion', '${ESHOP_NETWORK_ADDON_VERSION}')
    for (const f of ['${ESHOP_NETWORK_ADDON_ROOT}\\E-Shop-Network-Print-Addon.exe', '${ESHOP_NETWORK_ADDON_UNINSTALLER}', '$SMPROGRAMS\\店小二\\管理与维护\\Network 打印设置.lnk', '$SMPROGRAMS\\店小二\\管理与维护\\卸载 Network Print.lnk']) this.files.add(this.value(f))
    if (!prerequisite) this.publishBusinessLinks()
  }
  publishBusinessLinks() {
    for (const f of ['$DESKTOP\\店小二收银.lnk', '$SMPROGRAMS\\店小二\\管理与维护\\Desktop 门店绑定.lnk']) this.files.add(this.value(f))
  }
  // Simulate only builder's documented file/registration effects immediately
  // before customInstall (installSection.nsh: registryAddInstallInfo then hook).
  installDesktopPayload() {
    this.events.push('desktop-payload')
    this.setReg('HKCU', '${INSTALL_REGISTRY_KEY}', 'InstallLocation', '$INSTDIR')
    this.setReg('HKCU', '${UNINSTALL_REGISTRY_KEY}', 'UninstallString', '\"$INSTDIR\\${UNINSTALL_FILENAME}\" /currentuser')
    this.files.add(this.value('$INSTDIR\\${APP_EXECUTABLE_FILENAME}'))
    this.files.add(this.value('$INSTDIR\\${UNINSTALL_FILENAME}'))
  }
  prepare() { this.vars.eshopDesktopInstallerPhase = 'install'; this.run('customCheckAppRunning') }
}

describe('G2 actual NSIS user and recovery control flow (mocked OS effects)', () => {
  it.each(['cashier', 'administrator'])('permits only the same interactive SID: %s', user => {
    const vm = new Installer(); vm.user = vm.shellUser = user; vm.run('eshopVerifyInteractiveUser'); expect(vm.vars.eshopInteractiveUserVerified).toBe('1')
    expect(vm.events.filter(e => e.includes('CloseHandle'))).toHaveLength(3)
  })
  it('rejects the elevating administrator when the actual cashier is another account before any write', () => {
    const vm = new Installer(); vm.user = 'administrator'; expect(() => vm.run('customInit')).toThrow('QUIT:36'); expect(vm.events.some(e => e.startsWith('registry-write:'))).toBe(false); expect(vm.oldDesktop).toBe(true)
  })
  it.each(['GetWindowThreadProcessId', 'ProcessIdToSessionId', 'OpenProcess(', 'OpenProcessToken', 'GetTokenInformation', 'IsValidSid', 'EqualSid', 'ConvertSidToStringSidW'])('fails closed on native query failure: %s', api => {
    const vm = new Installer(); vm.nativeFailure = api; expect(() => vm.run('eshopVerifyInteractiveUser')).toThrow('QUIT:36'); expect(vm.events).not.toContain('addon-install')
  })
  it.each(['no-shell', 'other-session', 'remote-admin-session', 'console-unknown'])('rejects unverifiable interactive ownership: %s', failure => {
    const vm = new Installer(); if (failure === 'no-shell') vm.shell = false; else if (failure === 'other-session') vm.shellSession = '2'; else vm.consoleSession = failure === 'console-unknown' ? '-1' : '2'; expect(() => vm.run('customInit')).toThrow('QUIT:36')
  })
  it('stops an inner elevation instance before the builder can skip the section preflight', () => {
    const vm = new Installer(); vm.inner = true; expect(() => vm.run('customInit')).toThrow('QUIT:37'); expect(vm.events).toEqual([])
  })
  it('cancellation before the install section has no installer side effects', () => {
    const vm = new Installer(); vm.run('customInit'); expect(vm.events).not.toContain('addon-install'); expect(vm.oldDesktop).toBe(true); expect(vm.addonAttempts).toBe(0)
  })
  it('refuses machine installation without pre-existing same-account elevation', () => {
    const vm = new Installer(); vm.vars.installMode = 'all'; expect(() => vm.run('customInit')).toThrow('QUIT:44'); expect(vm.oldDesktop).toBe(true); expect(vm.addonAttempts).toBe(0)
  })
  it('rejects cross-account uninstall before removing the actual cashier Add-on', () => {
    const vm = new Installer(); vm.user = 'another-admin'; expect(() => vm.run('customUnInit')).toThrow('QUIT:36'); expect(vm.events).not.toContain('safe-exit'); expect(vm.oldDesktop).toBe(true)
  })
  it.each(['dual-hive', 'wrong-path', 'forced-mode'])('rejects unsafe HKLM/HKCU handoff before dependency changes: %s', failure => {
    const vm = new Installer()
    if (failure === 'dual-hive') vm.setReg('HKLM', '${INSTALL_REGISTRY_KEY}', 'InstallLocation', '$INSTDIR')
    if (failure === 'wrong-path') vm.setReg('HKCU', '${INSTALL_REGISTRY_KEY}', 'InstallLocation', 'C:\\Other')
    if (failure === 'forced-mode') { vm.registry.clear(); vm.setReg('HKLM', '${INSTALL_REGISTRY_KEY}', 'InstallLocation', '$INSTDIR') }
    expect(() => vm.prepare()).toThrow('QUIT:' + ({ 'dual-hive': 46, 'wrong-path': 4, 'forced-mode': 46 })[failure]); expect(vm.addonAttempts).toBe(0); expect(vm.oldDesktop).toBe(true)
  })
  it.each(['CurrentUser'])('prepares dependency before the same-hive Desktop handoff: %s', mode => {
    const vm = new Installer()
    vm.prepare(); expect(vm.events.indexOf('addon-install')).toBeLessThan(vm.events.indexOf('desktop-remove')); expect(vm.vars.eshopAddonPrepared).toBe('1'); expect(vm.context).toBe(mode === 'all' ? 'all' : 'current')
    vm.prepare(); expect(vm.events.filter(e => e === 'desktop-remove')).toHaveLength(1)
    vm.installDesktopPayload(); vm.run('customInstall'); expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'PendingVersion')).toBe(''); expect(vm.events.filter(e => e === 'addon-install')).toHaveLength(1)
  })
  it.each(['addon-install', 'shortcuts', 'registry'])('dependency failure preserves the predecessor and stops before Desktop replacement: %s', failure => {
    const vm = new Installer(); vm.failAt = failure; expect(() => vm.prepare()).toThrow(/QUIT:/); expect(vm.oldDesktop).toBe(true); expect(vm.events).not.toContain('desktop-remove'); expect(vm.vars.eshopAddonPrepared).not.toBe('1')
  })
  it('retries only the same bound dependency after a failed attempt; no arbitrary adoption', () => {
    const vm = new Installer(); vm.failAt = 'addon-install'; expect(() => vm.prepare()).toThrow('QUIT:20'); expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed')).toBe('')
    vm.failAt = ''; vm.prepare(); expect(vm.oldDesktop).toBe(false); expect(vm.addonAttempts).toBe(2); expect(vm.vars.eshopAddonPrepared).toBe('1')
  })
  it.each(['PendingVersion', 'PendingDesktopPath', 'PendingMode', 'PendingInstallerSha256'])('rejects a recovery binding mismatch: %s', field => {
    const vm = new Installer(); vm.failAt = 'addon-install'; expect(() => vm.prepare()).toThrow('QUIT:20'); vm.setReg('HKCU', '${ESHOP_NETWORK_ADDON_MARKER_KEY}', field, 'another'); vm.failAt = ''; expect(() => vm.prepare()).toThrow('QUIT:40'); expect(vm.addonAttempts).toBe(1); expect(vm.oldDesktop).toBe(true)
  })
  it('cannot mutate a dependency when the running installer file cannot be hashed', () => {
    const vm = new Installer(); vm.installerHash = 'error'; expect(() => vm.prepare()).toThrow('QUIT:41'); expect(vm.addonAttempts).toBe(0); expect(vm.oldDesktop).toBe(true)
  })
  it('preserves pending recovery if predecessor removal fails; never reports completed install', () => {
    const vm = new Installer(); vm.failAt = 'desktop-remove'; expect(() => vm.prepare()).toThrow('QUIT:5'); expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'PendingVersion')).not.toBe(''); expect(vm.events.some(e => e === 'registry-write:E-Shop Desktop')).toBe(false)
  })
  it('cannot commit without the pre-removal dependency gate', () => { const vm = new Installer(); expect(() => vm.run('customInstall')).toThrow('QUIT:38') })
  it('an updated Desktop uninstaller retains the managed dependency and its configuration', () => {
    const vm = new Installer(); vm.installAddon(); vm.updated = true; vm.setReg('HKCU', '${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed', 'true')
    vm.run('customUnInit'); vm.run('eshopConfirmedUninstall'); expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed')).toBe('true'); expect(vm.events).not.toContain('safe-exit'); expect(vm.oldDesktop).toBe(true)
  })
  it('does not claim automatic rollback after a generic builder/OS failure', () => {
    const vm = new Installer(); vm.prepare(); expect(vm.oldDesktop).toBe(false); expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'PendingVersion')).not.toBe(''); expect(vm.events).not.toContain('rollback-success')
  })
  it('uses unique inline labels and a bounded safe-exit wait, without killing a process', () => {
    const vm = new Installer(); vm.installAddon(); vm.setReg('HKCU', '${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed', 'true'); vm.processResults = [0, 0, 603]; vm.run('eshopCheckNetworkAddonInstallState'); expect(vm.events).toContain('safe-exit')
    expect(source.split('\n').filter(line => !line.trimStart().startsWith(';')).join('\n')).not.toMatch(/taskkill|_KillProcess|SetTokenInformation|DuplicateTokenEx/)
    const ids = [...source.matchAll(/!insertmacro eshopCheckNetworkAddonProcess (\w+)/g)].map(m => m[1])
    expect(ids).toEqual(['state', 'uninstall', 'prepared', 'completed']); expect(new Set(ids).size).toBe(ids.length)
  })
  it('waits at most 120 polls before refusing a managed process that did not exit', () => {
    const vm = new Installer(); vm.installAddon(); vm.setReg('HKCU', '${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed', 'true'); vm.processResults = Array(122).fill(0)
    expect(() => vm.run('eshopCheckNetworkAddonInstallState')).toThrow('QUIT:27'); expect(vm.events.filter(e => e === 'sleep:250')).toHaveLength(120); expect(vm.oldDesktop).toBe(true)
  })
})


describe('G3 lifecycle safety, actual source with mocked OS effects', () => {
  function machine(owner = 'cashier', path = '$INSTDIR') {
    const vm = new Installer(); vm.registry.clear(); vm.vars.installMode = 'all'; vm.context = 'all'; vm.admin = true
    vm.setReg('HKLM', '${INSTALL_REGISTRY_KEY}', 'InstallLocation', '$INSTDIR')
    vm.setReg('HKLM', '${UNINSTALL_REGISTRY_KEY}', 'UninstallString', '\"$INSTDIR\\${UNINSTALL_FILENAME}\"')
    vm.setReg('HKLM', '${ESHOP_DESKTOP_OWNER_KEY}', 'OwnerSid', owner)
    vm.setReg('HKLM', '${ESHOP_DESKTOP_OWNER_KEY}', 'DesktopPath', path)
    return vm
  }
  it('rejects a different logged-in administrator even when token and shell match', () => {
    const vm = machine(); vm.user = vm.shellUser = 'other-admin'
    for (const entry of ['customInit', 'customUnInit', 'eshopConfirmedUninstall']) expect(() => vm.run(entry)).toThrow('QUIT:43')
    expect(vm.events).not.toContain('addon-uninstall'); expect(vm.addonAttempts).toBe(0); expect(vm.oldDesktop).toBe(true)
  })
  it.each(['missing-SID', 'missing-path', 'wrong-path', 'legacy-unowned'])('never adopts uncertain machine ownership: %s', state => {
    const vm = machine(); if (state === 'missing-SID' || state === 'legacy-unowned') vm.setReg('HKLM', '${ESHOP_DESKTOP_OWNER_KEY}', 'OwnerSid', '')
    if (state === 'missing-path' || state === 'legacy-unowned') vm.setReg('HKLM', '${ESHOP_DESKTOP_OWNER_KEY}', 'DesktopPath', '')
    if (state === 'wrong-path') vm.setReg('HKLM', '${ESHOP_DESKTOP_OWNER_KEY}', 'DesktopPath', 'C:\\Other')
    expect(() => vm.run('customInit')).toThrow('QUIT:43'); expect(vm.addonAttempts).toBe(0)
  })
  it('retains the owner reservation across a missing builder registration; another user cannot retry/adopt it', () => {
    const vm = machine(); vm.registry.delete(vm.key('HKLM', '${INSTALL_REGISTRY_KEY}', 'InstallLocation')); vm.registry.delete(vm.key('HKLM', '${UNINSTALL_REGISTRY_KEY}', 'UninstallString'))
    vm.files.clear(); vm.user = vm.shellUser = 'other-admin'; expect(() => vm.run('customInit')).toThrow('QUIT:43')
    expect(vm.registry.get(vm.key('HKLM', '${ESHOP_DESKTOP_OWNER_KEY}', 'OwnerSid'))).toBe('cashier')
  })
  it('blocks even the verified machine owner before any elevated dependency execution or write', () => {
    const vm = machine(); expect(() => vm.run('customInit')).toThrow('QUIT:43'); const before = new Map(vm.registry)
    expect(() => vm.prepare()).toThrow('QUIT:43'); expect(() => vm.run('eshopConfirmedUninstall')).toThrow('QUIT:43')
    expect(vm.registry).toEqual(before); expect(vm.addonAttempts).toBe(0); expect(vm.oldDesktop).toBe(true)
  })
  it.each(['eshopPrepareNetworkAddon', 'eshopPrepareManagedAddonUninstall', 'eshopUninstallPriorVersion', 'eshopRequestManagedAddonExit'])('direct helper cannot execute elevated: %s', helper => {
    const vm = new Installer(); vm.admin = true
    expect(() => vm.run(helper)).toThrow('QUIT:43'); expect(vm.events.filter(e => ['addon-install', 'addon-uninstall', 'shortcuts', 'safe-exit', 'desktop-remove'].includes(e))).toEqual([])
  })
  it.each(['cancel', 'close-window'])('uninstall initialization leaves the managed Add-on/Run untouched on %s', () => {
    const vm = new Installer(); vm.installAddon(); vm.setReg('HKCU', '${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed', 'true'); vm.setReg('HKCU', '${ESHOP_DESKTOP_AUTOSTART_KEY}', '${ESHOP_DESKTOP_AUTOSTART_VALUE}', 'original')
    const before = new Map(vm.registry); vm.processResults = [603]; vm.run('customUnInit')
    expect(vm.registry).toEqual(before); expect(vm.events).not.toContain('addon-uninstall'); expect(vm.events).not.toContain('safe-exit'); expect(vm.oldDesktop).toBe(true)
  })
  it('confirmed dependency uninstall failure stops before the builder Desktop removal section and retains Run/marker', () => {
    const vm = new Installer(); vm.installAddon(); vm.setReg('HKCU', '${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed', 'true'); vm.setReg('HKCU', '${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Version', '${ESHOP_NETWORK_ADDON_VERSION}')
    vm.setReg('HKCU', '${ESHOP_DESKTOP_AUTOSTART_KEY}', '${ESHOP_DESKTOP_AUTOSTART_VALUE}', 'original'); vm.failAt = 'addon-uninstall'
    expect(() => vm.run('eshopConfirmedUninstall')).toThrow('QUIT:22'); expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed')).toBe('true'); expect(vm.oldDesktop).toBe(true)
    expect(vm.reg('${ESHOP_DESKTOP_AUTOSTART_KEY}', '${ESHOP_DESKTOP_AUTOSTART_VALUE}')).toBe('original')
    vm.failAt = ''; vm.run('eshopConfirmedUninstall'); expect(vm.events.filter(e => e === 'addon-uninstall')).toHaveLength(2)
    vm.run('eshopConfirmedUninstall'); expect(vm.events.filter(e => e === 'addon-uninstall')).toHaveLength(2)
  })
  it('keeps dependency and owner binding during --updated without inventing rollback success', () => {
    const vm = new Installer(); vm.updated = true; vm.installAddon(); vm.setReg('HKCU', '${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed', 'true'); const before = new Map(vm.registry)
    vm.run('customUnInit'); vm.run('eshopConfirmedUninstall'); expect(vm.registry).toEqual(before); expect(vm.events).not.toContain('addon-uninstall'); expect(vm.events).not.toContain('rollback-success')
  })
  it('does not provision a fresh all-users installation while the elevated child route is blocked', () => {
    const vm = new Installer(); vm.registry.clear(); vm.files.clear(); vm.context = 'all'; vm.vars.installMode = 'all'; vm.admin = true
    expect(() => vm.run('customInit')).toThrow('QUIT:43'); expect(() => vm.prepare()).toThrow('QUIT:43'); expect(vm.registry.size).toBe(0); expect(vm.addonAttempts).toBe(0)
  })
  it('rejects a partial dependency removal without deleting Run or pretending a repair succeeded', () => {
    const vm = new Installer(); vm.installAddon(); vm.setReg('HKCU', '${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed', 'true'); vm.setReg('HKCU', '${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Version', '${ESHOP_NETWORK_ADDON_VERSION}')
    vm.files.delete(vm.value('${ESHOP_NETWORK_ADDON_UNINSTALLER}'))
    expect(() => vm.run('eshopConfirmedUninstall')).toThrow('QUIT:23'); expect(vm.oldDesktop).toBe(true); expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed')).toBe('true')
  })
  it('repeated uninstall after builder registration removal stops before dependency execution', () => {
    const vm = new Installer(); vm.registry.clear(); vm.files.clear(); vm.oldDesktop = false
    expect(() => vm.run('customUnInit')).toThrow('QUIT:4'); expect(vm.events).not.toContain('addon-uninstall')
  })

})


describe('G4 current-user pre-effect boundaries, mocked OS effects', () => {
  const keys = ['${INSTALL_REGISTRY_KEY}', '${UNINSTALL_REGISTRY_KEY}', '${ESHOP_NETWORK_ADDON_INSTALL_REGISTRY_KEY}', '${ESHOP_NETWORK_ADDON_UNINSTALL_REGISTRY_KEY}', '${ESHOP_DESKTOP_OWNER_KEY}']
  it.each(['preInit', 'customInstallMode', 'customInit', 'customUnInit', 'eshopConfirmedUninstall', 'customCheckAppRunning', 'customInstall', 'customUnInstall'])('rejects all-users CLI at every externally reached hook: %s', hook => {
    const vm = new Installer(); vm.allUsersParameter = true
    expect(() => vm.run(hook)).toThrow('QUIT:44'); expect(vm.addonAttempts).toBe(0); expect(vm.events).not.toContain('desktop-remove'); expect(vm.events.some(e => e.startsWith('registry-write:'))).toBe(false)
  })
  it.each(['preInit', 'customInstallMode', 'customInit', 'customUnInit', 'eshopConfirmedUninstall'])('rejects elevated execution before effects: %s', hook => {
    const vm = new Installer(); vm.admin = true; const before = new Map(vm.registry)
    expect(() => vm.run(hook)).toThrow('QUIT:43'); expect(vm.registry).toEqual(before); expect(vm.oldDesktop).toBe(true)
  })
  it.each(['preInit', 'customInstallMode', 'customUnInit'])('rejects ARM/IA32/unknown native architecture before mode selection: %s', hook => {
    const vm = new Installer(); vm.nativeAMD64 = false; expect(() => vm.run(hook)).toThrow('QUIT:45'); expect(vm.events).toEqual([])
  })
  it.each(['32', '64'])('rejects even empty/conflicting machine keys in registry view %s', view => {
    for (const key of keys) {
      const vm = new Installer(); vm.machineKeys.set(view + '|' + vm.value(key), 0)
      const before = new Map(vm.registry); expect(() => vm.run('preInit')).toThrow('QUIT:46')
      expect(vm.events.filter(e => e.includes('RegCloseKey'))).toHaveLength(1); expect(vm.registry).toEqual(before); expect(vm.addonAttempts).toBe(0)
    }
  })
  it.each([5, 13, -1])('unreadable/unverifiable machine registry state fails closed: %s', status => {
    const vm = new Installer(); vm.machineKeys.set('64|' + vm.value(keys[0]), status)
    expect(() => vm.run('preInit')).toThrow('QUIT:46'); expect(vm.addonAttempts).toBe(0)
  })
  it.each([2, 3])('permits only a documented absent-key result without creating anything: %s', status => {
    const vm = new Installer(); for (const view of ['32', '64']) for (const key of keys) vm.machineKeys.set(view + '|' + vm.value(key), status)
    const before = new Map(vm.registry); vm.run('preInit'); vm.run('customInstallMode')
    expect(vm.vars.isForceCurrentInstall).toBe('1'); expect(vm.registry).toEqual(before); expect(vm.events).not.toContain('addon-install')
  })
  it('uses the actual StdUtils boolean string contract rather than treating false as a numeric zero', () => {
    const vm = new Installer(); vm.parameterResult = 'false'; vm.run('preInit')
    for (const value of ['true', 'error', '-1']) { vm.parameterResult = value; expect(() => vm.run('preInit')).toThrow('QUIT:44') }
  })
  it('parses the exact customInstall macro rather than its customInstallMode prefix', () => {
    const vm = new Installer(); expect(vm.body('customInstall')).toContain('$eshopAddonPrepared'); expect(vm.body('customInstallMode')).not.toContain('$eshopAddonPrepared')
    expect(() => vm.run('customInstall')).toThrow('QUIT:38')
  })
  it('current-user clean install, same-candidate repeat and normal commit keep one Run and clear only exact pending fields', () => {
    const vm = new Installer(); vm.registry.clear(); vm.files.clear(); vm.oldDesktop = false
    vm.run('preInit'); vm.run('customInstallMode'); vm.run('customInit'); vm.prepare(); vm.prepare(); vm.installDesktopPayload(); vm.run('customInstall')
    expect(vm.addonAttempts).toBe(1); expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'PendingVersion')).toBe('')
    expect(vm.reg('${ESHOP_DESKTOP_AUTOSTART_KEY}', '${ESHOP_DESKTOP_AUTOSTART_VALUE}')).toBe('"C:\\Desktop\\${APP_EXECUTABLE_FILENAME}"')
    expect(vm.events).not.toContain('desktop-remove'); expect(vm.context).toBe('current')
  })
})


describe('RC2 no-legacy clean installation and final acceptance fault injection', () => {
  function clean() { const vm = new Installer(); vm.registry.clear(); vm.files.clear(); vm.oldDesktop = false; return vm }
  it('prepares management only without any Desktop, and publishes business links only after actual payload registration', () => {
    const vm = clean(); vm.run('customInit'); vm.prepare()
    expect(vm.files.has(vm.value('$DESKTOP\\店小二收银.lnk'))).toBe(false)
    expect(vm.files.has(vm.value('$SMPROGRAMS\\店小二\\管理与维护\\Desktop 门店绑定.lnk'))).toBe(false)
    expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed')).toBe('')
    expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'PendingVersion')).not.toBe('')
    vm.installDesktopPayload(); vm.run('customInstall')
    expect(vm.events.indexOf('shortcuts-complete')).toBeGreaterThan(vm.events.indexOf('desktop-payload'))
    expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed')).toBe('true')
    expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'PendingVersion')).toBe('')
    expect(vm.events).not.toContain('desktop-remove')
    expect([...vm.registry.keys()].some(k => k.includes('1acbd53d'))).toBe(false)
  })
  it('cannot complete before the modern Desktop file and registration exist', () => {
    const vm = clean(); vm.prepare()
    expect(() => vm.run('customInstall')).toThrow('QUIT:47')
    expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed')).toBe('')
    expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'PendingInstallerSha256')).toBe(vm.installerHash)
    expect(vm.reg('${ESHOP_DESKTOP_AUTOSTART_KEY}', '${ESHOP_DESKTOP_AUTOSTART_VALUE}')).toBe('')
  })
  it('retains exact recovery binding and configuration after final helper failure, then accepts same-candidate retry', () => {
    const vm = clean(); vm.setReg('HKCU', 'Software\\MerchantConfiguration', 'sentinel', 'retain')
    vm.prepare(); vm.installDesktopPayload(); vm.failAt = 'shortcuts-complete'
    expect(() => vm.run('customInstall')).toThrow('QUIT:47')
    expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed')).toBe('')
    expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'PendingInstallerSha256')).toBe(vm.installerHash)
    vm.failAt = ''; vm.run('customInstall')
    expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed')).toBe('true')
    expect(vm.reg('Software\\MerchantConfiguration', 'sentinel')).toBe('retain')
    expect(vm.events.filter(e => e === 'addon-install')).toHaveLength(1)
    expect(vm.events).not.toContain('rollback-success')
  })
  it('does not publish managed completion if Desktop Run registration fails after final entry verification', () => {
    const vm = clean(); vm.prepare(); vm.installDesktopPayload(); vm.failAt = 'desktop-run'
    expect(() => vm.run('customInstall')).toThrow('QUIT:39')
    expect(vm.events).toContain('shortcuts-complete')
    expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed')).toBe('')
    expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Version')).toBe('')
    expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'PendingInstallerSha256')).toBe(vm.installerHash)
    vm.failAt = ''; vm.run('customInstall')
    expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed')).toBe('true')
    expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'PendingVersion')).toBe('')
  })
  it('rejects another installer after a final failure, leaving its pending evidence and payload intact', () => {
    const vm = clean(); vm.prepare(); vm.installDesktopPayload(); vm.failAt = 'shortcuts-complete'
    expect(() => vm.run('customInstall')).toThrow('QUIT:47')
    const registry = new Map(vm.registry), files = new Set(vm.files)
    vm.installerHash = 'b'.repeat(64); vm.failAt = ''
    expect(() => vm.prepare()).toThrow('QUIT:40')
    expect(vm.registry).toEqual(registry); expect(vm.files).toEqual(files)
  })
  it.each(['$DESKTOP\\店小二收银.lnk', '$SMPROGRAMS\\店小二\\管理与维护\\Desktop 门店绑定.lnk'])('does not accept a final helper that returns success without required artifact %s', file => {
    const vm = clean(); vm.prepare(); vm.installDesktopPayload(); vm.publishBusinessLinks = () => {}
    expect(() => vm.run('customInstall')).toThrow('QUIT:34')
    expect(vm.files.has(vm.value(file))).toBe(false)
    expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'Managed')).toBe('')
    expect(vm.reg('${ESHOP_NETWORK_ADDON_MARKER_KEY}', 'PendingVersion')).not.toBe('')
  })
})
