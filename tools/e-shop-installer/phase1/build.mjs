import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REQUIRED_PAYLOAD_PATHS = [
  'E-Shop-V1-Setup.ps1',
  'MANIFEST.json',
  'app/eshop-v1-setup.cjs',
  'runtime/node.exe',
  'runtime/LICENSE',
  'setup-payload/E-Shop-DianXiaoEr-Setup-0.4.7-x64.exe',
  'setup-payload/qz-tray-2.2.6.exe',
  'setup-payload/certificate-package/manifest.json',
  'setup-payload/certificate-package/eshop-root-ca.crt',
  'Drivers/Rongta/README.txt',
  'Drivers/Xprinter/README.txt',
]

const SECRET_FILE_PATTERN = /(?:^|\/)(?:identity\.json|[^/]+\.(?:key|p12|pfx|jks|keystore))$/i
const PRIVATE_MATERIAL_PATTERN = /-----BEGIN (?:RSA |EC |ENCRYPTED |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}/
const FIXED_GOLDEN_ENVIRONMENT_PATTERN = /192\.168\.18\.49|RongtaUSB PORT:/i
const TEXT_FILE_PATTERN = /\.(?:cjs|crt|json|pem|ps1|txt)$/i
const INSTALLER_SCRIPT_PATH = fileURLToPath(new URL('./installer.nsi', import.meta.url))

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function walk(dir, root = dir) {
  const paths = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) paths.push(...walk(full, root))
    else paths.push(full.slice(root.length + 1).replaceAll('\\', '/'))
  }
  return paths
}

function assertFile(root, relativePath) {
  const path = join(root, ...relativePath.split('/'))
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`missing required payload: ${relativePath}`)
}

export function validateMvpPayload(inputDir) {
  const payloadDir = resolve(inputDir)
  for (const path of REQUIRED_PAYLOAD_PATHS) assertFile(payloadDir, path)

  const manifest = JSON.parse(readFileSync(join(payloadDir, 'MANIFEST.json'), 'utf8'))
  if (manifest.schema !== 'eshop.setup-mvp-candidate/v1') throw new Error('unsupported MVP manifest schema')
  if (typeof manifest.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(manifest.sourceCommit)) {
    throw new Error('invalid source commit in MVP manifest')
  }
  if (typeof manifest.candidateVersion !== 'string' || manifest.candidateVersion.length === 0) {
    throw new Error('invalid candidate version in MVP manifest')
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('MVP manifest files are missing')

  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || typeof file.sha256 !== 'string') {
      throw new Error('invalid MVP manifest file entry')
    }
    assertFile(payloadDir, file.path)
    if (sha256(join(payloadDir, ...file.path.split('/'))) !== file.sha256.toLowerCase()) {
      throw new Error(`MVP payload hash mismatch: ${file.path}`)
    }
  }

  const files = walk(payloadDir)
  for (const file of files) {
    if (SECRET_FILE_PATTERN.test(file)) throw new Error(`sensitive file is forbidden: ${file}`)
    const path = join(payloadDir, ...file.split('/'))
    if (TEXT_FILE_PATTERN.test(file)) {
      const text = readFileSync(path, 'utf8')
      if (PRIVATE_MATERIAL_PATTERN.test(text)) throw new Error(`private material is forbidden: ${file}`)
    }
  }

  for (const family of ['Rongta', 'Xprinter']) {
    const driverDir = join(payloadDir, 'Drivers', family)
    const installers = readdirSync(driverDir).filter((name) => /\.(?:exe|msi)$/i.test(name))
    if (installers.length > 0) throw new Error(`${family} driver payload must remain external`)
  }

  for (const file of ['E-Shop-V1-Setup.ps1', 'app/eshop-v1-setup.cjs']) {
    if (FIXED_GOLDEN_ENVIRONMENT_PATTERN.test(readFileSync(join(payloadDir, ...file.split('/')), 'utf8'))) {
      throw new Error(`fixed golden-machine environment is forbidden: ${file}`)
    }
  }

  return { payloadDir, manifest }
}

export function validateInstallerScript(scriptPath = INSTALLER_SCRIPT_PATH) {
  const script = readFileSync(scriptPath, 'utf8')
  const forbiddenVariables = ['$' + 'PROGRAMDATA', '$' + 'COMMONPROGRAMDATA', '$' + 'COMMONAPPDATA']
  for (const variable of forbiddenVariables) {
    if (script.includes(variable)) throw new Error(`forbidden unresolved NSIS path variable: ${variable}`)
  }

  const requiredLines = [
    'ExpandEnvStrings $INSTDIR "%ProgramData%\\E-Shop\\Installer\\MVP"',
    'SetOutPath "$INSTDIR"',
    'CreateDirectory "$INSTDIR\\Drivers\\Rongta"',
    'CreateDirectory "$INSTDIR\\Drivers\\Xprinter"',
    'CopyFiles /SILENT "$EXEDIR\\Drivers\\Rongta\\*.exe" "$INSTDIR\\Drivers\\Rongta"',
    'CopyFiles /SILENT "$EXEDIR\\Drivers\\Xprinter\\*.exe" "$INSTDIR\\Drivers\\Xprinter"',
    '-File "$INSTDIR\\E-Shop-V1-Setup.ps1"',
  ]
  for (const line of requiredLines) {
    if (!script.includes(line)) throw new Error(`installer target is not based on resolved $INSTDIR: ${line}`)
  }
  if (/^\s*InstallDir\b/m.test(script)) throw new Error('InstallDir must not provide an unresolved ProgramData path')
  if (!script.includes('Function .onInit') || !script.includes('FunctionEnd')) {
    throw new Error('installer initialization path resolution is missing')
  }
  if (!script.includes('File /r "${PAYLOAD_ROOT}/*.*"')) throw new Error('MVP payload destination is not validated')
  if (!script.includes('Windows ProgramData could not be resolved') ||
      !script.includes('Windows ProgramData was not expanded') ||
      !script.includes('Windows ProgramData did not resolve to an absolute path')) {
    throw new Error('ProgramData resolution must fail closed')
  }

  return { scriptPath: resolve(scriptPath) }
}

function option(name, args) {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : null
}

function resolveMakensis() {
  const candidates = [
    process.env.MAKENSIS_BIN,
    join(homedir(), 'Library/Caches/electron-builder/nsis/nsis-3.0.4.1/mac/makensis'),
    '/usr/local/bin/makensis',
    '/opt/homebrew/bin/makensis',
  ].filter(Boolean)
  const binary = candidates.find((candidate) => existsSync(candidate))
  if (!binary) throw new Error('makensis is not available; set MAKENSIS_BIN')
  return resolve(binary)
}

function nsisRoot(makensis) {
  const cachedRoot = resolve(dirname(makensis), '..')
  return existsSync(join(cachedRoot, 'Stubs')) ? cachedRoot : process.env.NSISDIR
}

export function buildInstaller({ payloadDir: inputDir, outputDir: inputOutputDir }) {
  const { payloadDir, manifest } = validateMvpPayload(inputDir)
  validateInstallerScript()
  const outputDir = resolve(inputOutputDir)
  mkdirSync(outputDir, { recursive: true })
  const outputFile = join(outputDir, 'E-Shop-V4-Setup.exe')
  rmSync(outputFile, { force: true })

  const makensis = resolveMakensis()
  const script = INSTALLER_SCRIPT_PATH
  const env = { ...process.env }
  const root = nsisRoot(makensis)
  if (root) env.NSISDIR = root
  const result = spawnSync(makensis, [
    '-V2',
    `-DPAYLOAD_ROOT=${payloadDir}`,
    `-DOUTPUT_FILE=${outputFile}`,
    `-DSOURCE_COMMIT=${manifest.sourceCommit}`,
    `-DCANDIDATE_VERSION=${manifest.candidateVersion}`,
    script,
  ], { cwd: dirname(script), env, encoding: 'utf8' })

  if (result.status !== 0) {
    throw new Error(`makensis failed (${result.status ?? 'unknown'}): ${result.stderr || result.stdout}`)
  }
  if (!existsSync(outputFile) || readFileSync(outputFile).subarray(0, 2).toString('ascii') !== 'MZ') {
    throw new Error('NSIS did not produce a valid Windows PE executable')
  }

  return {
    outputFile,
    filename: basename(outputFile),
    bytes: statSync(outputFile).size,
    sha256: sha256(outputFile),
    sourceCommit: manifest.sourceCommit,
    candidateVersion: manifest.candidateVersion,
    framework: 'NSIS 3.0.4.1',
  }
}

function main() {
  const args = process.argv.slice(2)
  const payloadDir = option('--payload-dir', args)
  const outputDir = option('--output-dir', args)
  if (!payloadDir || !outputDir) {
    throw new Error('usage: build.mjs --payload-dir <E-Shop MVP directory> --output-dir <directory>')
  }
  process.stdout.write(`${JSON.stringify(buildInstaller({ payloadDir, outputDir }), null, 2)}\n`)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`E-Shop Installer Packaging failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
    process.exitCode = 1
  }
}
