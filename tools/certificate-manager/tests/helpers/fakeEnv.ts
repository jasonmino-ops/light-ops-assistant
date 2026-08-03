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
  isQzRunning: () => boolean
  qzPid: () => number
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
  /** 模拟 qz-tray.jar 缺失（安装资产不完整）。 */
  omitJar?: boolean
  /**
   * 模拟 PowerShell 读 ProductVersion 的结果：
   * ok      —— 正常返回 qzVersion
   * fail    —— 命令返回非 0（PowerShell 被策略禁用等）
   * garbage —— 命令成功但输出里没有版本号
   */
  qzVersionQuery?: 'ok' | 'fail' | 'garbage'
  /** taskkill 后进程仍然不退出。 */
  failStop?: boolean
  /** start 之后进程始终不出现。 */
  failStart?: boolean
  /** 模拟现场：QZ 由 runtime\bin\javaw.exe 启动，安装目录下没有 qz-tray.exe。 */
  omitExe?: boolean
  /** 当前进程是否已提升（管理员令牌）。 */
  elevated?: boolean
  /** 当前账户是否属于 Administrators 组。 */
  inAdminGroup?: boolean
  /** 令牌探测是否可用；fail 时 admin.ts 会退回目录写探针。 */
  adminQuery?: 'ok' | 'fail'
  /** 注册表卸载项里的 DisplayVersion；null 表示不存在。 */
  registryDisplayVersion?: string | null
  /** 额外的候选进程行（pid|name|sessionId|commandLine），用于干扰项测试。 */
  extraProcesses?: string[]
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
    // 有效期写死在过去→未来，不用 -days。
    // 否则 notBefore 是"生成的此刻"，而夹具的 now 固定在 10:00 UTC，
    // 一旦在当天 10:00 UTC 之后跑测试，证书就会被判成"尚未生效"。
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(work, 'ca.key'), '-out', join(work, 'ca.crt'),
      '-not_before', '20200101000000Z', '-not_after', '20360101000000Z',
      '-sha256', '-config', cnf,
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
    omitJar = false,
    qzVersionQuery = 'ok',
    failStop = false,
    failStart = false,
    omitExe = false,
    elevated = true,
    inAdminGroup = true,
    adminQuery = 'ok',
    registryDisplayVersion = null,
    extraProcesses = [],
  } = options

  const root = mkdtempSync(join(tmpdir(), 'eshop-cm-'))
  const qzDir = join(root, 'Program Files', 'QZ Tray')
  const propsPath = join(qzDir, 'qz-tray.properties')
  const packageDir = join(root, 'certificate-package')
  const processCalls: Array<{ command: string; args: string[] }> = []
  let qzRunning = false

  // 真实 QZ Tray 2.2.6 的 Windows 安装结构：
  //   qz-tray.exe / qz-tray.jar / libs\ / qz-tray.properties
  // 没有 jpackage 的 app\*.cfg，也没有 version.txt。
  if (qzInstalled) {
    mkdirSync(join(qzDir, 'libs'), { recursive: true })
    // 现场 QZ 以 bundled runtime 启动，qz-tray.exe 未必存在
    mkdirSync(join(qzDir, 'runtime', 'bin'), { recursive: true })
    writeFileSync(join(qzDir, 'runtime', 'bin', 'javaw.exe'), 'stub')
    if (!omitExe) writeFileSync(join(qzDir, 'qz-tray.exe'), 'stub')
    if (!omitJar) writeFileSync(join(qzDir, 'qz-tray.jar'), 'stub')
    writeFileSync(join(qzDir, 'libs', 'jetty-server.jar'), 'stub')
    if (qzPropertiesContent !== null) writeFileSync(propsPath, qzPropertiesContent)
  }

  if (withPackage) {
    const ca = options.pem
      ? { pem: options.pem, fingerprint: new X509Certificate(options.pem).fingerprint256.toUpperCase() }
      : makeCa(1)
    writePackage(packageDir, ca.pem, packageVersion)
  }

  // 每次"启动"都用一个新 PID，才能验证 start 确认要求新 PID 与旧 PID 不同
  let qzPid = 4321
  const qzCommandLine =
    `"${join(qzDir, 'runtime', 'bin', 'javaw.exe')}" -Xms512m -jar "${join(qzDir, 'qz-tray.jar')}"`

  const runProcess: ProcessRunner = (command, args) => {
    processCalls.push({ command, args })
    const script = args.join(' ')

    if (command === 'powershell') {
      // 管理员令牌探测
      if (script.includes('WindowsIdentity')) {
        if (adminQuery === 'fail') return { ok: false, output: '拒绝访问' }
        return { ok: true, output: `ELEVATED=${elevated ? 'True' : 'False'}\r\nINGROUP=${inAdminGroup ? 'True' : 'False'}\r\n` }
      }
      // 候选进程枚举：真机上 CIM 已按镜像名过滤，这里返回同样形状的数据
      // pid|name|sessionId|commandLine
      if (script.includes('Win32_Process')) {
        const rows = [...extraProcesses]
        if (qzRunning) rows.unshift(`${qzPid}|javaw.exe|1|${qzCommandLine}`)
        return { ok: true, output: rows.join('\r\n') }
      }
      // qz-tray.exe 的 ProductVersion
      if (script.includes('VersionInfo.ProductVersion')) {
        if (qzVersionQuery === 'fail') {
          return { ok: false, output: '无法加载文件，因为在此系统上禁止运行脚本。' }
        }
        if (qzVersionQuery === 'garbage') return { ok: true, output: '\r\n' }
        return { ok: true, output: `${qzVersion}\r\n` }
      }
      return { ok: false, output: '' }
    }

    if (command === 'reg') {
      if (args.includes('DisplayVersion') && registryDisplayVersion) {
        return { ok: true, output: `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\...\\QZ Tray\r\n    DisplayVersion    REG_SZ    ${registryDisplayVersion}\r\n\r\n` }
      }
      return { ok: false, output: '错误: 系统找不到指定的注册表项或值。' }
    }

    if (command === 'taskkill') {
      // taskkill 几乎总是返回 0；失败场景下进程照样活着，正是要被确认捕获的情况
      if (!failStop) qzRunning = false
      return { ok: true, output: 'SUCCESS' }
    }
    if (command === 'cmd') {
      if (!failStart) { qzPid += 1; qzRunning = true }
      return { ok: true, output: '' }
    }
    return { ok: false, output: '' }
  }

  return {
    root,
    qzDir,
    propsPath,
    processCalls,
    setQzRunning: (running: boolean) => { qzRunning = running },
    isQzRunning: () => qzRunning,
    qzPid: () => qzPid,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    env: {
      qzInstallDir: qzInstalled ? qzDir : null,
      qzInstallSource: qzInstalled ? '测试直接注入' : '测试：未安装',
      eshopDir: join(root, 'ProgramData', 'E-Shop', 'CertificateManager'),
      packageDir,
      runProcess,
      sleep: () => { /* 测试里不真的等待 */ },
      selfPid: 999_999,
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
