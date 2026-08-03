import { QZ_PATH_DELIMITER } from './env'

/**
 * authcert.override 的值是 ';' 分隔的绝对路径列表
 * （qzind/tray FileUtilities.parseDelimitedPaths，FILE_SEPARATOR=';'）。
 * 这里只负责"往列表里加一条 / 从列表里摘一条"，不重写别人的条目。
 */

export function splitOverride(value: string | null): string[] {
  if (!value) return []
  return value.split(QZ_PATH_DELIMITER).map((s) => s.trim()).filter(Boolean)
}

export function joinOverride(paths: string[]): string {
  return paths.join(QZ_PATH_DELIMITER)
}

function samePath(a: string, b: string): boolean {
  // Windows 路径大小写不敏感，且 / 与 \ 等价
  const norm = (s: string) => s.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

export function overrideContains(value: string | null, path: string): boolean {
  return splitOverride(value).some((p) => samePath(p, path))
}

/** 加入自己的路径，保留其它条目与顺序；已存在则原样返回。 */
export function addToOverride(value: string | null, path: string): string {
  const paths = splitOverride(value)
  if (paths.some((p) => samePath(p, path))) return joinOverride(paths)
  paths.push(path)
  return joinOverride(paths)
}

/** 只摘掉自己的路径，其它条目一律保留。 */
export function removeFromOverride(value: string | null, path: string): string {
  return joinOverride(splitOverride(value).filter((p) => !samePath(p, path)))
}
