/**
 * 从 PE 可执行文件里扫出内嵌 manifest 声明的 requestedExecutionLevel。
 *
 * 存在的理由：portable 目标产出的是一个 NSIS 自解压外壳，它有**自己的** manifest。
 * 只检查 win-unpacked 里的内层 exe 会漏掉这个外壳；外壳是 asInvoker 时
 * 双击不弹 UAC，内层 requireAdministrator 的程序根本起不来，
 * 现场表现为"点了没反应"。这里必须直接检查最终交付的那个 exe。
 *
 * manifest 以 UTF-8 XML 明文存放在资源节里，直接扫字节即可；
 * 内层 exe 被 LZMA 压缩，不会产生误报。
 */

const LEVEL_PATTERN = /requestedExecutionLevel[^>]*?level\s*=\s*["']([^"']+)["']/g

/** @param {Buffer|Uint8Array} buffer */
export function findRequestedExecutionLevels(buffer) {
  const text = Buffer.from(buffer).toString('latin1')
  const levels = []
  for (const match of text.matchAll(LEVEL_PATTERN)) levels.push(match[1])
  return levels
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @returns {{ ok: boolean, levels: string[], reason: string }}
 */
export function checkRequiresAdministrator(buffer) {
  const levels = findRequestedExecutionLevels(buffer)
  if (levels.length === 0) {
    return { ok: false, levels, reason: '未在文件中找到任何 requestedExecutionLevel 声明' }
  }
  const bad = levels.filter((l) => l !== 'requireAdministrator')
  if (bad.length > 0) {
    return {
      ok: false,
      levels,
      reason: `存在非 requireAdministrator 的声明：${[...new Set(bad)].join(', ')}`,
    }
  }
  return { ok: true, levels, reason: '' }
}
