/**
 * E-Shop Desktop — 本地滚动日志（无第三方依赖）
 *
 * - JSON Lines 格式，每行一条
 * - 超过 MAX_BYTES 轮转，保留 KEEP 份历史
 * - 敏感字段（token/secret/password/authorization/phone/telegram）自动脱敏
 * - Windows 路径：%APPDATA%/eshop-desktop/logs/eshop-desktop.log
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 5 * 1024 * 1024
const KEEP = 3
const SENSITIVE_KEY = /token|secret|password|authorization|cookie|phone|telegram|khqr|payment/i

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

let logDir: string | null = null
let logFile: string | null = null

export function initLogger(baseDir: string) {
  logDir = join(baseDir, 'logs')
  logFile = join(logDir, 'eshop-desktop.log')
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
}

export function getLogPaths() {
  return { logDir, logFile }
}

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]'
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…[truncated]` : value
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : sanitize(v, depth + 1)
  }
  return out
}

function rotateIfNeeded() {
  if (!logFile) return
  try {
    if (!existsSync(logFile) || statSync(logFile).size < MAX_BYTES) return
    const oldest = `${logFile}.${KEEP}`
    if (existsSync(oldest)) rmSync(oldest)
    for (let i = KEEP - 1; i >= 1; i--) {
      const from = `${logFile}.${i}`
      if (existsSync(from)) renameSync(from, `${logFile}.${i + 1}`)
    }
    renameSync(logFile, `${logFile}.1`)
  } catch {
    // 轮转失败不应影响主流程
  }
}

export function log(level: LogLevel, event: string, data?: unknown) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(data === undefined ? {} : { data: sanitize(data) }),
  })
  // 控制台始终输出，便于开发调试
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
  if (!logFile) return
  try {
    rotateIfNeeded()
    appendFileSync(logFile, line + '\n', 'utf8')
  } catch {
    // 磁盘写入失败时静默降级为仅控制台
  }
}

export const logger = {
  debug: (event: string, data?: unknown) => log('debug', event, data),
  info: (event: string, data?: unknown) => log('info', event, data),
  warn: (event: string, data?: unknown) => log('warn', event, data),
  error: (event: string, data?: unknown) => log('error', event, data),
}
