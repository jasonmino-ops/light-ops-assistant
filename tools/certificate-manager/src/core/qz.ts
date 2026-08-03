import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Env } from './env'

export const QZ_PROCESS_NAME = 'qz-tray.exe'
export const QZ_JAR_NAME = 'qz-tray.jar'

/** 进程状态确认的轮询参数：最多等 ~6s，足够 QZ Tray 起停，又不会把界面卡死。 */
const CONFIRM_ATTEMPTS = 12
const CONFIRM_INTERVAL_MS = 500

export type QzVersionResult =
  | { status: 'OK'; version: string }
  | { status: 'UNCONFIRMED'; version: null; reason: string }

/**
 * QZ Tray 2.2.6 的 Windows 安装目录是这样的：
 *
 *   qz-tray.exe
 *   qz-tray.jar
 *   libs\
 *   qz-tray.properties
 *
 * 没有 jpackage 的 app\*.cfg，也没有 version.txt。
 * 唯一可靠的本机版本来源是 qz-tray.exe 的 ProductVersion。
 *
 * 取不到时一律返回 UNCONFIRMED —— 绝不猜测、绝不回退到不存在的路径，
 * 上层据此拒绝写入并说明原因。
 */
export function detectQzVersion(env: Env): QzVersionResult {
  const dir = env.qzInstallDir
  if (!dir) return unconfirmed('未检测到 QZ Tray 安装目录')

  const exe = join(dir, QZ_PROCESS_NAME)
  if (!existsSync(exe)) {
    return unconfirmed(`安装目录下找不到 ${QZ_PROCESS_NAME}，无法读取版本`)
  }

  const res = env.runProcess('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`,
  ])
  if (!res.ok) {
    return unconfirmed(
      `读取 ${QZ_PROCESS_NAME} 的 ProductVersion 失败（PowerShell 未返回成功）：${firstLine(res.output)}`,
    )
  }
  const parsed = res.output.trim().match(/\d+\.\d+(\.\d+)?/)
  if (!parsed) {
    return unconfirmed(`${QZ_PROCESS_NAME} 的 ProductVersion 无法解析：${firstLine(res.output)}`)
  }
  return { status: 'OK', version: parsed[0] }
}

function unconfirmed(reason: string): QzVersionResult {
  return { status: 'UNCONFIRMED', version: null, reason }
}

function firstLine(text: string): string {
  const line = text.split('\n').map((s) => s.trim()).find(Boolean)
  return line ? line.slice(0, 120) : '（无输出）'
}

/** 安装目录里是否具备真实的 QZ Tray 资产（exe + jar），用于区分"没装"和"装了但读不到版本"。 */
export function hasQzInstallAssets(env: Env): boolean {
  const dir = env.qzInstallDir
  if (!dir) return false
  return existsSync(join(dir, QZ_PROCESS_NAME)) && existsSync(join(dir, QZ_JAR_NAME))
}

export function isQzRunning(env: Env): boolean {
  const res = env.runProcess('tasklist', ['/FI', `IMAGENAME eq ${QZ_PROCESS_NAME}`, '/NH'])
  return res.ok && res.output.toLowerCase().includes(QZ_PROCESS_NAME)
}

/** 轮询直到进程状态达到期望值；超时返回 false。 */
function waitForRunningState(env: Env, expected: boolean): boolean {
  for (let i = 0; i < CONFIRM_ATTEMPTS; i++) {
    if (isQzRunning(env) === expected) return true
    env.sleep(CONFIRM_INTERVAL_MS)
  }
  return isQzRunning(env) === expected
}

/** 结束 QZ 并确认进程真的退出了 —— 只看 taskkill 返回码是不够的。 */
export function stopQzAndConfirm(env: Env): boolean {
  env.runProcess('taskkill', ['/F', '/IM', QZ_PROCESS_NAME])
  return waitForRunningState(env, false)
}

/** 启动 QZ 并确认进程真的出现了 —— `cmd /c start` 几乎总是返回 0。 */
export function startQzAndConfirm(env: Env): boolean {
  if (!env.qzInstallDir) return false
  const exe = join(env.qzInstallDir, QZ_PROCESS_NAME)
  if (!existsSync(exe)) return false
  env.runProcess('cmd', ['/c', 'start', '""', exe])
  return waitForRunningState(env, true)
}

export type RestartOutcome = { attempted: boolean; ok: boolean; detail: string }

/**
 * 只在 QZ 原本就在运行时才重启，避免"本来没开，操作完却被我们拉起来"。
 * 停和起都必须经过进程状态确认，任一步确认不了就返回 ok:false，
 * 由调用方按失败处理（不得报告完全成功）。
 */
export function restartQzIfRunning(env: Env): RestartOutcome {
  if (!isQzRunning(env)) return { attempted: false, ok: true, detail: 'QZ Tray 当前未运行，无需重启' }
  if (!stopQzAndConfirm(env)) {
    return { attempted: true, ok: false, detail: `无法确认 ${QZ_PROCESS_NAME} 已退出` }
  }
  if (!startQzAndConfirm(env)) {
    return { attempted: true, ok: false, detail: `已结束 ${QZ_PROCESS_NAME}，但无法确认它重新启动` }
  }
  return { attempted: true, ok: true, detail: 'QZ Tray 已重启并确认在运行' }
}

/**
 * 失败回滚时把 QZ 恢复成操作前的运行状态：
 * 本来在跑就尽力拉起来，本来没跑就确保它仍然没跑。
 */
export function restoreQzRunState(env: Env, wasRunning: boolean): { ok: boolean; detail: string } {
  if (!env.qzInstallDir) return { ok: true, detail: '无 QZ 安装目录，跳过运行状态恢复' }
  const running = isQzRunning(env)
  if (running === wasRunning) {
    return { ok: true, detail: `QZ Tray 运行状态与操作前一致（${wasRunning ? '运行中' : '未运行'}）` }
  }
  if (wasRunning) {
    return startQzAndConfirm(env)
      ? { ok: true, detail: 'QZ Tray 已恢复运行' }
      : { ok: false, detail: 'QZ Tray 操作前在运行，但未能恢复，请手动启动' }
  }
  return stopQzAndConfirm(env)
    ? { ok: true, detail: 'QZ Tray 操作前未运行，已恢复为未运行' }
    : { ok: false, detail: 'QZ Tray 操作前未运行，但未能将其停止，请手动确认' }
}
