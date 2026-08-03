import {
  appendFileSync, copyFileSync, existsSync, mkdirSync,
  readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * 写临时文件 → 校验 → 原子替换。
 * 中途失败时目标文件保持原样，绝不出现"写了一半"的 qz-tray.properties。
 */
export function atomicWrite(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true })
  const tmp = `${target}.eshop-tmp`
  try {
    writeFileSync(tmp, content, 'utf8')
    if (readFileSync(tmp, 'utf8') !== content) throw new Error('ATOMIC_WRITE_VERIFY_FAILED')
    renameSync(tmp, target)
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true })
  }
}

/** 备份一个文件；源不存在返回 null（调用方据此知道"原本就没有这个文件"）。 */
export function backupFile(source: string, backupRoot: string, stamp: string): string | null {
  if (!existsSync(source)) return null
  const dir = join(backupRoot, stamp)
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, source.split(/[\\/]/).pop() as string)
  copyFileSync(source, dest)
  return dest
}

export function restoreFile(backupPath: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(backupPath, target)
}

export function timestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-')
}

export function appendLog(logPath: string, line: string, now: Date): void {
  try {
    mkdirSync(dirname(logPath), { recursive: true })
    appendFileSync(logPath, `${now.toISOString()} ${line}\n`, 'utf8')
  } catch {
    // 日志失败不能让主流程失败
  }
}

export function readLogTail(logPath: string, maxLines: number): string[] {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(-maxLines)
}
