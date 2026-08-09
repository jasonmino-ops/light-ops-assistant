import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { CertificatePackage, CertificatePackageManifest } from './types'
import {
  containsPrivateKeyMaterial,
  fingerprintsEqual,
  parseCertificate,
} from './certificate'

export const PACKAGE_MANIFEST_FILE = 'manifest.json'
export const PACKAGE_SCHEMA = 'eshop.certificate-package/v1'

/**
 * 加载并校验随程序携带的 Certificate Package。
 * 任何一项不通过就整包拒绝 —— 宁可显示"配置异常"，也不能把来路不明的 Root 装进 QZ。
 */
export function loadCertificatePackage(dir: string): CertificatePackage {
  const manifestPath = join(dir, PACKAGE_MANIFEST_FILE)
  if (!existsSync(manifestPath)) throw new Error('PACKAGE_MANIFEST_MISSING')

  let manifest: CertificatePackageManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new Error('PACKAGE_MANIFEST_INVALID_JSON')
  }

  if (manifest.schema !== PACKAGE_SCHEMA) throw new Error('PACKAGE_SCHEMA_UNSUPPORTED')
  for (const field of [
    'certificateId', 'displayName', 'rootFile', 'rootFingerprint',
    'validFrom', 'validTo', 'minimumQzVersion',
  ] as const) {
    if (typeof manifest[field] !== 'string' || manifest[field].length === 0) {
      throw new Error(`PACKAGE_FIELD_MISSING:${field}`)
    }
  }
  if (!Number.isInteger(manifest.version) || manifest.version < 1) {
    throw new Error('PACKAGE_VERSION_INVALID')
  }

  // 整包扫描私钥：证书包里出现任何私钥都属于严重事故，必须直接拒绝。
  assertNoPrivateKeyInDir(dir)

  const certPath = join(dir, manifest.rootFile)
  if (!existsSync(certPath)) throw new Error('PACKAGE_ROOT_FILE_MISSING')
  const pem = readFileSync(certPath, 'utf8')

  const info = parseCertificate(pem)
  if (!info.isCa) throw new Error('PACKAGE_ROOT_NOT_CA')
  if (!fingerprintsEqual(info.fingerprint, manifest.rootFingerprint)) {
    throw new Error('PACKAGE_FINGERPRINT_MISMATCH')
  }
  if (Math.abs(Date.parse(info.validFrom) - Date.parse(manifest.validFrom)) > 1000) {
    throw new Error('PACKAGE_VALID_FROM_MISMATCH')
  }
  if (Math.abs(Date.parse(info.validTo) - Date.parse(manifest.validTo)) > 1000) {
    throw new Error('PACKAGE_VALID_TO_MISMATCH')
  }

  return { manifest, pem, dir }
}

function assertNoPrivateKeyInDir(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      assertNoPrivateKeyInDir(full)
      continue
    }
    if (/\.(key|p12|pfx|jks)$/i.test(entry)) throw new Error('PACKAGE_CONTAINS_KEY_FILE')
    let text: string
    try {
      text = readFileSync(full, 'utf8')
    } catch {
      continue
    }
    if (containsPrivateKeyMaterial(text)) throw new Error('PACKAGE_CONTAINS_PRIVATE_KEY')
  }
}
