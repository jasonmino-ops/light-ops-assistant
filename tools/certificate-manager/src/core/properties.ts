/**
 * 最小可用的 Java .properties 读写。
 *
 * 只做一件事：读某个 key、改某个 key、删某个 key，
 * 其余每一行（注释、空行、顺序、其它 key）原样保留。
 * 绝不整体重写 qz-tray.properties —— QZ 自己也往里写 SSL 相关配置。
 *
 * Java Properties 的转义规则里 '\' 是转义符，Windows 路径必须写成 'C:\\Program Files\\...'，
 * 否则 Properties.load() 会把 '\P' 吃掉。读写两侧都必须处理。
 */

const COMMENT_CHARS = new Set(['#', '!'])
const SEPARATORS = new Set(['=', ':'])

export type PropertyLine = {
  index: number
  key: string
  rawValue: string
}

/** 值侧反转义：\\ \n \r \t \f \uXXXX \<其它> */
export function unescapeValue(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = raw[++i]
    if (next === undefined) break
    switch (next) {
      case 'n': out += '\n'; break
      case 'r': out += '\r'; break
      case 't': out += '\t'; break
      case 'f': out += '\f'; break
      case 'u': {
        const hex = raw.slice(i + 1, i + 5)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16))
          i += 4
        } else {
          out += 'u'
        }
        break
      }
      default: out += next
    }
  }
  return out
}

/** 值侧转义。反斜杠必须写成双反斜杠，否则 Java 侧读到的路径是错的。 */
export function escapeValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\f/g, '\\f')
}

function escapeKey(key: string): string {
  return escapeValue(key).replace(/([=: ])/g, '\\$1')
}

/** 行尾是否以奇数个反斜杠结尾（Java 的续行标记）。 */
function hasContinuation(line: string): boolean {
  let n = 0
  for (let i = line.length - 1; i >= 0 && line[i] === '\\'; i--) n++
  return n % 2 === 1
}

/**
 * 扫描出所有生效的 key 行。续行会被折叠，index 指向逻辑行的第一行，
 * 便于我们只替换/删除该逻辑行覆盖的全部物理行。
 */
export function scanProperties(text: string): Array<PropertyLine & { endIndex: number }> {
  const lines = text.split('\n')
  const found: Array<PropertyLine & { endIndex: number }> = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].replace(/\r$/, '').trimStart()
    if (trimmed === '' || COMMENT_CHARS.has(trimmed[0])) continue

    // 折叠续行
    const startIndex = i
    let logical = lines[i].replace(/\r$/, '')
    while (hasContinuation(logical) && i + 1 < lines.length) {
      logical = logical.slice(0, -1) + lines[++i].replace(/\r$/, '').trimStart()
    }

    // 切出 key：第一个未转义的 = : 或空白
    let key = ''
    let sepAt = -1
    const body = logical.trimStart()
    for (let j = 0; j < body.length; j++) {
      const ch = body[j]
      if (ch === '\\') { key += ch + (body[j + 1] ?? ''); j++; continue }
      if (SEPARATORS.has(ch) || ch === ' ' || ch === '\t') { sepAt = j; break }
      key += ch
    }
    let rawValue = ''
    if (sepAt >= 0) {
      let rest = body.slice(sepAt)
      rest = rest.replace(/^[ \t]*/, '')
      if (SEPARATORS.has(rest[0])) rest = rest.slice(1).replace(/^[ \t]*/, '')
      rawValue = rest
    }
    found.push({ index: startIndex, endIndex: i, key: unescapeValue(key), rawValue })
  }
  return found
}

export function getProperty(text: string, key: string): string | null {
  const hits = scanProperties(text).filter((p) => p.key === key)
  if (hits.length === 0) return null
  // Java Properties.load() 后写的覆盖先写的
  return unescapeValue(hits[hits.length - 1].rawValue)
}

/**
 * 写入/更新一个 key。
 * 已存在 → 就地替换该逻辑行；不存在 → 追加到文件末尾。其余行完全不动。
 */
export function setProperty(text: string, key: string, value: string): string {
  const lines = text.split('\n')
  const hits = scanProperties(text).filter((p) => p.key === key)
  const line = `${escapeKey(key)}=${escapeValue(value)}`

  if (hits.length === 0) {
    const out = [...lines]
    // 去掉末尾多余空行后追加，保持文件以单个换行结束
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
    out.push(line, '')
    return out.join('\n')
  }

  const target = hits[hits.length - 1]
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (i === target.index) {
      out.push(line)
      i = target.endIndex
      continue
    }
    // 同名 key 的更早出现也一并删掉，避免留下歧义
    const dup = hits.find((h) => h.index === i)
    if (dup) { i = dup.endIndex; continue }
    out.push(lines[i])
  }
  return out.join('\n')
}

/** 删除一个 key 的全部出现，其余行不动。 */
export function removeProperty(text: string, key: string): string {
  const lines = text.split('\n')
  const hits = scanProperties(text).filter((p) => p.key === key)
  if (hits.length === 0) return text

  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const hit = hits.find((h) => h.index === i)
    if (hit) { i = hit.endIndex; continue }
    out.push(lines[i])
  }
  return out.join('\n')
}
