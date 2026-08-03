import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Env } from './env'
import { eshopLogPath } from './env'
import { appendLog } from './fsAtomic'
import {
  QZ_EXE_NAME, QZ_JAR_NAME, QZ_PROPERTIES_NAME,
  identifyQzProcesses, readQzVersionFromRegistry,
  type QzIdentifyResult, type QzProcess,
} from './discovery'

export { QZ_EXE_NAME, QZ_JAR_NAME, QZ_PROPERTIES_NAME }

/** 进程状态确认的轮询参数：最多等 ~6s，足够 QZ Tray 起停，又不会把界面卡死。 */
const CONFIRM_ATTEMPTS = 12
const CONFIRM_INTERVAL_MS = 500

function diag(env: Env, line: string): void {
  appendLog(eshopLogPath(env), `[qz] ${line}`, env.now())
}

/** 排除原因汇总成一行，避免把整套进程列表写进日志。 */
function summarizeRejected(result: QzIdentifyResult): string {
  if (result.rejected.length === 0) return '无'
  return result.rejected.map((r) => `${r.name}#${r.pid}:${r.reason}`).join(', ')
}

/** 停止与启动共用的严格身份判定入口，绝不各写一套。 */
function identify(env: Env): QzIdentifyResult {
  return identifyQzProcesses(env.runProcess, env.qzInstallDir, env.selfPid)
}

export type QzVersionResult =
  | { status: 'OK'; version: string; source: 'exe-product-version' | 'registry-display-version' }
  | { status: 'UNCONFIRMED'; version: null; reason: string }

/**
 * 版本探测。两个来源都是真实存在的，都取不到就明确 UNCONFIRMED，绝不猜测。
 *
 *   1. <安装目录>\qz-tray.exe 的 ProductVersion
 *   2. 注册表卸载项的 DisplayVersion
 *      （qz.installer.WindowsInstaller 写入 HKLM\...\Uninstall\QZ Tray\DisplayVersion）
 *
 * 之所以必须有第 2 条：现场 QZ 由 runtime\bin\javaw.exe 启动，
 * qz-tray.exe 不一定存在，不能把它当成唯一版本来源。
 * qz-tray.jar 的 MANIFEST 里没有版本号（QZ 的 build.xml 只写了
 * Application-Name / Main-Class / Permissions / Multi-Release），所以不走 jar。
 */
export function detectQzVersion(env: Env): QzVersionResult {
  const dir = env.qzInstallDir
  if (!dir) return unconfirmed('未检测到 QZ Tray 安装目录')

  const reasons: string[] = []

  const exe = join(dir, QZ_EXE_NAME)
  if (existsSync(exe)) {
    const res = env.runProcess('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`,
    ])
    const parsed = res.ok ? res.output.trim().match(/\d+\.\d+(\.\d+)?/) : null
    if (parsed) return { status: 'OK', version: parsed[0], source: 'exe-product-version' }
    reasons.push(res.ok
      ? `${QZ_EXE_NAME} 的 ProductVersion 无法解析：${firstLine(res.output)}`
      : `读取 ${QZ_EXE_NAME} 的 ProductVersion 失败：${firstLine(res.output)}`)
  } else {
    reasons.push(`安装目录下没有 ${QZ_EXE_NAME}（QZ 由 runtime\\bin\\javaw.exe 启动时属正常）`)
  }

  const fromRegistry = readQzVersionFromRegistry(env.runProcess)
  if (fromRegistry) return { status: 'OK', version: fromRegistry, source: 'registry-display-version' }
  reasons.push('注册表卸载项里也没有可用的 DisplayVersion')

  return unconfirmed(reasons.join('；'))
}

function unconfirmed(reason: string): QzVersionResult {
  return { status: 'UNCONFIRMED', version: null, reason }
}

function firstLine(text: string): string {
  const line = text.split('\n').map((s) => s.trim()).find(Boolean)
  return line ? line.slice(0, 120) : '（无输出）'
}

/**
 * 是否具备真实的 QZ Tray 安装资产。
 * 判据是 qz-tray.jar + qz-tray.properties，**不包含** qz-tray.exe ——
 * 现场 QZ 以 bundled runtime 启动，exe 不能作为"已安装"的唯一依据。
 */
export function hasQzInstallAssets(env: Env): boolean {
  const dir = env.qzInstallDir
  if (!dir) return false
  return existsSync(join(dir, QZ_JAR_NAME)) && existsSync(join(dir, QZ_PROPERTIES_NAME))
}

/** QZ 是否在运行：以严格身份判定为准。 */
export function isQzRunning(env: Env): boolean {
  return identify(env).accepted.length > 0
}

/**
 * 结束 QZ 并确认真的退出了。
 *
 * 确认条件（两条同时满足）：
 *   1. 每个目标旧 PID 都已不存在；
 *   2. 当前没有任何通过严格身份判定的 QZ 进程。
 * 无关的 java/javaw 进程不参与判定，不会把 QZ 判成没退出。
 */
export function stopQzAndConfirm(env: Env, targets: QzProcess[]): boolean {
  for (const proc of targets) {
    const res = env.runProcess('taskkill', ['/F', '/PID', String(proc.pid)])
    diag(env, `taskkill /PID ${proc.pid} exitOk=${res.ok} output=${firstLine(res.output)}`)
  }

  const targetPids = new Set(targets.map((p) => p.pid))
  for (let attempt = 1; attempt <= CONFIRM_ATTEMPTS; attempt++) {
    const result = identify(env)
    const stillAlive = [...targetPids].filter((pid) => result.accepted.some((p) => p.pid === pid))
    diag(env, `stop-confirm #${attempt} targetsAlive=[${stillAlive.join(',')}] ` +
      `qzPids=[${result.accepted.map((p) => p.pid).join(',')}] rejected=${summarizeRejected(result)}`)

    if (stillAlive.length === 0 && result.accepted.length === 0) {
      diag(env, `stop-confirm ok after #${attempt}`)
      return true
    }
    if (attempt < CONFIRM_ATTEMPTS) env.sleep(CONFIRM_INTERVAL_MS)
  }
  diag(env, 'stop-confirm timeout')
  return false
}

/**
 * 启动 QZ 并确认真的起来了。
 * `cmd /c start` 几乎总是返回 0，所以必须轮询严格身份判定，
 * 并且要求新 PID 不在旧 PID 集合里。
 */
export function startQzAndConfirm(env: Env, previousPids: number[] = []): boolean {
  if (!env.qzInstallDir) return false
  const exe = join(env.qzInstallDir, QZ_EXE_NAME)
  if (!existsSync(exe)) {
    diag(env, `start skipped: ${exe} 不存在`)
    return false
  }

  diag(env, `entering start phase: ${exe}`)
  const res = env.runProcess('cmd', ['/c', 'start', '""', exe])
  diag(env, `start invoke exitOk=${res.ok} output=${firstLine(res.output)}`)

  const old = new Set(previousPids)
  for (let attempt = 1; attempt <= CONFIRM_ATTEMPTS; attempt++) {
    const result = identify(env)
    const fresh = result.accepted.filter((p) => !old.has(p.pid))
    diag(env, `start-confirm #${attempt} newPids=[${fresh.map((p) => `${p.pid}/session${p.sessionId ?? '?'}`).join(',')}] ` +
      `rejected=${summarizeRejected(result)}`)

    if (fresh.length > 0) {
      diag(env, `start-confirm ok after #${attempt}`)
      return true
    }
    if (attempt < CONFIRM_ATTEMPTS) env.sleep(CONFIRM_INTERVAL_MS)
  }
  diag(env, 'start-confirm timeout')
  return false
}

export type RestartOutcome = { attempted: boolean; ok: boolean; detail: string }

/**
 * 只在 QZ 原本就在运行时才重启，避免"本来没开，操作完却被我们拉起来"。
 * 停和起都必须经过严格身份确认，任一步确认不了就返回 ok:false，
 * 由调用方按失败处理（不得报告完全成功）。
 */
export function restartQzIfRunning(env: Env): RestartOutcome {
  const before = identify(env)
  if (before.accepted.length === 0) {
    diag(env, `restart skipped: 无运行中的 QZ（rejected=${summarizeRejected(before)}）`)
    return { attempted: false, ok: true, detail: 'QZ Tray 当前未运行，无需重启' }
  }

  diag(env, `restart begin installDir=${env.qzInstallDir}`)
  for (const proc of before.accepted) {
    diag(env, `target pid=${proc.pid} name=${proc.name} session=${proc.sessionId ?? '?'} cmd=${proc.commandLine}`)
  }

  if (!stopQzAndConfirm(env, before.accepted)) {
    return { attempted: true, ok: false, detail: '无法确认 QZ Tray 进程已退出' }
  }

  if (!startQzAndConfirm(env, before.accepted.map((p) => p.pid))) {
    const exeMissing = env.qzInstallDir && !existsSync(join(env.qzInstallDir, QZ_EXE_NAME))
    return {
      attempted: true,
      ok: false,
      detail: exeMissing
        ? `已结束 QZ Tray，但安装目录下没有 ${QZ_EXE_NAME}，无法自动启动，请手动启动 QZ Tray`
        : '已结束 QZ Tray，但无法确认它重新启动',
    }
  }
  return { attempted: true, ok: true, detail: 'QZ Tray 已重启并确认在运行' }
}

/**
 * 失败回滚时把 QZ 恢复成操作前的运行状态：
 * 本来在跑就尽力拉起来，本来没跑就确保它仍然没跑。
 */
export function restoreQzRunState(env: Env, wasRunning: boolean): { ok: boolean; detail: string } {
  if (!env.qzInstallDir) return { ok: true, detail: '无 QZ 安装目录，跳过运行状态恢复' }
  const current = identify(env)
  const running = current.accepted.length > 0
  diag(env, `restore-run-state wasRunning=${wasRunning} nowRunning=${running}`)

  if (running === wasRunning) {
    return { ok: true, detail: `QZ Tray 运行状态与操作前一致（${wasRunning ? '运行中' : '未运行'}）` }
  }
  if (wasRunning) {
    return startQzAndConfirm(env)
      ? { ok: true, detail: 'QZ Tray 已恢复运行' }
      : { ok: false, detail: 'QZ Tray 操作前在运行，但未能恢复，请手动启动' }
  }
  return stopQzAndConfirm(env, current.accepted)
    ? { ok: true, detail: 'QZ Tray 操作前未运行，已恢复为未运行' }
    : { ok: false, detail: 'QZ Tray 操作前未运行，但未能将其停止，请手动确认' }
}
