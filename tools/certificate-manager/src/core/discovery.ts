import { existsSync } from 'node:fs'
import { join, win32 } from 'node:path'
import type { ProcessRunner } from './env'

/**
 * QZ Tray 安装目录发现。
 *
 * 现场事实（CarGarden，Windows 10 Pro 19045）：
 * - QZ 装在 D:\qz tray，不是 Program Files —— QZ 的 NSIS 安装器带
 *   MUI_PAGE_DIRECTORY，用户可以随便选目录；
 * - QZ 实际以 bundled runtime 启动：
 *   "D:\qz tray\runtime\bin\javaw.exe" ... -jar "D:\qz tray/qz-tray.jar"
 *   进程名是 javaw.exe，不是 qz-tray.exe；
 * - 因此 qz-tray.exe 不能作为"QZ 已安装"的判断依据。
 *
 * 发现顺序（都不做全盘扫描、不联网）：
 *   1. 正在运行的 QZ 进程命令行里的 -jar 路径
 *   2. HKLM\SOFTWARE\QZ Tray 的默认值（qz.installer.WindowsInstaller 写入的安装目录）
 *   3. 卸载项的 DisplayIcon（指向 <安装目录>\qz-tray.exe）
 *   4. 默认候选目录
 */

export const QZ_JAR_NAME = 'qz-tray.jar'
export const QZ_PROPERTIES_NAME = 'qz-tray.properties'
export const QZ_EXE_NAME = 'qz-tray.exe'

export const QZ_REG_INSTALL_KEY = 'HKLM\\SOFTWARE\\QZ Tray'
export const QZ_REG_UNINSTALL_KEY =
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QZ Tray'

export const DEFAULT_QZ_CANDIDATES = [
  'C:\\Program Files\\QZ Tray',
  'C:\\Program Files (x86)\\QZ Tray',
]

export type DiscoverySource = 'running-process' | 'registry-install' | 'registry-uninstall' | 'default-path'

export type QzDiscovery = {
  dir: string | null
  source: DiscoverySource | null
  detail: string
}

export type QzProcess = { pid: number; commandLine: string }

/**
 * 从进程命令行里取出 -jar 的路径。纯函数，是这次现场问题的核心。
 *
 * 只接受：绝对路径、文件名恰好是 qz-tray.jar。
 * 其余一律返回 null —— 畸形或伪造的命令行不能让我们去改任意目录的配置。
 */
export function parseJarPathFromCommandLine(commandLine: string): string | null {
  if (!commandLine || /[\r\n\0]/.test(commandLine)) return null

  // -jar "带空格的路径\qz-tray.jar"  或  -jar 无空格路径
  const match = commandLine.match(/(?:^|\s)-jar\s+(?:"([^"]+)"|(\S+))/)
  if (!match) return null

  const raw = (match[1] ?? match[2] ?? '').trim()
  if (!raw) return null
  // 现场命令行里 \ 和 / 混用，win32 的解析两种都认
  if (win32.basename(raw).toLowerCase() !== QZ_JAR_NAME) return null
  if (!win32.isAbsolute(raw)) return null

  const dir = win32.dirname(raw)
  return dir && dir !== '.' ? dir : null
}

/**
 * 目录里必须同时有 qz-tray.jar 和 qz-tray.properties 才算真的 QZ 安装目录。
 * 刻意不要求 qz-tray.exe —— 现场 QZ 由 runtime\bin\javaw.exe 启动。
 *
 * 注意：解析命令行用 win32（命令行永远是 Windows 格式），
 * 但访问文件系统必须用平台原生 join，否则在非 Windows 上跑测试会拼出反斜杠路径。
 */
export function looksLikeQzInstallDir(dir: string): boolean {
  return existsSync(join(dir, QZ_JAR_NAME)) && existsSync(join(dir, QZ_PROPERTIES_NAME))
}

/**
 * 找出所有跑着 qz-tray.jar 的进程。
 * 不按镜像名匹配 —— 现场进程名是 javaw.exe，按 /IM javaw.exe 结束会误杀门店里
 * 其它 Java 程序，所以后续起停一律按 PID。
 */
export function findQzProcesses(run: ProcessRunner): QzProcess[] {
  const res = run('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*qz-tray.jar*' } " +
    "| ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }",
  ])
  if (!res.ok) return []

  const found: QzProcess[] = []
  for (const line of res.output.split(/\r?\n/)) {
    const at = line.indexOf('|')
    if (at <= 0) continue
    const pid = Number(line.slice(0, at).trim())
    const commandLine = line.slice(at + 1).trim()
    if (Number.isInteger(pid) && pid > 0 && commandLine) found.push({ pid, commandLine })
  }
  return found
}

/** 读一个注册表值；读不到返回 null。用 reg query，输出格式稳定且不依赖 PowerShell 策略。 */
export function readRegistryValue(run: ProcessRunner, key: string, valueName: string | null): string | null {
  const args = ['query', key, ...(valueName === null ? ['/ve'] : ['/v', valueName])]
  const res = run('reg', args)
  if (!res.ok) return null

  for (const line of res.output.split(/\r?\n/)) {
    const match = line.match(/^\s+(?:\(Default\)|\S+)\s+REG_[A-Z_]+\s+(.*)$/)
    if (match) {
      const value = match[1].trim()
      if (value) return value
    }
  }
  return null
}

export function discoverQzInstallDir(
  run: ProcessRunner,
  candidates: string[] = DEFAULT_QZ_CANDIDATES,
): QzDiscovery {
  // 1) 正在运行的 QZ 进程
  for (const proc of findQzProcesses(run)) {
    const dir = parseJarPathFromCommandLine(proc.commandLine)
    if (dir && looksLikeQzInstallDir(dir)) {
      return { dir, source: 'running-process', detail: `由正在运行的 QZ 进程（PID ${proc.pid}）确定` }
    }
  }

  // 2) HKLM\SOFTWARE\QZ Tray 默认值 = 安装目录
  const fromInstallKey = readRegistryValue(run, QZ_REG_INSTALL_KEY, null)
  if (fromInstallKey && looksLikeQzInstallDir(fromInstallKey)) {
    return { dir: fromInstallKey, source: 'registry-install', detail: `由注册表 ${QZ_REG_INSTALL_KEY} 确定` }
  }

  // 3) 卸载项 DisplayIcon = <安装目录>\qz-tray.exe
  const displayIcon = readRegistryValue(run, QZ_REG_UNINSTALL_KEY, 'DisplayIcon')
  if (displayIcon) {
    const dir = win32.dirname(displayIcon.replace(/,\d+$/, '').replace(/^"|"$/g, ''))
    if (dir && looksLikeQzInstallDir(dir)) {
      return { dir, source: 'registry-uninstall', detail: '由注册表卸载项 DisplayIcon 确定' }
    }
  }

  // 4) 默认候选目录
  for (const dir of candidates) {
    if (looksLikeQzInstallDir(dir)) {
      return { dir, source: 'default-path', detail: '由默认安装路径确定' }
    }
  }

  return {
    dir: null,
    source: null,
    detail: '进程、注册表、默认路径均未找到含 qz-tray.jar 与 qz-tray.properties 的目录',
  }
}

/** 从注册表卸载项读 QZ 版本（WindowsInstaller 写入的 DisplayVersion）。 */
export function readQzVersionFromRegistry(run: ProcessRunner): string | null {
  const raw = readRegistryValue(run, QZ_REG_UNINSTALL_KEY, 'DisplayVersion')
  const parsed = raw?.match(/\d+\.\d+(\.\d+)?/)
  return parsed ? parsed[0] : null
}
