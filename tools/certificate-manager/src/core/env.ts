import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 运行环境描述。真机上由 resolveWindowsEnv() 生成；
 * 测试里传入临时目录，从而在 macOS/Linux 上完整跑通全部流程，
 * 不触碰任何真实系统路径。
 */
export type Env = {
  /** QZ Tray 安装目录，例如 C:\Program Files\QZ Tray。null 表示未检出。 */
  qzInstallDir: string | null
  /** E-Shop 自有数据根目录，例如 C:\ProgramData\E-Shop\CertificateManager。 */
  eshopDir: string
  /** 随程序携带的 Certificate Package 目录。 */
  packageDir: string
  /** 结束/启动 QZ Tray 用的执行器；测试中可注入假实现。 */
  runProcess: ProcessRunner
  now: () => Date
}

export type ProcessRunner = (
  command: string,
  args: string[],
) => { ok: boolean; output: string }

export const QZ_PROPERTIES_FILE = 'qz-tray.properties'
export const AUTHCERT_OVERRIDE_KEY = 'authcert.override'
/** QZ 在 authcert.override 里用 ';' 分隔多个证书路径（FileUtilities.FILE_SEPARATOR）。 */
export const QZ_PATH_DELIMITER = ';'
export const ESHOP_CERT_FILENAME = 'eshop-root-ca.crt'

export function qzPropertiesPath(env: Env): string | null {
  return env.qzInstallDir ? join(env.qzInstallDir, QZ_PROPERTIES_FILE) : null
}

/** E-Shop 部署的 Root 证书目标路径。刻意放在 E-Shop 自己的目录，不污染 QZ 安装目录。 */
export function eshopCertPath(env: Env): string {
  return join(env.eshopDir, 'certs', ESHOP_CERT_FILENAME)
}

export function eshopStatePath(env: Env): string {
  return join(env.eshopDir, 'state.json')
}

export function eshopBackupDir(env: Env): string {
  return join(env.eshopDir, 'backups')
}

export function eshopLogPath(env: Env): string {
  return join(env.eshopDir, 'certificate-manager.log')
}

/**
 * 管理员判定：直接对 QZ 安装目录做一次写探针。
 * 比解析 whoami/net session 更贴近实际需要的权限，且跨平台可测。
 */
export function canWriteQzDir(env: Env): boolean {
  if (!env.qzInstallDir || !existsSync(env.qzInstallDir)) return false
  const probe = join(env.qzInstallDir, '.eshop-write-probe')
  try {
    writeFileSync(probe, '')
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

export function ensureEshopDirs(env: Env): void {
  mkdirSync(join(env.eshopDir, 'certs'), { recursive: true })
  mkdirSync(eshopBackupDir(env), { recursive: true })
}

/** Windows 上 QZ Tray 的标准安装位置（qzind/tray：APP_DIR）。 */
const WINDOWS_QZ_CANDIDATES = [
  'C:\\Program Files\\QZ Tray',
  'C:\\Program Files (x86)\\QZ Tray',
]

export function detectQzInstallDir(
  candidates: string[] = WINDOWS_QZ_CANDIDATES,
): string | null {
  for (const dir of candidates) {
    if (existsSync(join(dir, QZ_PROPERTIES_FILE))) return dir
    if (existsSync(join(dir, 'qz-tray.exe'))) return dir
  }
  return null
}
