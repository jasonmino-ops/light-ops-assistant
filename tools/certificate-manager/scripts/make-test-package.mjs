/**
 * 生成一个【仅用于测试/真机联调】的 Certificate Package。
 *
 * 生产环境的 E-Shop Root CA 由运维在离线环境签发，只把公开的 .crt 交给我们，
 * 放进 certificate-package/ 即可。本脚本存在的唯一目的，是让开发和 Windows
 * 真机验收在没有生产 Root 的情况下也能跑通完整流程。
 *
 * 私钥只在系统临时目录中短暂存在，脚本结束前整目录删除，
 * 绝不会进入仓库、安装包或 certificate-package/。
 *
 * 用法：node scripts/make-test-package.mjs [version]
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'certificate-package')
const version = Number(process.argv[2] ?? 1)
if (!Number.isInteger(version) || version < 1) {
  console.error('version 必须是 >= 1 的整数')
  process.exit(1)
}

const work = mkdtempSync(join(tmpdir(), 'eshop-testca-'))
try {
  const keyPath = join(work, 'ca.key')
  const crtPath = join(work, 'ca.crt')
  const cnfPath = join(work, 'openssl.cnf')

  writeFileSync(cnfPath, [
    '[req]', 'distinguished_name = dn', 'x509_extensions = v3_ca', 'prompt = no',
    '[dn]', 'C = KH', 'O = E-Shop (TEST ONLY)', 'CN = E-Shop TEST Root CA - DO NOT USE IN PRODUCTION',
    '[v3_ca]', 'basicConstraints = critical,CA:TRUE', 'keyUsage = critical,keyCertSign,cRLSign',
    'subjectKeyIdentifier = hash',
  ].join('\n'))

  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', crtPath,
    '-days', '3650', '-sha256', '-config', cnfPath,
  ], { stdio: 'pipe' })

  const pem = readFileSync(crtPath, 'utf8')
  const x509 = new X509Certificate(pem)

  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'eshop-root-ca.crt'), pem)
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify({
    schema: 'eshop.certificate-package/v1',
    certificateId: 'eshop-test-root-ca',
    version,
    displayName: 'E-Shop TEST Root CA（仅用于验收，不可用于生产）',
    rootFile: 'eshop-root-ca.crt',
    rootFingerprint: x509.fingerprint256.toUpperCase(),
    validFrom: new Date(x509.validFrom).toISOString(),
    validTo: new Date(x509.validTo).toISOString(),
    minimumQzVersion: '2.2.5',
  }, null, 2)}\n`)

  console.log(`[make-test-package] v${version} -> ${outDir}`)
  console.log(`[make-test-package] SHA-256 ${x509.fingerprint256.toUpperCase()}`)
} finally {
  // 私钥连同临时目录一起销毁
  rmSync(work, { recursive: true, force: true })
}
