import { execFileSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Env, ProcessRunner } from '../../src/core/env'

/**
 * 全部测试都在临时目录里模拟一台 Windows 机器，
 * 不读写任何真实的 QZ Tray / ProgramData 路径。
 */
export type Fake = {
  env: Env
  root: string
  qzDir: string
  propsPath: string
  cleanup: () => void
  processCalls: Array<{ command: string; args: string[] }>
  setQzRunning: (running: boolean) => void
}

export type FakeOptions = {
  qzInstalled?: boolean
  qzVersion?: string
  qzPropertiesContent?: string | null
  packageVersion?: number
  withPackage?: boolean
  /** 复用已有的 CA PEM，用于"更新到不同证书"这类场景。 */
  pem?: string
  now?: Date
}

let cachedCa: { pem: string; fingerprint: string } | null = null
let cachedCa2: { pem: string; fingerprint: string } | null = null

/** 生成一个自签名 CA。私钥只在临时目录短暂存在，随即销毁。 */
export function makeCa(seed = 1): { pem: string; fingerprint: string } {
  if (seed === 1 && cachedCa) return cachedCa
  if (seed === 2 && cachedCa2) return cachedCa2

  const work = mkdtempSync(join(tmpdir(), 'eshop-test-ca-'))
  try {
    const cnf = join(work, 'o.cnf')
    writeFileSync(cnf, [
      '[req]', 'distinguished_name = dn', 'x509_extensions = v3_ca', 'prompt = no',
      '[dn]', 'C = KH', 'O = E-Shop Test', `CN = E-Shop Test Root CA ${seed}`,
      '[v3_ca]', 'basicConstraints = critical,CA:TRUE', 'keyUsage = critical,keyCertSign,cRLSign',
    ].join('\n'))
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(work, 'ca.key'), '-out', join(work, 'ca.crt'),
      '-days', '3650', '-sha256', '-config', cnf,
    ], { stdio: 'pipe' })
    const pem = readFileSync(join(work, 'ca.crt'), 'utf8')
    const result = { pem, fingerprint: new X509Certificate(pem).fingerprint256.toUpperCase() }
    if (seed === 1) cachedCa = result
    else cachedCa2 = result
    return result
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** 生成一张已经过期的 CA，用于"有效期异常"场景。 */
export function makeExpiredCa(): { pem: string; fingerprint: string } {
  const work = mkdtempSync(join(tmpdir(), 'eshop-test-ca-exp-'))
  try {
    const cnf = join(work, 'o.cnf')
    writeFileSync(cnf, [
      '[req]', 'distinguished_name = dn', 'x509_extensions = v3_ca', 'prompt = no',
      '[dn]', 'C = KH', 'O = E-Shop Test', 'CN = E-Shop Expired Root CA',
      '[v3_ca]', 'basicConstraints = critical,CA:TRUE',
    ].join('\n'))
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(work, 'ca.key'), '-out', join(work, 'ca.crt'),
      '-not_before', '20200101000000Z', '-not_after', '20210101000000Z',
      '-sha256', '-config', cnf,
    ], { stdio: 'pipe' })
    const pem = readFileSync(join(work, 'ca.crt'), 'utf8')
    return { pem, fingerprint: new X509Certificate(pem).fingerprint256.toUpperCase() }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

export const DEFAULT_QZ_PROPERTIES = [
  '#Fri Aug 01 09:12:33 ICT 2026',
  'wss.alias=qz-tray',
  'wss.keystore=C\\:\\\\Program Files\\\\QZ Tray\\\\auth\\\\qz-tray.jks',
  'wss.storepass=abc123',
  'wss.host=0.0.0.0',
  '',
].join('\n')

export function makeFake(options: FakeOptions = {}): Fake {
  const {
    qzInstalled = true,
    qzVersion = '2.2.6',
    qzPropertiesContent = DEFAULT_QZ_PROPERTIES,
    packageVersion = 1,
    withPackage = true,
    now = new Date('2026-08-03T10:00:00.000Z'),
  } = options

  const root = mkdtempSync(join(tmpdir(), 'eshop-cm-'))
  const qzDir = join(root, 'Program Files', 'QZ Tray')
  const propsPath = join(qzDir, 'qz-tray.properties')
  const packageDir = join(root, 'certificate-package')
  const processCalls: Array<{ command: string; args: string[] }> = []
  let qzRunning = false

  if (qzInstalled) {
    mkdirSync(join(qzDir, 'app'), { recursive: true })
    writeFileSync(join(qzDir, 'qz-tray.exe'), 'stub')
    writeFileSync(join(qzDir, 'app', 'qz-tray.cfg'), `[Application]\napp.version=${qzVersion}\n`)
    if (qzPropertiesContent !== null) writeFileSync(propsPath, qzPropertiesContent)
  }

  if (withPackage) {
    const ca = options.pem
      ? { pem: options.pem, fingerprint: new X509Certificate(options.pem).fingerprint256.toUpperCase() }
      : makeCa(1)
    writePackage(packageDir, ca.pem, packageVersion)
  }

  const runProcess: ProcessRunner = (command, args) => {
    processCalls.push({ command, args })
    if (command === 'tasklist') {
      return { ok: true, output: qzRunning ? 'qz-tray.exe  1234 Console' : 'INFO: No tasks are running.' }
    }
    if (command === 'taskkill') { qzRunning = false; return { ok: true, output: 'SUCCESS' } }
    if (command === 'cmd') { qzRunning = true; return { ok: true, output: '' } }
    return { ok: false, output: '' }
  }

  return {
    root,
    qzDir,
    propsPath,
    processCalls,
    setQzRunning: (running: boolean) => { qzRunning = running },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    env: {
      qzInstallDir: qzInstalled ? qzDir : null,
      eshopDir: join(root, 'ProgramData', 'E-Shop', 'CertificateManager'),
      packageDir,
      runProcess,
      now: () => now,
    },
  }
}

export function writePackage(dir: string, pem: string, version: number, overrides: Record<string, unknown> = {}): void {
  mkdirSync(dir, { recursive: true })
  const x509 = new X509Certificate(pem)
  writeFileSync(join(dir, 'eshop-root-ca.crt'), pem)
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    schema: 'eshop.certificate-package/v1',
    certificateId: 'eshop-root-ca',
    version,
    displayName: 'E-Shop Root CA',
    rootFile: 'eshop-root-ca.crt',
    rootFingerprint: x509.fingerprint256.toUpperCase(),
    validFrom: new Date(x509.validFrom).toISOString(),
    validTo: new Date(x509.validTo).toISOString(),
    minimumQzVersion: '2.2.5',
    ...overrides,
  }, null, 2))
}
