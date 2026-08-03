import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { computeStatus } from '../src/core/status'
import { install } from '../src/core/actions'
import { eshopCertPath } from '../src/core/env'
import { setProperty } from '../src/core/properties'
import { makeCa, makeExpiredCa, makeFake, writePackage, type Fake } from './helpers/fakeEnv'

let fake: Fake | null = null
afterEach(() => {
  fake?.cleanup()
  fake = null
})

function check(f: Fake, id: string) {
  return computeStatus(f.env).checks.find((c) => c.id === id)
}

describe('状态判断', () => {
  it('QZ 未安装 → 配置异常', () => {
    fake = makeFake({ qzInstalled: false })
    const status = computeStatus(fake.env)
    expect(status.code).toBe('MISCONFIGURED')
    expect(status.qz.installed).toBe(false)
    expect(check(fake, 'QZ_INSTALLED')?.ok).toBe(false)
  })

  it('QZ 已装但未部署 Root → 未安装', () => {
    fake = makeFake()
    const status = computeStatus(fake.env)
    expect(status.code).toBe('NOT_INSTALLED')
    expect(status.qz.version).toBe('2.2.6')
  })

  it('安装后 → 正常', () => {
    fake = makeFake()
    expect(install(fake.env).ok).toBe(true)
    const status = computeStatus(fake.env)
    expect(status.code).toBe('OK')
    expect(status.installed.version).toBe(1)
    expect(status.installed.fingerprint).toBe(makeCa(1).fingerprint)
  })

  it('程序携带更新版本 → 需要更新', () => {
    fake = makeFake({ packageVersion: 1 })
    install(fake.env)
    writePackage(fake.env.packageDir, makeCa(2).pem, 2)
    const status = computeStatus(fake.env)
    expect(status.code).toBe('NEEDS_UPDATE')
    expect(status.installed.version).toBe(1)
    expect(status.package.version).toBe(2)
  })

  it('Root 文件丢失 → 配置异常且可修复', () => {
    fake = makeFake()
    install(fake.env)
    rmSync(eshopCertPath(fake.env), { force: true })
    const status = computeStatus(fake.env)
    expect(status.code).toBe('MISCONFIGURED')
    expect(check(fake, 'ROOT_FILE')).toMatchObject({ ok: false, repairable: true })
  })

  it('Root 指纹被替换 → 配置异常且可修复', () => {
    fake = makeFake()
    install(fake.env)
    writeFileSync(eshopCertPath(fake.env), makeCa(2).pem)
    const status = computeStatus(fake.env)
    expect(status.code).toBe('MISCONFIGURED')
    expect(check(fake, 'ROOT_FINGERPRINT')).toMatchObject({ ok: false, repairable: true })
  })

  it('QZ 配置缺失 → 配置异常且可修复', () => {
    fake = makeFake()
    install(fake.env)
    writeFileSync(fake.propsPath, 'wss.alias=qz-tray\n')
    expect(check(fake, 'QZ_OVERRIDE_CONFIG')).toMatchObject({ ok: false, repairable: true })
    expect(computeStatus(fake.env).code).toBe('MISCONFIGURED')
  })

  it('QZ 配置指向别处 → 配置异常且可修复', () => {
    fake = makeFake()
    install(fake.env)
    const text = readFileSync(fake.propsPath, 'utf8')
    writeFileSync(fake.propsPath, setProperty(text, 'authcert.override', 'C:\\somewhere\\else.crt'))
    expect(check(fake, 'QZ_OVERRIDE_CONFIG')).toMatchObject({ ok: false, repairable: true })
  })

  it('QZ 版本过低 → 配置异常', () => {
    fake = makeFake({ qzVersion: '2.2.4' })
    const status = computeStatus(fake.env)
    expect(status.code).toBe('MISCONFIGURED')
    expect(check(fake, 'QZ_VERSION')?.ok).toBe(false)
  })

  it('证书包缺失 → 配置异常并说明原因', () => {
    fake = makeFake({ withPackage: false })
    const status = computeStatus(fake.env)
    expect(status.code).toBe('MISCONFIGURED')
    expect(status.package.error).toBe('PACKAGE_MANIFEST_MISSING')
  })

  it('Root 已过期 → 配置异常且不可自动修复', () => {
    const expired = makeExpiredCa()
    fake = makeFake({ pem: expired.pem })
    install(fake.env)
    const status = computeStatus(fake.env)
    expect(status.code).toBe('MISCONFIGURED')
    expect(check(fake, 'ROOT_VALIDITY')).toMatchObject({ ok: false, repairable: false })
  })

  it('管理员组成员但进程未提升 → 配置异常并提示以管理员身份运行', () => {
    fake = makeFake({ elevated: false, inAdminGroup: true })
    const status = computeStatus(fake.env)
    expect(status.isAdmin).toBe(false)
    expect(status.code).toBe('MISCONFIGURED')
    expect(check(fake, 'ADMIN_RIGHTS')?.detail).toContain('以管理员身份运行')
  })

  it('根本不是管理员 → 提示换管理员账户，不提示右键提权', () => {
    fake = makeFake({ elevated: false, inAdminGroup: false })
    expect(check(fake, 'ADMIN_RIGHTS')?.detail).toContain('不是管理员')
  })

  it('QZ 未安装时权限判定不受影响 —— 现场那次误判的正解', () => {
    fake = makeFake({ qzInstalled: false, elevated: true })
    const status = computeStatus(fake.env)
    expect(status.qz.installed).toBe(false)
    expect(status.isAdmin).toBe(true)
    expect(check(fake, 'ADMIN_RIGHTS')?.ok).toBe(true)
  })
})
