import { X509Certificate } from 'node:crypto'
import type { CertificateInfo } from './types'

/** PEM 里出现任何私钥标记都视为致命错误 —— 证书包内永远只能有公开证书。 */
const PRIVATE_KEY_MARKERS = [
  'PRIVATE KEY',
  'BEGIN RSA PRIVATE',
  'BEGIN EC PRIVATE',
  'BEGIN OPENSSH PRIVATE',
  'ENCRYPTED PRIVATE KEY',
]

export function containsPrivateKeyMaterial(text: string): boolean {
  const upper = text.toUpperCase()
  return PRIVATE_KEY_MARKERS.some((marker) => upper.includes(marker))
}

export function parseCertificate(pem: string): CertificateInfo {
  if (containsPrivateKeyMaterial(pem)) {
    throw new Error('CERT_CONTAINS_PRIVATE_KEY')
  }
  if (!/-----BEGIN CERTIFICATE-----/.test(pem)) {
    throw new Error('CERT_NOT_PEM')
  }
  let x509: X509Certificate
  try {
    x509 = new X509Certificate(pem)
  } catch {
    throw new Error('CERT_PARSE_FAILED')
  }
  return {
    subject: normalizeName(x509.subject),
    issuer: normalizeName(x509.issuer),
    fingerprint: x509.fingerprint256.toUpperCase(),
    validFrom: new Date(x509.validFrom).toISOString(),
    validTo: new Date(x509.validTo).toISOString(),
    isCa: x509.ca,
  }
}

function normalizeName(name: string): string {
  return name.split('\n').map((s) => s.trim()).filter(Boolean).join(', ')
}

/** 指纹比较：忽略大小写、冒号和空格，避免因为书写风格判为不匹配。 */
export function fingerprintsEqual(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[\s:]/g, '').toUpperCase()
  return norm(a) === norm(b) && norm(a).length > 0
}

export function isCurrentlyValid(info: CertificateInfo, now: Date): boolean {
  return now >= new Date(info.validFrom) && now <= new Date(info.validTo)
}

/** 语义化版本比较，只取前三段数字；返回 -1 / 0 / 1。 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v.split(/[.\-+]/).map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n))
  const av = parse(a)
  const bv = parse(b)
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const x = av[i] ?? 0
    const y = bv[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}
