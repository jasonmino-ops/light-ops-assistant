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

/**
 * 从进程命令行里取出 -jar 的路径所在目录。纯函数，是进程身份判定的核心。
 *
 * 只接受：独立的 -jar 参数、绝对路径、文件名恰好是 qz-tray.jar。
 * 其余一律返回 null —— 畸形或伪造的命令行不能让我们去改任意目录的配置，
 * 命令行里只是"提到"过 qz-tray.jar 也不算。
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

/** 只有这三个镜像名可能是 QZ：exe 启动器，或 bundled runtime 的 java/javaw。 */
export const QZ_PROCESS_IMAGE_NAMES = ['java.exe', 'javaw.exe', 'qz-tray.exe'] as const

/**
 * 即使镜像名过滤失效也要挡住的进程。
 * powershell.exe 是这次现场故障的元凶：旧查询语句里含有字符串 "qz-tray.jar"，
 * 而查询范围又是全部进程，于是执行查询的 powershell 每次都把自己算成 QZ，
 * isQzRunning() 恒为 true，QZ 明明已经退出也确认不了。
 */
export const EXCLUDED_IMAGE_NAMES = ['powershell.exe', 'pwsh.exe', 'cmd.exe', 'conhost.exe', 'wmic.exe']

export type CandidateProcess = {
  pid: number
  name: string
  sessionId: number | null
  commandLine: string
}

/** 通过严格身份校验的 QZ 进程。 */
export type QzProcess = CandidateProcess & { installDir: string }

export type RejectedProcess = { pid: number; name: string; reason: string }

export type QzIdentifyResult = {
  accepted: QzProcess[]
  rejected: RejectedProcess[]
  /** 查询本身是否成功；失败时 accepted 为空但不代表 QZ 真的没在跑。 */
  queried: boolean
}

/**
 * 枚举候选进程。
 *
 * 两条关键约束：
 * 1) 在 CIM 查询里就按镜像名过滤，powershell.exe 根本不会出现在结果里；
 * 2) 查询语句本身**不含** "qz-tray.jar" 字面量，从结构上杜绝自匹配。
 *    匹配逻辑全部放到 TypeScript 里做。
 */
export function listCandidateProcesses(run: ProcessRunner): { list: CandidateProcess[]; ok: boolean } {
  const filter = QZ_PROCESS_IMAGE_NAMES.map((n) => `Name='${n}'`).join(' or ')
  const res = run('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process -Filter "${filter}" ` +
    '| ForEach-Object { "$($_.ProcessId)|$($_.Name)|$($_.SessionId)|$($_.CommandLine)" }',
  ])
  if (!res.ok) return { list: [], ok: false }

  const list: CandidateProcess[] = []
  for (const line of res.output.split(/\r?\n/)) {
    const parts = line.split('|')
    if (parts.length < 4) continue
    const pid = Number(parts[0].trim())
    const name = parts[1].trim()
    const sessionId = Number(parts[2].trim())
    const commandLine = parts.slice(3).join('|').trim()
    if (!Number.isInteger(pid) || pid <= 0 || !name) continue
    list.push({
      pid,
      name,
      sessionId: Number.isInteger(sessionId) ? sessionId : null,
      commandLine,
    })
  }
  return { list, ok: true }
}

/** Windows 路径比较：忽略大小写与斜杠方向。 */
export function samePath(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return norm(a) === norm(b) && norm(a).length > 0
}

/** 取命令行里的可执行文件路径（第一个 token，带引号则取引号内）。 */
export function parseExecutablePathFromCommandLine(commandLine: string): string | null {
  const trimmed = commandLine.trim()
  if (!trimmed) return null
  const quoted = trimmed.match(/^"([^"]+)"/)
  if (quoted) return quoted[1]
  const bare = trimmed.match(/^(\S+)/)
  return bare ? bare[1] : null
}

/**
 * 严格 QZ 身份判定。停止确认与启动确认共用这一个解析器，不允许各写一套。
 *
 * java.exe / javaw.exe：
 *   - 命令行里有独立的 -jar 参数；
 *   - -jar 后的路径 basename 精确等于 qz-tray.jar；
 *   - 该路径是绝对路径；
 *   - 该 jar 文件真实存在；
 *   - jar 所在目录 == 已发现的 QZ 安装目录。
 * qz-tray.exe：
 *   - 可执行文件路径 == <QZ 安装目录>\qz-tray.exe。
 *
 * "命令行里出现过 qz-tray.jar" 本身**不是**判据。
 */
export function identifyQzProcesses(
  run: ProcessRunner,
  qzInstallDir: string | null,
  selfPid: number,
): QzIdentifyResult {
  const { list, ok } = listCandidateProcesses(run)
  const accepted: QzProcess[] = []
  const rejected: RejectedProcess[] = []

  for (const proc of list) {
    const name = proc.name.toLowerCase()
    if (proc.pid === selfPid) {
      rejected.push({ pid: proc.pid, name: proc.name, reason: 'self' })
      continue
    }
    if (EXCLUDED_IMAGE_NAMES.includes(name)) {
      rejected.push({ pid: proc.pid, name: proc.name, reason: 'excluded-image' })
      continue
    }
    if (!(QZ_PROCESS_IMAGE_NAMES as readonly string[]).includes(name)) {
      rejected.push({ pid: proc.pid, name: proc.name, reason: 'image-not-qz' })
      continue
    }
    if (!qzInstallDir) {
      rejected.push({ pid: proc.pid, name: proc.name, reason: 'no-install-dir' })
      continue
    }

    if (name === 'qz-tray.exe') {
      const exePath = parseExecutablePathFromCommandLine(proc.commandLine)
      if (exePath && samePath(exePath, join(qzInstallDir, QZ_EXE_NAME))) {
        accepted.push({ ...proc, installDir: qzInstallDir })
      } else {
        rejected.push({ pid: proc.pid, name: proc.name, reason: 'exe-outside-install-dir' })
      }
      continue
    }

    const jarDir = parseJarPathFromCommandLine(proc.commandLine)
    if (!jarDir) {
      rejected.push({ pid: proc.pid, name: proc.name, reason: 'no-qz-tray-jar-arg' })
      continue
    }
    if (!samePath(jarDir, qzInstallDir)) {
      rejected.push({ pid: proc.pid, name: proc.name, reason: 'jar-outside-install-dir' })
      continue
    }
    if (!existsSync(join(jarDir, QZ_JAR_NAME))) {
      rejected.push({ pid: proc.pid, name: proc.name, reason: 'jar-file-missing' })
      continue
    }
    accepted.push({ ...proc, installDir: jarDir })
  }

  return { accepted, rejected, queried: ok }
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
  // 1) 正在运行的 QZ 进程。此时安装目录还不知道，无法做"目录一致"这一条，
  //    但镜像名过滤 + -jar 严格解析 + 目录内容校验已经足够，且不会自匹配。
  for (const proc of listCandidateProcesses(run).list) {
    if (EXCLUDED_IMAGE_NAMES.includes(proc.name.toLowerCase())) continue
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
