import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import type { Env, ProcessRunner } from '../core/env'
import { detectQzInstallDir } from '../core/env'

const runProcess: ProcessRunner = (command, args) => {
  try {
    const res = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
    return {
      ok: res.status === 0,
      output: `${res.stdout ?? ''}${res.stderr ?? ''}`,
    }
  } catch (e) {
    return { ok: false, output: (e as Error).message }
  }
}

/**
 * 真机环境。
 * - QZ 目录：C:\Program Files\QZ Tray（qzind/tray APP_DIR）
 * - E-Shop 自有目录：%PROGRAMDATA%\E-Shop\CertificateManager
 *   刻意不放进 QZ 安装目录，卸载时整目录可清，且不会和 QZ 自己的文件混淆。
 * - 证书包：打包后位于 resources/certificate-package，开发时位于仓库目录。
 */
export function resolveWindowsEnv(options: {
  packageDir: string
  qzInstallDir?: string | null
  programData?: string
}): Env {
  const programData = options.programData ?? process.env.PROGRAMDATA ?? 'C:\\ProgramData'
  return {
    qzInstallDir: options.qzInstallDir ?? detectQzInstallDir(),
    eshopDir: join(programData, 'E-Shop', 'CertificateManager'),
    packageDir: options.packageDir,
    runProcess,
    now: () => new Date(),
  }
}
