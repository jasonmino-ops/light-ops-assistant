import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 运行环境描述。真机上由 resolveWindowsEnv() 生成；
 * 测试里传入临时目录，从而在 macOS/Linux 上完整跑通全部流程，
 * 不触碰任何真实系统路径。
 */
export type Env = {
  /** QZ Tray 安装目录（可能是 D:\qz tray 这类自定义路径）。null 表示未检出。 */
  qzInstallDir: string | null
  /** 该目录是怎么找到的，用于界面显示与排障。 */
  qzInstallSource: string | null
  /** E-Shop 自有数据根目录，例如 C:\ProgramData\E-Shop\CertificateManager。 */
  eshopDir: string
  /** 随程序携带的 Certificate Package 目录。 */
  packageDir: string
  /** 结束/启动 QZ Tray 用的执行器；测试中可注入假实现。 */
  runProcess: ProcessRunner
  /** 同步等待，用于轮询确认进程起停；测试中注入空实现以免拖慢用例。 */
  sleep: (ms: number) => void
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
 * 目录写探针。**不再作为管理员判定的主判据** ——
 * 见 admin.ts：QZ 目录没被发现时探针必然失败，会把权限误报成不足。
 * 这里只在读不到进程令牌时充当兜底。
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
