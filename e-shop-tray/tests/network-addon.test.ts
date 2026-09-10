import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { beforeAll, describe, expect, it } from 'vitest'

const tray = path.resolve(__dirname, '..')
const script = path.join(tray, 'scripts/build-network-addon.mjs')
const load = createRequire(path.join(tray, 'package.json'))
const builder = load('./network-addon/electron-builder.cjs')
let build: Record<string, any>
let installer: string
beforeAll(async () => {
  build = await import(/* @vite-ignore */ pathToFileURL(script).href)
  installer = await readFile(path.join(tray, 'network-addon/installer.nsh'), 'utf8')
})

describe('Network Add-on build and release boundary', () => {
  it('defaults to checking and refuses all path, publication and signing overrides', () => {
    expect(build.parseArgs([])).toEqual({ mode: 'check' })
    for (const mode of ['check', 'bundle', 'candidate', 'release']) expect(build.parseArgs([`--${mode}`])).toEqual({ mode })
    for (const args of [['--bundle', '--release'], ['--check', '--check'], ['--publish'],
      ['--output', '/tmp/old-candidate'], ['--version', '0.4.7'], ['--signer', 'self-signed'],
      ['--proof', '/tmp/untrusted.json'], ['--forceCodeSigning=false']]) {
      expect(() => build.parseArgs(args)).toThrow('ADDON_UNSUPPORTED_ARGUMENTS')
    }
  })

  it('candidate rejects signing, downloader and approval injection by variable name without reading credentials', () => {
    for (const key of ['CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'AZURE_CLIENT_SECRET', 'ELECTRON_MIRROR',
      'APP_BUILDER_BIN', 'USE_SYSTEM_NSIS', 'ESHOP_ADDON_RELEASE_APPROVED']) {
      const env = Object.defineProperty({}, key, { enumerable: true, get: () => { throw new Error('credential read') } })
      expect(() => build.candidateEnvironment(env)).toThrow('ADDON_CANDIDATE_ENVIRONMENT_OVERRIDE')
    }
    expect(build.candidateEnvironment({ PATH: '/usr/bin', UNRELATED_SECRET: 'not copied' })).toEqual({
      PATH: '/usr/bin', CSC_IDENTITY_AUTO_DISCOVERY: 'false', ELECTRON_BUILDER_DISABLE_UPDATE_CHECK: 'true',
      npm_config_update_notifier: 'false', CI: 'true',
    })
  })

  it('requires an explicit active exact-source TEST grant for the current branch', () => {
    // Pure policy fixtures only; no Git commit, trusted-ref or authorization is created.
    const authorization = { authorizationId: 'TEST-FIXTURE', featureBranch: 'codex/test', status: 'ACTIVE',
      lineageMode: 'PRE_COMMIT_CONTENT_SHA256', candidateBuild: build.CANDIDATE_BUILD }
    const exception = { taskId: build.TASK_ID, featureBranch: 'codex/old', additionalAuthorizations: [authorization] }
    expect(build.selectCandidateAuthorization(exception, 'codex/test')).toEqual(authorization)
    for (const change of [{ status: 'CLOSED' }, { lineageMode: 'AUTHORIZED_COMMITS' }, { candidateBuild: undefined },
      { candidateBuild: { ...build.CANDIDATE_BUILD, version: '0.1.0-rc.3' } },
      { candidateBuild: { ...build.CANDIDATE_BUILD, version: '0.1.0-commercial-rc.1' } },
      { candidateBuild: { ...build.CANDIDATE_BUILD, version: '0.1.0-commercial-rc.3' } },
      { candidateBuild: { ...build.CANDIDATE_BUILD, version: '0.1.0-commercial-rc.4' } },
      { candidateBuild: { ...build.CANDIDATE_BUILD, releaseReady: true } }]) {
      expect(() => build.selectCandidateAuthorization({ ...exception, additionalAuthorizations: [{ ...authorization, ...change }] }, 'codex/test'))
        .toThrow('ADDON_CANDIDATE_EXACT_AUTHORIZATION_REQUIRED')
    }
    expect(() => build.selectCandidateAuthorization(exception, 'codex/other')).toThrow()
    expect(() => build.selectCandidateAuthorization({ ...exception, additionalAuthorizations: [authorization, authorization] }, 'codex/test')).toThrow()
    expect(() => build.assertCandidateInput('approved.ts', 'changed', { 'approved.ts': 'approved' }, 'changed')).toThrow('ADDON_CANDIDATE_SOURCE_NOT_APPROVED')
    expect(() => build.assertCandidateInput('unchanged.ts', 'baseline', {}, 'baseline')).not.toThrow()
    expect(() => build.assertCandidateInput('extra.ts', 'draft', {}, null)).toThrow('ADDON_CANDIDATE_SOURCE_NOT_APPROVED')
  })

  it('actual candidate command fails on injected approval before any compiler or installer work', () => {
    const env: NodeJS.ProcessEnv = { ...process.env, ESHOP_ADDON_RELEASE_APPROVED: 'true' }
    for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key]
    delete env.NODE_OPTIONS
    delete env.NODE_PATH
    delete env.ESBUILD_BINARY_PATH
    const result = spawnSync(process.execPath, [script, '--candidate'], { cwd: tray, env, encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('ADDON_CANDIDATE_ENVIRONMENT_OVERRIDE')
  })

  it('does not accept environment values as compiler or signing authorization', () => {
    for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'ESBUILD_BINARY_PATH']) {
      expect(() => build.assertSafeBuildEnvironment({ [key]: 'sensitive-value' })).toThrow('ADDON_UNSAFE_BUILD_ENVIRONMENT')
    }
    expect(build.releaseBlockers({ sourceCommit: 'a'.repeat(40), workingTreeDirty: false }))
      .toEqual(['LEGITIMATE_SIGNING_ROUTE_NOT_CONFIGURED', 'TRUSTED_EXACT_RELEASE_MANIFEST_NOT_CONFIGURED'])
    expect(build.releaseBlockers({ sourceCommit: null, workingTreeDirty: true })).toContain('CLEAN_COMMITTED_SOURCE_REQUIRED')
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_0', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) {
      const env = Object.defineProperty({}, key, { enumerable: true, get: () => { throw new Error('credential read') } })
      expect(() => build.assertSafeBuildEnvironment(env)).toThrow('ADDON_UNSAFE_BUILD_ENVIRONMENT')
    }
  })

  it('rejects Git redirection before reading source identity or the supposed trusted ref', () => {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_DIR: '/invalid-sensitive-value' }
    const result = spawnSync(process.execPath, [script, '--candidate'], { cwd: tray, env, encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe('ADDON_UNSAFE_BUILD_ENVIRONMENT')
    expect(result.stderr).not.toContain('invalid-sensitive-value')
  })

  it('actual release command fails before compiler/installer work even with forged approval variables', () => {
    const env: NodeJS.ProcessEnv = { ...process.env, ESHOP_ADDON_RELEASE_APPROVED: 'true', CSC_IDENTITY_AUTO_DISCOVERY: 'true' }
    for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key]
    delete env.NODE_OPTIONS
    delete env.NODE_PATH
    delete env.ESBUILD_BINARY_PATH
    const result = spawnSync(process.execPath, [script, '--release'], { cwd: tray, env, encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('ADDON_RELEASE_NOT_READY')
    expect(result.stderr).toContain('LEGITIMATE_SIGNING_ROUTE_NOT_CONFIGURED')
    expect(result.stderr).not.toContain('sensitive-value')
  })

  it('seals exact source additions, removals and changed bytes regardless of key order', () => {
    expect(() => build.assertSnapshotMatch({ a: '1', b: '2' }, { b: '2', a: '1' })).not.toThrow()
    for (const other of [{ a: '1' }, { a: '1', b: '3' }, { a: '1', b: '2', c: '3' }]) {
      expect(() => build.assertSnapshotMatch({ a: '1', b: '2' }, other)).toThrow('ADDON_SOURCE_CHANGED_DURING_BUILD')
    }
  })

  it('draft manifests never claim an unsigned JavaScript bundle is a released installer', () => {
    const inputs = { 'e-shop-tray/network-addon/main.ts': 'd'.repeat(64) }
    const manifest = build.createManifest({
      source: { baselineCommit: build.BASELINE_COMMIT, headCommit: build.BASELINE_COMMIT,
        sourceCommit: null, workingTreeDirty: true }, inputs, outputs: { 'main.cjs': 'e'.repeat(64) }, tools: {},
    })
    expect(manifest).toMatchObject({ version: '0.1.0', sourceCommit: null, draftUnsignedJsOnly: true,
      installer: false, runtimeIncluded: false, releaseReady: false, published: false,
      buildClass: 'draft-js-only', signingStatus: 'not-applicable-js-only', desktopRepacked: false })
    expect(manifest.sourceSnapshotSha256).toBe(createHash('sha256').update(build.canonicalMapping(inputs)).digest('hex'))
  })

  it('candidate payload records a dirty source honestly and marks the transformed visible UI TEST ONLY', async () => {
    const manifest = build.createManifest({ source: { baselineCommit: build.BASELINE_COMMIT,
      headCommit: build.BASELINE_COMMIT, sourceCommit: null, workingTreeDirty: true }, inputs: {}, outputs: {}, tools: {}, candidate: { authorizationId: 'TEST-FIXTURE' } })
    expect(manifest).toMatchObject({ version: '0.1.0-commercial-rc.5', sourceCommit: null, workingTreeDirty: true,
      testOnly: true, installer: false, runtimeIncluded: false, releaseReady: false, published: false,
      installed: false, fieldVerified: false, buildClass: 'unsigned-test-candidate', signingStatus: 'unsigned-test-only' })
    const original = await readFile(path.join(tray, 'network-addon/ui.html'))
    const html = build.candidateHtml(original).toString()
    expect(html).toContain('<title>E-Shop Network Print — TEST ONLY</title>')
    expect(html).toContain('TEST ONLY · 0.1.0-commercial-rc.5')
    expect(html).toContain('未正式发布')
    expect(html).toContain('发送 TEST 纸票前须由负责人明确确认')
    expect(html.match(/id="[^"]+"/g)).toEqual(original.toString().match(/id="[^"]+"/g))
    expect(() => build.candidateHtml(Buffer.from('<main>unexpected</main>'))).toThrow('ADDON_CANDIDATE_UI_MARKER_MISMATCH')
  })

  it('rejects frozen Desktop/Windows/QZ code and credential material in packaged inputs', () => {
    for (const file of ['e-shop-tray/src/main.ts', 'desktop/src/main/main.ts', 'node_modules/qz-tray/qz.js',
      'e-shop-tray/src/printing/windowsQueueTransport.ts', 'e-shop-tray/network-candidate/bootstrap.cjs']) {
      expect(() => build.assertModuleBoundary(file)).toThrow('ADDON_FORBIDDEN_RUNTIME_INPUT')
    }
    for (const text of ['WindowsQueueTransport', 'Write-RawPrint.ps1', 'qz-tray',
      '-----BEGIN PRIVATE KEY-----', `ecc_v1_${'a'.repeat(40)}`, 'postgresql://private']) {
      expect(() => build.inspectPayload('main.cjs', Buffer.from(text))).toThrow()
    }
    expect(() => build.inspectPayload('Desktop.exe', Buffer.alloc(0))).toThrow('ADDON_UNEXPECTED_PAYLOAD_FILE')
    expect(() => build.assertModuleBoundary('lib/qzHtmlBitmapRenderer.ts')).not.toThrow()
    expect(() => build.assertModuleBoundary('lib/qzEscPosBitImage.ts')).not.toThrow()
  })

  it('keeps all Node/network access out of the GUI and sandboxed renderer preloads', () => {
    const metadata = (dependency: string) => ({ outputs: { bundle: { imports: [{ path: dependency, external: true }] } } })
    for (const filename of ['ui.js', 'preload.cjs', 'network-render.cjs']) {
      for (const dependency of ['node:fs', 'node:net', 'node:child_process', 'unbundled-package']) {
        expect(() => build.assertExternalBoundary(filename, metadata(dependency))).toThrow('ADDON_UNSAFE_EXTERNAL_IMPORT')
      }
    }
    expect(() => build.assertExternalBoundary('ui.js', metadata('electron'))).toThrow('ADDON_UNSAFE_EXTERNAL_IMPORT')
    expect(() => build.assertExternalBoundary('preload.cjs', metadata('electron'))).not.toThrow()
    expect(() => build.assertExternalBoundary('network-render.cjs', metadata('electron'))).not.toThrow()
    expect(() => build.assertExternalBoundary('main.cjs', metadata('node:net'))).not.toThrow()
    expect(() => build.assertExternalBoundary('main.cjs', metadata('unbundled-package'))).toThrow('ADDON_UNSAFE_EXTERNAL_IMPORT')
  })
})

describe('Network Add-on independent installer contract', () => {
  it('streams exact embedded application members with the real installed 7zip and detects mismatched payload bytes', async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'es-addon-archive-test-'))
    await mkdir(path.join(fixture, 'resources'))
    const asar = Buffer.from('synthetic unit-test ASAR content'), exe = Buffer.from('synthetic unit-test executable content')
    await writeFile(path.join(fixture, 'resources/app.asar'), asar)
    await writeFile(path.join(fixture, 'E-Shop-Network-Print-Addon.exe'), exe)
    const archive = path.join(fixture, 'application.7z'), env = build.candidateEnvironment({ PATH: process.env.PATH })
    const result = spawnSync(await load('builder-util').getPath7za(),
      ['a', '-t7z', archive, 'resources/app.asar', 'E-Shop-Network-Print-Addon.exe'], { cwd: fixture, env })
    expect(result.status).toBe(0)
    const embeddedAsar = await build.extractArchiveMember(archive, 'resources/app.asar', env)
    const embeddedExe = await build.extractArchiveMember(archive, 'E-Shop-Network-Print-Addon.exe', env)
    expect(embeddedAsar.equals(asar)).toBe(true)
    expect(embeddedExe.equals(exe)).toBe(true)
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
    expect(() => build.assertEmbeddedApplication(embeddedAsar, embeddedExe, hash(asar), hash(exe))).not.toThrow()
    expect(() => build.assertEmbeddedApplication(Buffer.from('wrong'), embeddedExe, hash(asar), hash(exe))).toThrow('ADDON_INSTALLER_APPLICATION_MISMATCH')
    expect(() => build.assertEmbeddedApplication(embeddedAsar, Buffer.from('wrong'), hash(asar), hash(exe))).toThrow('ADDON_INSTALLER_APPLICATION_MISMATCH')
    await expect(build.extractArchiveMember(archive, '../outside', env)).rejects.toThrow('ADDON_UNEXPECTED_ARCHIVE_MEMBER')
  })

  it('checks application architecture, unsigned PE headers, and both NSIS CRCs without repairing binaries', () => {
    function binary(uninstaller: boolean, payloads: Buffer[] = [], compress = false) {
      // Only synthetic unit-test fixtures receive computed CRCs.
      const pe = Buffer.alloc(1024)
      pe.write('MZ'); pe.writeUInt32LE(128, 60); pe.write('PE\0\0', 128)
      pe.writeUInt16LE(0x14c, 132); pe.writeUInt16LE(1, 134); pe.writeUInt16LE(224, 148)
      pe.writeUInt16LE(0x10b, 152); pe.writeUInt32LE(512, 212)
      pe.writeUInt32LE(512, 392); pe.writeUInt32LE(512, 396)
      const blocks = [Buffer.alloc(512), ...payloads].map(bytes => {
        const data = compress ? deflateRawSync(bytes) : bytes
        const length = Buffer.alloc(4); length.writeUInt32LE((data.length | (compress ? 0x80000000 : 0)) >>> 0)
        return Buffer.concat([length, data])
      })
      const header = Buffer.alloc(28)
      header.writeUInt32LE(uninstaller ? 1 : 0)
      Buffer.from('efbeadde4e756c6c736f6674496e7374', 'hex').copy(header, 4)
      header.writeUInt32LE(512, 20)
      header.writeUInt32LE(32 + blocks.reduce((sum, block) => sum + block.length, 0), 24)
      const result = Buffer.concat([pe, header, ...blocks, Buffer.alloc(4)])
      result.writeUInt32LE(build.crc32(result.subarray(512, -4)), result.length - 4)
      return result
    }
    const inner = binary(true), outer = binary(false, [inner], true), original = Buffer.from(outer)
    expect(build.inspectCandidateInstaller(outer).uninstallerBuffer.equals(inner)).toBe(true)
    const plugin = Buffer.from(inner.subarray(0, 1024)); plugin.writeUInt16LE(0x2000, 150)
    const otherPe = Buffer.from(inner.subarray(0, 1024)); otherPe.writeUInt16LE(0x8664, 132)
    expect(build.inspectCandidateInstaller(binary(false, [plugin, otherPe, inner], true)).uninstallerBuffer.equals(inner)).toBe(true)
    const archiveBlock = Buffer.concat([Buffer.from('377abcaf271c', 'hex'), Buffer.from('test archive block')])
    expect(build.inspectCandidateInstaller(binary(false, [inner, archiveBlock], true)).applicationArchives).toEqual([archiveBlock])
    expect(outer.equals(original)).toBe(true)
    const corrupt = Buffer.from(inner); corrupt[600] ^= 1
    expect(() => build.inspectCandidateInstaller(binary(false, [corrupt]))).toThrow('ADDON_NSIS_CRC_MISMATCH')
    expect(() => build.inspectCandidateInstaller(binary(false))).toThrow('ADDON_NSIS_UNINSTALLER_MISMATCH')
    expect(() => build.inspectCandidateInstaller(binary(false, [inner, inner]))).toThrow('ADDON_NSIS_UNINSTALLER_MISMATCH')
    expect(() => build.inspectUnsignedPe(inner, 0x8664)).toThrow('ADDON_INVALID_PE_ARCH')
    const signed = Buffer.from(inner); signed.writeUInt32LE(512, 280)
    expect(() => build.inspectUnsignedPe(signed, 0x14c)).toThrow('ADDON_CANDIDATE_UNEXPECTED_SIGNATURE')
    for (const mutate of [
      (bytes: Buffer) => bytes.writeUInt32LE(5, 1024),
      (bytes: Buffer) => bytes.writeUInt32LE(0xfffffff0, 396),
      (bytes: Buffer) => bytes.writeUInt32LE(0xfffffff0, 1052),
      (bytes: Buffer) => bytes.writeUInt32LE(513, 1044),
    ]) {
      const malformed = Buffer.from(outer); mutate(malformed)
      malformed.writeUInt32LE(build.crc32(malformed.subarray(512, -4)), malformed.length - 4)
      expect(() => build.inspectCandidateInstaller(malformed)).toThrow()
    }
    expect(() => build.inspectCandidateInstaller(outer.subarray(0, -1))).toThrow()
    expect(() => build.inspectCandidateInstaller(Buffer.concat([outer, Buffer.alloc(1)]))).toThrow()
  })

  it('derives only the TEST installer override without weakening formal signing or install-state protections', () => {
    const before = JSON.stringify(builder)
    const candidate = build.candidateBuilderConfig('/private/tmp/es-network-addon-TEST-example')
    expect(candidate).toMatchObject({ appId: builder.appId, productName: `${build.PRODUCT_NAME} (TEST ONLY)`,
      electronVersion: '44.3.0', forceCodeSigning: false, cscLink: '', cscKeyPassword: '', publish: null,
      win: { target: [{ target: 'nsis', arch: ['x64'] }], executableName: builder.win.executableName,
        signAndEditExecutable: false, sign: null, azureSignOptions: null, signtoolOptions: null,
        certificateFile: null, certificateSubjectName: null, certificateSha1: null, cscLink: '', publish: null },
      nsis: { perMachine: false, allowElevation: false, packElevateHelper: false, runAfterFinish: false,
        deleteAppDataOnUninstall: false, shortcutName: `${build.PRODUCT_NAME} (TEST ONLY)` } })
    expect(candidate.files).toEqual(builder.files)
    expect(candidate.win.artifactName).toBe('E-Shop-Network-Print-Addon-TEST-${version}-x64.exe')
    expect(candidate.directories.output).toBe('/private/tmp/es-network-addon-TEST-example/artifacts')
    expect(candidate.nsis.include).toBe('/private/tmp/es-network-addon-TEST-example/packaging/installer.nsh')
    expect(JSON.stringify(builder)).toBe(before)
    expect(builder.forceCodeSigning).toBe(true)
  })
  it('requires signing, pins its own runtime and publishes nothing automatically', () => {
    expect(builder.appId).toBe(build.APP_ID)
    expect(builder.electronVersion).toBe('44.3.0')
    expect(builder.forceCodeSigning).toBe(true)
    expect(builder.win.signAndEditExecutable).toBe(true)
    expect(builder.win.verifyUpdateCodeSignature).toBe(true)
    expect(builder.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }])
    expect(builder.publish).toBeNull()
    expect(builder.win.publish).toBeNull()
    expect(builder.extraResources).toEqual([])
    expect(builder.extraFiles).toEqual([])
    expect(builder.files).toEqual(expect.arrayContaining([...build.PAYLOAD_FILES, 'build-manifest.json']))
    expect(builder.files).not.toContain('**/*')
  })

  it('preserves state, requires safe exit, and refuses dangerous installer overrides', () => {
    expect(builder.nsis).toMatchObject({ perMachine: false, allowElevation: false, packElevateHelper: false,
      allowToChangeInstallationDirectory: false, runAfterFinish: false, deleteAppDataOnUninstall: false })
    expect(installer).toContain('nsProcess::_FindProcess /NOUNLOAD "E-Shop-Network-Print-Addon.exe"')
    expect(installer).toContain('${ElseIf} $R0 != 603')
    expect(installer).not.toMatch(/_KillProcess|taskkill|RMDir|DeleteRegKey|WriteReg.*ESHOP_CLOUD/)
    for (const macro of ['customInit', 'customUnInit']) {
      const body = installer.split(`!macro ${macro}\n`)[1].split('!macroend')[0]
      expect(body).toContain('!insertmacro addonCheckArguments')
      expect(body).toContain('!insertmacro customCheckAppRunning')
    }
    expect(installer).toContain('${If} ${isDeleteAppData}')
    expect(installer).toContain('${If} ${isForAllUsers}')
    expect(installer).toContain('${If} ${isForceRun}')
    expect(installer).toContain('${StdUtils.GetParameter} $R0 "D" ""')
    expect(installer).toContain('${IfNot} ${isUpdated}')
    expect(installer).toContain('"EShopNetworkPrintAddon"')
    expect(installer).not.toContain('E-Shop 店小二')
  })

  it('disables all builder name-only shortcut actions and protects the legacy uninstall phase', async () => {
    expect(builder.nsis).toMatchObject({ createDesktopShortcut: false, createStartMenuShortcut: false })
    expect(build.candidateBuilderConfig('/private/tmp/es-network-addon-TEST-fixture').nsis)
      .toMatchObject({ createDesktopShortcut: false, createStartMenuShortcut: false })
    const init = installer.split('!macro customInit\n')[1].split('!macroend')[0]
    expect(init).toContain('ReadRegStr $R1 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString')
    expect(init).toContain('ReadRegStr $R2 HKCU "${INSTALL_REGISTRY_KEY}" KeepShortcuts')
    expect(init).toContain('${OrIf} $R2 != "true"')
    expect(init).toContain('IfFileExists "$R0\\E-Shop-Network-Print-Addon.exe"')
    expect(init).not.toMatch(/WriteRegStr|Delete|Rename/)
    const uninit = installer.split('!macro customUnInit\n')[1].split('!macroend')[0]
    expect(uninit).toContain('${IfNot} ${isUpdated}')
    expect(uninit).toContain('--uninstall-shortcuts')
    expect(uninit.indexOf('!insertmacro customCheckAppRunning')).toBeLessThan(uninit.indexOf('ExecWait'))
    expect(uninit.indexOf('ExecWait')).toBeLessThan(uninit.indexOf('SetOutPath'))
    expect(uninit).toContain('${If} ${Errors}')
    const install = installer.split('!macro customInstall\n')[1].split('!macroend')[0]
    expect(install).toContain('--install-shortcuts')
    expect(install).toContain('${If} ${Silent}')
    expect(install).toContain('--install-shortcuts --silent-shortcuts')
    expect(install).toMatch(/IfSilent \+2 0\s+MessageBox/)
    expect(install).toMatch(/SetErrorLevel 7\s+(?:;[^\n]*\n\s*)*Quit/)
    expect(install).not.toMatch(/--cashier|--enable|Delete|Rename/)
    // Verify the installed, pinned toolchain's real order, not a copied model.
    const section = await readFile(load.resolve('app-builder-lib/templates/nsis/installSection.nsh'), 'utf8')
    const uninstall = await readFile(load.resolve('app-builder-lib/templates/nsis/uninstaller.nsh'), 'utf8')
    const helper = await readFile(load.resolve('app-builder-lib/templates/nsis/include/installUtil.nsh'), 'utf8')
    expect(section.indexOf('uninstallOldVersion')).toBeLessThan(section.indexOf('customInstall'))
    expect(uninstall.indexOf('Delete "$oldDesktopLink"')).toBeLessThan(uninstall.indexOf('customUnInstall'))
    expect(helper).toContain('${if} $R5 == "true"\n    ${andIf} ${FileExists} "$appExe"')
    expect(helper).toContain('StrCpy $0 "$0 --keep-shortcuts"')
    const common = await readFile(load.resolve('app-builder-lib/templates/nsis/common.nsh'), 'utf8')
    expect(common).toMatch(/!macro quitSuccess\s+SetErrorLevel 0/)
  })

  it('keeps installer ownership prompts explicit and maintenance isolated from startup and printing', async () => {
    const main = await readFile(path.join(tray, 'network-addon/main.ts'), 'utf8')
    const helper = main.split('else if (helperMode) {')[1].split('} else {\n  app.on')[0]
    expect(helper).toContain('installShortcuts(silentShortcutArgs.length ? undefined : async item =>')
    expect(helper).toContain('checkboxChecked: false')
    expect(helper).toContain('defaultId: 0, cancelId: 0')
    expect(helper).toContain('result.response === 1 && result.checkboxChecked === true')
    expect(helper).toContain("login && !login.background")
    expect(helper).toContain("args: ['--background'], openAtLogin: true, enabled: login.enabled")
    expect(helper).not.toMatch(/entry\.initialize\(|poller[?!]?\.|profile[?!]?\.|sendTest\(|openCashier\(/)
    const install = main.split('async function installShortcuts(')[1].split('function currentLoginItem')[0]
    expect(install).toContain('reviewLegacyShortcuts(manager, confirmLegacy)')
    expect(install).toContain("['PRESERVED', 'UNAVAILABLE', 'NEEDS_CONFIRMATION']")
    expect(install).not.toContain('setLoginItemSettings')
    const enable = main.split("case 'enable': {")[1].split("case 'autostart':")[0]
    expect(enable).not.toContain('setLoginItemSettings')
    const html = await readFile(path.join(tray, 'network-addon/ui.html'), 'utf8')
    expect(html).toContain('<details open><summary>桌面入口整理')
    expect(html).toContain('启用打印不会擅自恢复已关闭的自启')
  })
})
