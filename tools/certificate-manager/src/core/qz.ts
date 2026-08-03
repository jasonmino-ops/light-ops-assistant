import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Env } from './env'

export const QZ_PROCESS_NAME = 'qz-tray.exe'

/**
 * QZ Tray 2.2.x 是 jpackage 打包的，安装目录下有 app\<name>.cfg，
 * 里面带 app.version=2.2.6。优先读文件（无需起进程、可测），
 * 读不到再退回 PowerShell 取 exe 的产品版本。
 */
export function detectQzVersion(env: Env): string | null {
  const dir = env.qzInstallDir
  if (!dir) return null

  const fromCfg = readVersionFromAppCfg(dir)
  if (fromCfg) return fromCfg

  const marker = join(dir, 'version.txt')
  if (existsSync(marker)) {
    const text = readFileSync(marker, 'utf8').trim()
    if (/^\d+\.\d+/.test(text)) return text
  }

  const exe = join(dir, QZ_PROCESS_NAME)
  if (existsSync(exe)) {
    const res = env.runProcess('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`,
    ])
    const parsed = res.output.trim().match(/\d+\.\d+(\.\d+)?/)
    if (res.ok && parsed) return parsed[0]
  }
  return null
}

function readVersionFromAppCfg(dir: string): string | null {
  const appDir = join(dir, 'app')
  if (!existsSync(appDir)) return null
  let entries: string[]
  try {
    entries = readdirSync(appDir)
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.cfg')) continue
    try {
      const text = readFileSync(join(appDir, entry), 'utf8')
      const match = text.match(/^\s*app\.version\s*=\s*(.+)$/m)
      if (match) return match[1].trim()
    } catch {
      // 忽略单个文件读取失败，继续尝试下一个
    }
  }
  return null
}

export function isQzRunning(env: Env): boolean {
  const res = env.runProcess('tasklist', ['/FI', `IMAGENAME eq ${QZ_PROCESS_NAME}`, '/NH'])
  return res.ok && res.output.toLowerCase().includes(QZ_PROCESS_NAME)
}

export function stopQz(env: Env): boolean {
  return env.runProcess('taskkill', ['/F', '/IM', QZ_PROCESS_NAME]).ok
}

export function startQz(env: Env): boolean {
  if (!env.qzInstallDir) return false
  const exe = join(env.qzInstallDir, QZ_PROCESS_NAME)
  if (!existsSync(exe)) return false
  return env.runProcess('cmd', ['/c', 'start', '""', exe]).ok
}

/**
 * 只在 QZ 原本就在运行时才重启，避免"本来没开，操作完却被我们拉起来"。
 * 重启失败不视为操作失败，只上报，让工程师手动启动。
 */
export function restartQzIfRunning(env: Env): { attempted: boolean; ok: boolean } {
  if (!isQzRunning(env)) return { attempted: false, ok: true }
  stopQz(env)
  return { attempted: true, ok: startQz(env) }
}
