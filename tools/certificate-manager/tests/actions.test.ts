import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { install, repair, uninstall, update } from '../src/core/actions'
import { computeStatus } from '../src/core/status'
import { eshopCertPath, eshopStatePath } from '../src/core/env'
import { getProperty, setProperty } from '../src/core/properties'
import { readState } from '../src/core/state'
import { DEFAULT_QZ_PROPERTIES, makeCa, makeFake, writePackage, type Fake } from './helpers/fakeEnv'

let fake: Fake | null = null
afterEach(() => {
  if (fake) {
    if (existsSync(fake.qzDir)) chmodSync(fake.qzDir, 0o755)
    fake.cleanup()
  }
  fake = null
})

const override = (f: Fake) => getProperty(readFileSync(f.propsPath, 'utf8'), 'authcert.override')

describe('安装', () => {
  it('安装成功：写入证书、配置 authcert.override、记录状态', () => {
    fake = makeFake()
    const result = install(fake.env)

    expect(result.ok).toBe(true)
    expect(result.status.code).toBe('OK')
    expect(existsSync(eshopCertPath(fake.env))).toBe(true)
    expect(override(fake)).toBe(eshopCertPath(fake.env))
    expect(readState(fake.env)).toMatchObject({ version: 1, propertyCreatedByEshop: true })
  })

  it('不触碰 authcert.override 以外的任何 QZ 配置', () => {
    fake = makeFake()
    install(fake.env)
    const after = readFileSync(fake.propsPath, 'utf8')

    expect(getProperty(after, 'wss.keystore')).toBe('C:\\Program Files\\QZ Tray\\auth\\qz-tray.jks')
    expect(getProperty(after, 'wss.storepass')).toBe('abc123')
    expect(after).toContain('#Fri Aug 01 09:12:33 ICT 2026')
  })

  it('重复安装幂等：不重复写配置，状态保持正常', () => {
    fake = makeFake()
    install(fake.env)
    const first = readFileSync(fake.propsPath, 'utf8')

    const second = install(fake.env)
    expect(second.ok).toBe(true)
    expect(readFileSync(fake.propsPath, 'utf8')).toBe(first)
    expect(second.steps.some((s) => s.message.includes('无需重复安装'))).toBe(true)
  })

  it('保留第三方已有的 authcert.override 条目', () => {
    fake = makeFake({
      qzPropertiesContent: setProperty(DEFAULT_QZ_PROPERTIES, 'authcert.override', 'C:\\Vendor\\vendor.crt'),
    })
    install(fake.env)
    expect(override(fake)).toBe(`C:\\Vendor\\vendor.crt;${eshopCertPath(fake.env)}`)
    expect(readState(fake.env)).toMatchObject({
      propertyCreatedByEshop: false,
      priorPropertyValue: 'C:\\Vendor\\vendor.crt',
    })
  })

  it('QZ 未安装时拒绝安装，且不产生任何改动', () => {
    fake = makeFake({ qzInstalled: false })
    const result = install(fake.env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('未检测到 QZ Tray')
    expect(existsSync(eshopCertPath(fake.env))).toBe(false)
  })

  it('非管理员时拒绝安装并给出明确提示', () => {
    fake = makeFake()
    chmodSync(fake.qzDir, 0o555)
    const result = install(fake.env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('管理员')
    expect(existsSync(eshopCertPath(fake.env))).toBe(false)
  })

  it('QZ 配置文件缺失时拒绝，不凭空创建', () => {
    fake = makeFake({ qzPropertiesContent: null })
    const result = install(fake.env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('QZ 配置文件缺失')
    expect(existsSync(fake.propsPath)).toBe(false)
  })

  it('QZ 原本在运行时会重启，原本没运行则不拉起', () => {
    fake = makeFake()
    fake.setQzRunning(true)
    install(fake.env)
    expect(fake.processCalls.some((c) => c.command === 'taskkill')).toBe(true)
    expect(fake.processCalls.some((c) => c.command === 'cmd')).toBe(true)

    const quiet = makeFake()
    install(quiet.env)
    expect(quiet.processCalls.some((c) => c.command === 'taskkill')).toBe(false)
    quiet.cleanup()
  })
})

describe('更新', () => {
  it('更新成功：证书与状态都升到新版本', () => {
    fake = makeFake({ packageVersion: 1 })
    install(fake.env)
    writePackage(fake.env.packageDir, makeCa(2).pem, 2)

    const result = update(fake.env)
    expect(result.ok).toBe(true)
    expect(result.status.code).toBe('OK')
    expect(readState(fake.env)?.version).toBe(2)
    expect(computeStatus(fake.env).installed.fingerprint).toBe(makeCa(2).fingerprint)
  })

  it('未安装时拒绝更新', () => {
    fake = makeFake()
    const result = update(fake.env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('请先执行【安装】')
  })

  it('拒绝降级', () => {
    fake = makeFake({ packageVersion: 3 })
    install(fake.env)
    writePackage(fake.env.packageDir, makeCa(2).pem, 2)
    const result = update(fake.env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('拒绝降级')
  })

  it('更新失败自动回滚：证书、QZ 配置、安装记录全部还原', () => {
    fake = makeFake({ packageVersion: 1 })
    install(fake.env)
    const propsBefore = readFileSync(fake.propsPath, 'utf8')
    const certBefore = readFileSync(eshopCertPath(fake.env), 'utf8')
    const stateBefore = readFileSync(eshopStatePath(fake.env), 'utf8')

    writePackage(fake.env.packageDir, makeCa(2).pem, 2)
    // 占住原子写用的临时文件名，让 qz-tray.properties 的写入必定失败
    mkdirSync(`${fake.propsPath}.eshop-tmp`, { recursive: true })

    const result = update(fake.env)
    expect(result.ok).toBe(false)
    expect(result.rolledBack).toBe(true)

    rmSync(`${fake.propsPath}.eshop-tmp`, { recursive: true, force: true })
    expect(readFileSync(fake.propsPath, 'utf8')).toBe(propsBefore)
    expect(readFileSync(eshopCertPath(fake.env), 'utf8')).toBe(certBefore)
    expect(JSON.parse(readFileSync(eshopStatePath(fake.env), 'utf8'))).toEqual(JSON.parse(stateBefore))
    // 回滚回到了 v1，而程序携带的已是 v2，所以正确结论是"需要更新"而非"正常"
    expect(computeStatus(fake.env).code).toBe('NEEDS_UPDATE')
  })

  it('首次安装失败时回滚不留下半成品', () => {
    fake = makeFake()
    mkdirSync(`${fake.propsPath}.eshop-tmp`, { recursive: true })

    const result = install(fake.env)
    expect(result.ok).toBe(false)
    expect(result.rolledBack).toBe(true)
    expect(existsSync(eshopCertPath(fake.env))).toBe(false)
    expect(existsSync(eshopStatePath(fake.env))).toBe(false)

    rmSync(`${fake.propsPath}.eshop-tmp`, { recursive: true, force: true })
    expect(readFileSync(fake.propsPath, 'utf8')).toBe(DEFAULT_QZ_PROPERTIES)
  })

  it('多次更新后 priorPropertyValue 仍是 E-Shop 介入前的原值', () => {
    fake = makeFake({
      packageVersion: 1,
      qzPropertiesContent: setProperty(DEFAULT_QZ_PROPERTIES, 'authcert.override', 'C:\\Vendor\\vendor.crt'),
    })
    install(fake.env)
    writePackage(fake.env.packageDir, makeCa(2).pem, 2)
    update(fake.env)
    expect(readState(fake.env)?.priorPropertyValue).toBe('C:\\Vendor\\vendor.crt')
  })
})

describe('修复', () => {
  it('修复 Root 文件丢失', () => {
    fake = makeFake()
    install(fake.env)
    rmSync(eshopCertPath(fake.env), { force: true })
    expect(computeStatus(fake.env).code).toBe('MISCONFIGURED')

    expect(repair(fake.env).ok).toBe(true)
    expect(computeStatus(fake.env).code).toBe('OK')
  })

  it('修复指纹不匹配', () => {
    fake = makeFake()
    install(fake.env)
    writeFileSync(eshopCertPath(fake.env), makeCa(2).pem)

    expect(repair(fake.env).ok).toBe(true)
    expect(computeStatus(fake.env).installed.fingerprint).toBe(makeCa(1).fingerprint)
  })

  it('修复 QZ 配置缺失', () => {
    fake = makeFake()
    install(fake.env)
    writeFileSync(fake.propsPath, DEFAULT_QZ_PROPERTIES)

    expect(repair(fake.env).ok).toBe(true)
    expect(override(fake)).toBe(eshopCertPath(fake.env))
  })

  it('修复 QZ 配置错误，且不动无关配置', () => {
    fake = makeFake()
    install(fake.env)
    writeFileSync(fake.propsPath, setProperty(DEFAULT_QZ_PROPERTIES, 'authcert.override', 'C:\\wrong.crt'))

    expect(repair(fake.env).ok).toBe(true)
    expect(override(fake)).toBe(`C:\\wrong.crt;${eshopCertPath(fake.env)}`)
    expect(getProperty(readFileSync(fake.propsPath, 'utf8'), 'wss.storepass')).toBe('abc123')
  })
})

describe('卸载', () => {
  it('卸载成功并恢复安装前的 QZ 配置', () => {
    fake = makeFake()
    install(fake.env)

    const result = uninstall(fake.env)
    expect(result.ok).toBe(true)
    expect(result.status.code).toBe('NOT_INSTALLED')
    expect(existsSync(eshopCertPath(fake.env))).toBe(false)
    expect(existsSync(eshopStatePath(fake.env))).toBe(false)
    expect(readFileSync(fake.propsPath, 'utf8').replace(/\s+$/, ''))
      .toBe(DEFAULT_QZ_PROPERTIES.replace(/\s+$/, ''))
  })

  it('只摘除自己的条目，保留第三方证书', () => {
    fake = makeFake({
      qzPropertiesContent: setProperty(DEFAULT_QZ_PROPERTIES, 'authcert.override', 'C:\\Vendor\\vendor.crt'),
    })
    install(fake.env)
    uninstall(fake.env)
    expect(override(fake)).toBe('C:\\Vendor\\vendor.crt')
  })

  it('无安装记录时也只删除 E-Shop 自己添加的内容', () => {
    fake = makeFake()
    install(fake.env)
    rmSync(eshopStatePath(fake.env), { force: true })

    const result = uninstall(fake.env)
    expect(result.ok).toBe(true)
    expect(result.steps.some((s) => s.message.includes('无安装记录'))).toBe(true)
    expect(override(fake)).toBeNull()
    expect(getProperty(readFileSync(fake.propsPath, 'utf8'), 'wss.alias')).toBe('qz-tray')
  })

  it('不卸载 QZ Tray、不删除 QZ 官方证书', () => {
    fake = makeFake()
    writeFileSync(`${fake.qzDir}/qz-tray-root.crt`, 'QZ OFFICIAL ROOT')
    install(fake.env)
    uninstall(fake.env)

    expect(existsSync(`${fake.qzDir}/qz-tray.exe`)).toBe(true)
    expect(readFileSync(`${fake.qzDir}/qz-tray-root.crt`, 'utf8')).toBe('QZ OFFICIAL ROOT')
  })

  it('卸载后再安装可恢复正常', () => {
    fake = makeFake()
    install(fake.env)
    uninstall(fake.env)
    expect(install(fake.env).ok).toBe(true)
    expect(computeStatus(fake.env).code).toBe('OK')
  })
})
