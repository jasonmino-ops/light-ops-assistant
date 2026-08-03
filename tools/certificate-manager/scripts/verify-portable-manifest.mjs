/**
 * 构建后闸门：直接核验最终交付的 portable exe 的 manifest。
 *
 * 失败即 exit 1，不允许把一个双击不弹 UAC 的产物发出去。
 * 由 npm run pack:win 在 electron-builder 之后自动执行。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkRequiresAdministrator } from './lib/pe-manifest.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = join(root, 'release')

if (!existsSync(releaseDir)) {
  console.error(`[verify-portable-manifest] 找不到 ${releaseDir}，请先执行 npm run pack:win`)
  process.exit(1)
}

// portable 产物是 release/ 根目录下的 .exe（win-unpacked 里的是内层 exe，不算）
const candidates = readdirSync(releaseDir).filter((f) => f.toLowerCase().endsWith('.exe'))
if (candidates.length === 0) {
  console.error('[verify-portable-manifest] release/ 下没有 portable exe')
  process.exit(1)
}

let failed = false
for (const name of candidates) {
  const path = join(releaseDir, name)
  const result = checkRequiresAdministrator(readFileSync(path))
  const levels = [...new Set(result.levels)].join(', ') || '(无)'
  if (result.ok) {
    console.log(`[verify-portable-manifest] OK  ${name} → requestedExecutionLevel = ${levels}`)
  } else {
    failed = true
    console.error(`[verify-portable-manifest] 失败  ${name} → ${result.reason}（实测：${levels}）`)
    console.error('  修复：electron-builder.yml 中 portable.requestExecutionLevel 必须为 admin')
  }
}

process.exit(failed ? 1 : 0)
