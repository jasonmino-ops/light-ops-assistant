import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectQzVersion, hasQzInstallAssets, restartQzIfRunning, restoreQzRunState } from '../src/core/qz'
import { computeStatus } from '../src/core/status'
import { install, uninstall } from '../src/core/actions'
import { eshopCertPath, eshopStatePath } from '../src/core/env'
import { DEFAULT_QZ_PROPERTIES, makeFake, type Fake } from './helpers/fakeEnv'

let fake: Fake | null = null
afterEach(() => {
  fake?.cleanup()
  fake = null
})

describe('QZ Tray 2.2.6 版本探测', () => {
  it('测试夹具就是真实的 2.2.6 安装结构：无 app\\*.cfg、无 version.txt', () => {
    fake = makeFake()
    const entries = readdirSync(fake.qzDir).sort()
    expect(entries).toEqual(['libs', 'qz-tray.exe', 'qz-tray.jar', 'qz-tray.properties'])
    expect(existsSync(join(fake.qzDir, 'app'))).toBe(false)
    expect(existsSync(join(fake.qzDir, 'version.txt'))).toBe(false)
  })

  it('从 qz-tray.exe 的 ProductVersion 读出版本', () => {
    fake = makeFake({ qzVersion: '2.2.6' })
    expect(detectQzVersion(fake.env)).toEqual({ status: 'OK', version: '2.2.6' })
    const call = fake.processCalls.find((c) => c.command === 'powershell')
    expect(call?.args.join(' ')).toContain('VersionInfo.ProductVersion')
    expect(call?.args.join(' ')).toContain('qz-tray.exe')
  })

  it('PowerShell 失败 → 版本无法确认，并带上原因', () => {
    fake = makeFake({ qzVersionQuery: 'fail' })
    const result = detectQzVersion(fake.env)
    expect(result.status).toBe('UNCONFIRMED')
    expect(result.version).toBeNull()
    expect(result.status === 'UNCONFIRMED' && result.reason).toContain('ProductVersion')
  })

  it('PowerShell 成功但输出无版本号 → 版本无法确认', () => {
    fake = makeFake({ qzVersionQuery: 'garbage' })
    expect(detectQzVersion(fake.env).status).toBe('UNCONFIRMED')
  })

  it('qz-tray.exe 缺失 → 版本无法确认，且不去起进程', () => {
    fake = makeFake()
    rmSync(join(fake.qzDir, 'qz-tray.exe'))
    const result = detectQzVersion(fake.env)
    expect(result.status).toBe('UNCONFIRMED')
    expect(fake.processCalls.some((c) => c.command === 'powershell')).toBe(false)
  })

  it('绝不读取 app\\*.cfg —— 即使存在也不能成为版本来源', () => {
    fake = makeFake({ qzVersion: '2.2.6', qzVersionQuery: 'fail' })
    mkdirSync(join(fake.qzDir, 'app'), { recursive: true })
    writeFileSync(join(fake.qzDir, 'app', 'qz-tray.cfg'), '[Application]\napp.version=9.9.9\n')
    const result = detectQzVersion(fake.env)
    expect(result.status).toBe('UNCONFIRMED')
    expect(result.version).toBeNull()
  })

  it('绝不读取 version.txt', () => {
    fake = makeFake({ qzVersionQuery: 'fail' })
    writeFileSync(join(fake.qzDir, 'version.txt'), '9.9.9')
    expect(detectQzVersion(fake.env).version).toBeNull()
  })

  it('安装资产判定要求 exe 与 jar 同时存在', () => {
    fake = makeFake()
    expect(hasQzInstallAssets(fake.env)).toBe(true)

    const noJar = makeFake({ omitJar: true })
    expect(hasQzInstallAssets(noJar.env)).toBe(false)
    noJar.cleanup()
  })
})

describe('版本无法确认时的最小安全行为', () => {
  it('状态显示"版本无法确认"，不伪造版本', () => {
    fake = makeFake({ qzVersionQuery: 'fail' })
    const status = computeStatus(fake.env)
    expect(status.code).toBe('MISCONFIGURED')
    expect(status.qz.version).toBeNull()
    const check = status.checks.find((c) => c.id === 'QZ_VERSION')
    expect(check?.ok).toBe(false)
    expect(check?.detail).toContain('版本无法确认')
  })

  it('版本无法确认时拒绝写入，并给出可执行的人工核对路径', () => {
    fake = makeFake({ qzVersionQuery: 'fail' })
    const result = install(fake.env)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('版本无法确认，拒绝写入')
    expect(result.error).toContain('VersionInfo.ProductVersion')
    expect(existsSync(eshopCertPath(fake.env))).toBe(false)
    expect(readFileSync(fake.propsPath, 'utf8')).toBe(DEFAULT_QZ_PROPERTIES)
  })

  it('低于 minimumQzVersion 时拒绝写入', () => {
    fake = makeFake({ qzVersion: '2.2.4' })
    const result = install(fake.env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('低于要求的 2.2.5')
    expect(readFileSync(fake.propsPath, 'utf8')).toBe(DEFAULT_QZ_PROPERTIES)
  })

  it('安装资产不完整（缺 qz-tray.jar）时拒绝写入', () => {
    fake = makeFake({ omitJar: true })
    const result = install(fake.env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('不是完整的 QZ Tray 安装')
    expect(readFileSync(fake.propsPath, 'utf8')).toBe(DEFAULT_QZ_PROPERTIES)
  })
})

describe('QZ 重启必须确认进程状态', () => {
  it('QZ 未运行时不重启也不拉起', () => {
    fake = makeFake()
    const outcome = restartQzIfRunning(fake.env)
    expect(outcome).toMatchObject({ attempted: false, ok: true })
    expect(fake.isQzRunning()).toBe(false)
  })

  it('停不掉时返回失败，不看 taskkill 的返回码', () => {
    fake = makeFake({ failStop: true })
    fake.setQzRunning(true)
    const outcome = restartQzIfRunning(fake.env)
    expect(outcome.ok).toBe(false)
    expect(outcome.detail).toContain('无法确认')
    expect(outcome.detail).toContain('已退出')
  })

  it('起不来时返回失败，不看 cmd /c start 的返回码', () => {
    fake = makeFake({ failStart: true })
    fake.setQzRunning(true)
    const outcome = restartQzIfRunning(fake.env)
    expect(outcome.ok).toBe(false)
    expect(outcome.detail).toContain('无法确认它重新启动')
  })

  it('正常重启时确认进程重新出现', () => {
    fake = makeFake()
    fake.setQzRunning(true)
    expect(restartQzIfRunning(fake.env).ok).toBe(true)
    expect(fake.isQzRunning()).toBe(true)
  })

  it('重启无法确认时安装不得报告成功，并回滚配置', () => {
    fake = makeFake({ failStart: true })
    fake.setQzRunning(true)

    const result = install(fake.env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('QZ Tray 重启未能确认')
    expect(readFileSync(fake.propsPath, 'utf8')).toBe(DEFAULT_QZ_PROPERTIES)
    expect(existsSync(eshopCertPath(fake.env))).toBe(false)
    expect(existsSync(eshopStatePath(fake.env))).toBe(false)
  })

  it('卸载时重启无法确认同样不得报告成功，且配置被回滚', () => {
    // 安装时 QZ 未运行（不触发重启），装完再让它"运行起来"，
    // 于是卸载会走重启分支，而 failStart 让重启无法确认。
    fake = makeFake({ failStart: true })
    install(fake.env)
    const propsAfterInstall = readFileSync(fake.propsPath, 'utf8')
    fake.setQzRunning(true)

    const result = uninstall(fake.env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('QZ Tray 重启未能确认')
    expect(readFileSync(fake.propsPath, 'utf8')).toBe(propsAfterInstall)
    expect(existsSync(eshopCertPath(fake.env))).toBe(true)
    expect(existsSync(eshopStatePath(fake.env))).toBe(true)
  })
})

describe('回滚后恢复 QZ 原始运行状态', () => {
  it('操作前未运行 → 回滚后仍未运行，绝不被拉起', () => {
    fake = makeFake()
    expect(fake.isQzRunning()).toBe(false)
    mkdirSync(`${fake.propsPath}.eshop-tmp`, { recursive: true })

    const result = install(fake.env)
    expect(result.ok).toBe(false)
    expect(fake.isQzRunning()).toBe(false)
    expect(fake.processCalls.some((c) => c.command === 'cmd')).toBe(false)
    expect(result.steps.some((s) => s.message.includes('运行状态与操作前一致'))).toBe(true)

    rmSync(`${fake.propsPath}.eshop-tmp`, { recursive: true, force: true })
  })

  it('操作前在运行 → 回滚后恢复运行', () => {
    fake = makeFake()
    fake.setQzRunning(true)
    mkdirSync(`${fake.propsPath}.eshop-tmp`, { recursive: true })

    const result = install(fake.env)
    expect(result.ok).toBe(false)
    expect(fake.isQzRunning()).toBe(true)

    rmSync(`${fake.propsPath}.eshop-tmp`, { recursive: true, force: true })
  })

  it('操作前在运行、但恢复不了运行 → 明确标记回滚未完全成功', () => {
    fake = makeFake({ failStart: true })
    fake.setQzRunning(true)

    const result = install(fake.env)
    expect(result.ok).toBe(false)
    expect(result.rolledBack).toBe(false)
    expect(result.steps.some((s) => !s.ok && s.message.includes('未能恢复'))).toBe(true)
  })

  it('restoreQzRunState：操作前未运行但现在跑起来了 → 停回去', () => {
    fake = makeFake()
    fake.setQzRunning(true)
    const restored = restoreQzRunState(fake.env, false)
    expect(restored.ok).toBe(true)
    expect(fake.isQzRunning()).toBe(false)
  })
})
