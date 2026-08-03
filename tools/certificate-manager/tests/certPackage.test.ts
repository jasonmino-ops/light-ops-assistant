import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadCertificatePackage } from '../src/core/certPackage'
import { containsPrivateKeyMaterial } from '../src/core/certificate'
import { makeCa, writePackage } from './helpers/fakeEnv'
import { splitOverride, addToOverride, removeFromOverride, overrideContains } from '../src/core/override'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'eshop-pkg-'))
  dirs.push(d)
  return d
}
afterEach(() => { dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })) })

describe('Certificate Package 校验', () => {
  it('合法包可加载', () => {
    const dir = tmp()
    writePackage(dir, makeCa(1).pem, 3)
    const pkg = loadCertificatePackage(dir)
    expect(pkg.manifest.version).toBe(3)
    expect(pkg.manifest.certificateId).toBe('eshop-root-ca')
  })

  it('缺 manifest 直接拒绝', () => {
    expect(() => loadCertificatePackage(tmp())).toThrow('PACKAGE_MANIFEST_MISSING')
  })

  it('指纹与证书不一致时拒绝', () => {
    const dir = tmp()
    writePackage(dir, makeCa(1).pem, 1, { rootFingerprint: 'AA:BB' })
    expect(() => loadCertificatePackage(dir)).toThrow('PACKAGE_FINGERPRINT_MISMATCH')
  })

  it('schema 不认识时拒绝', () => {
    const dir = tmp()
    writePackage(dir, makeCa(1).pem, 1, { schema: 'something/v2' })
    expect(() => loadCertificatePackage(dir)).toThrow('PACKAGE_SCHEMA_UNSUPPORTED')
  })

  it('Root 文件缺失时拒绝', () => {
    const dir = tmp()
    writePackage(dir, makeCa(1).pem, 1)
    rmSync(join(dir, 'eshop-root-ca.crt'))
    expect(() => loadCertificatePackage(dir)).toThrow('PACKAGE_ROOT_FILE_MISSING')
  })

  it('包内出现私钥时整包拒绝', () => {
    const dir = tmp()
    writePackage(dir, makeCa(1).pem, 1)
    writeFileSync(join(dir, 'leaked.txt'), '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n')
    expect(() => loadCertificatePackage(dir)).toThrow('PACKAGE_CONTAINS_PRIVATE_KEY')
  })

  it('包内出现 .p12 之类的密钥文件时整包拒绝', () => {
    const dir = tmp()
    writePackage(dir, makeCa(1).pem, 1)
    writeFileSync(join(dir, 'store.p12'), 'binary')
    expect(() => loadCertificatePackage(dir)).toThrow('PACKAGE_CONTAINS_KEY_FILE')
  })

  it('非 CA 证书被拒绝', () => {
    const dir = tmp()
    const work = tmp()
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(work, 'k.key'), '-out', join(work, 'leaf.crt'),
      '-days', '365', '-sha256', '-subj', '/CN=leaf',
      '-addext', 'basicConstraints=critical,CA:FALSE',
    ], { stdio: 'pipe' })
    const pem = readFileSync(join(work, 'leaf.crt'), 'utf8')
    writePackage(dir, pem, 1)
    expect(() => loadCertificatePackage(dir)).toThrow('PACKAGE_ROOT_NOT_CA')
  })

  it('私钥标记识别覆盖常见格式', () => {
    expect(containsPrivateKeyMaterial('-----BEGIN RSA PRIVATE KEY-----')).toBe(true)
    expect(containsPrivateKeyMaterial('-----BEGIN EC PRIVATE KEY-----')).toBe(true)
    expect(containsPrivateKeyMaterial('-----BEGIN CERTIFICATE-----')).toBe(false)
  })
})

describe('authcert.override 列表处理', () => {
  const mine = 'C:\\ProgramData\\E-Shop\\CertificateManager\\certs\\eshop-root-ca.crt'
  const other = 'C:\\Program Files\\Other\\other.crt'

  it('追加时保留第三方条目', () => {
    expect(addToOverride(other, mine)).toBe(`${other};${mine}`)
  })

  it('重复追加是幂等的', () => {
    expect(addToOverride(`${other};${mine}`, mine)).toBe(`${other};${mine}`)
  })

  it('摘除时只删自己', () => {
    expect(removeFromOverride(`${other};${mine}`, mine)).toBe(other)
  })

  it('路径比较忽略大小写与斜杠方向', () => {
    expect(overrideContains(mine.toLowerCase().replace(/\\/g, '/'), mine)).toBe(true)
  })

  it('空值解析为空列表', () => {
    expect(splitOverride(null)).toEqual([])
    expect(splitOverride('')).toEqual([])
  })
})
