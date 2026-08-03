import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import type { Env, ProcessRunner } from '../core/env'
import { discoverQzInstallDir } from '../core/discovery'

/** 同步睡眠。主进程在执行安装/卸载时本来就是阻塞的，这里不引入异步复杂度。 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

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
 * - QZ 目录：由 discoverQzInstallDir() 动态发现（运行进程 → 注册表 → 默认路径），
 *   不写死任何路径。现场 CarGarden 装在 D:\qz tray。
 * - E-Shop 自有目录：%PROGRAMDATA%\E-Shop\CertificateManager
 * - 证书包：打包后位于 resources/certificate-package，开发时位于仓库目录。
 */
export function resolveWindowsEnv(options: {
  packageDir: string
  qzInstallDir?: string | null
  programData?: string
}): Env {
  const programData = options.programData ?? process.env.PROGRAMDATA ?? 'C:\\ProgramData'
  const discovery = options.qzInstallDir === undefined
    ? discoverQzInstallDir(runProcess)
    : { dir: options.qzInstallDir, source: null, detail: '由调用方指定' }

  return {
    qzInstallDir: discovery.dir,
    qzInstallSource: discovery.detail,
    eshopDir: join(programData, 'E-Shop', 'CertificateManager'),
    packageDir: options.packageDir,
    runProcess,
    sleep: sleepSync,
    selfPid: process.pid,
    now: () => new Date(),
  }
}
