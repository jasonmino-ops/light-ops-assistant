import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { identifyQzProcesses } from '../src/core/discovery'
import { isQzRunning, restartQzIfRunning, startQzAndConfirm, stopQzAndConfirm } from '../src/core/qz'
import { install } from '../src/core/actions'
import { eshopCertPath, eshopLogPath, eshopStatePath } from '../src/core/env'
import { readLogTail } from '../src/core/fsAtomic'
import type { ProcessRunner } from '../src/core/env'
import { DEFAULT_QZ_PROPERTIES, makeFake, type Fake } from './helpers/fakeEnv'

const SELF_PID = 999_999

/**
 * 现场第二次真机测试的复现基线：
 * 旧检测语句本身含 "qz-tray.jar"，且枚举全部进程，
 * 于是执行查询的 powershell 每轮都把自己算成 QZ，退出确认永远不成立。
 */
const SELF_MATCH_POWERSHELL =
  'powershell -NoProfile -NonInteractive -Command ' +
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*qz-tray.jar*' }"

const dirs: string[] = []
function makeQzDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'eshop-ident-'))
  dirs.push(root)
  const dir = join(root, 'qz tray')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'qz-tray.jar'), 'stub')
  writeFileSync(join(dir, 'qz-tray.properties'), 'wss.alias=qz-tray\n')
  writeFileSync(join(dir, 'qz-tray.exe'), 'stub')
  return dir
}

let fake: Fake | null = null
afterEach(() => {
  fake?.cleanup()
  fake = null
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }))
})

/** rows 形如 "pid|name|sessionId|commandLine"。 */
function runnerWith(rows: string[]): ProcessRunner {
  return (command) => command === 'powershell'
    ? { ok: true, output: rows.join('\r\n') }
    : { ok: false, output: '' }
}

describe('严格 QZ 进程身份', () => {
  it('执行查询的 powershell 自身含 qz-tray.jar → 绝不认作 QZ（现场故障根因）', () => {
    const dir = makeQzDir()
    const result = identifyQzProcesses(runnerWith([`1234|powershell.exe|1|${SELF_MATCH_POWERSHELL}`]), dir, SELF_PID)
    expect(result.accepted).toEqual([])
    expect(result.rejected[0]).toMatchObject({ pid: 1234, reason: 'excluded-image' })
  })

  it('cmd.exe 命令行含 qz-tray.jar → 不认作 QZ', () => {
    const dir = makeQzDir()
    const result = identifyQzProcesses(
      runnerWith([`2222|cmd.exe|1|cmd /c echo -jar "${dir}\\qz-tray.jar"`]), dir, SELF_PID)
    expect(result.accepted).toEqual([])
    expect(result.rejected[0].reason).toBe('excluded-image')
  })

  it('本进程自身 → 排除', () => {
    const dir = makeQzDir()
    const result = identifyQzProcesses(
      runnerWith([`${SELF_PID}|javaw.exe|1|javaw -jar "${dir}/qz-tray.jar"`]), dir, SELF_PID)
    expect(result.accepted).toEqual([])
    expect(result.rejected[0].reason).toBe('self')
  })

  it('无关 javaw.exe（没有 -jar qz-tray.jar）→ 不认作 QZ', () => {
    const dir = makeQzDir()
    const result = identifyQzProcesses(
      runnerWith(['3333|javaw.exe|1|"C:\\Java\\javaw.exe" -cp lib\\app.jar com.other.Main']), dir, SELF_PID)
    expect(result.accepted).toEqual([])
    expect(result.rejected[0].reason).toBe('no-qz-tray-jar-arg')
  })

  it('javaw.exe 只在普通参数文本里提到 qz-tray.jar → 不认作 QZ', () => {
    const dir = makeQzDir()
    const result = identifyQzProcesses(
      runnerWith([`4444|javaw.exe|1|"C:\\Java\\javaw.exe" -Dnote=qz-tray.jar -cp x com.other.Main`]), dir, SELF_PID)
    expect(result.accepted).toEqual([])
    expect(result.rejected[0].reason).toBe('no-qz-tray-jar-arg')
  })

  it('javaw.exe 跑的是别处的 qz-tray.jar → 不认作 QZ（目录必须一致）', () => {
    const dir = makeQzDir()
    const result = identifyQzProcesses(
      runnerWith(['5555|javaw.exe|1|javaw -jar "C:\\elsewhere\\qz-tray.jar"']), dir, SELF_PID)
    expect(result.accepted).toEqual([])
    expect(result.rejected[0].reason).toBe('jar-outside-install-dir')
  })

  it('jar 路径指向已发现目录但文件不存在 → 不认作 QZ', () => {
    const dir = makeQzDir()
    rmSync(join(dir, 'qz-tray.jar'))
    const result = identifyQzProcesses(
      runnerWith([`6666|javaw.exe|1|javaw -jar "${dir}/qz-tray.jar"`]), dir, SELF_PID)
    expect(result.accepted).toEqual([])
    expect(result.rejected[0].reason).toBe('jar-file-missing')
  })

  it('现场真实命令行 → 必须识别为 QZ', () => {
    const dir = makeQzDir()
    const cmd = `"${dir}\\runtime\\bin\\javaw.exe" -Xms512m -Djava.security.manager=allow -jar "${dir}/qz-tray.jar"`
    const result = identifyQzProcesses(runnerWith([`8376|javaw.exe|1|${cmd}`]), dir, SELF_PID)
    expect(result.accepted).toEqual([
      { pid: 8376, name: 'javaw.exe', sessionId: 1, commandLine: cmd, installDir: dir },
    ])
  })

  it('qz-tray.exe 必须来自已发现的安装目录', () => {
    const dir = makeQzDir()
    const good = identifyQzProcesses(runnerWith([`7777|qz-tray.exe|1|"${dir}\\qz-tray.exe"`]), dir, SELF_PID)
    expect(good.accepted.map((p) => p.pid)).toEqual([7777])

    const bad = identifyQzProcesses(runnerWith(['7778|qz-tray.exe|1|"C:\\other\\qz-tray.exe"']), dir, SELF_PID)
    expect(bad.accepted).toEqual([])
    expect(bad.rejected[0].reason).toBe('exe-outside-install-dir')
  })

  it('安装目录未知时不认定任何进程', () => {
    const result = identifyQzProcesses(
      runnerWith(['9999|javaw.exe|1|javaw -jar "C:\\qz\\qz-tray.jar"']), null, SELF_PID)
    expect(result.accepted).toEqual([])
    expect(result.rejected[0].reason).toBe('no-install-dir')
  })

  it('无关 Java 进程与真 QZ 并存时，只认后者', () => {
    const dir = makeQzDir()
    const result = identifyQzProcesses(runnerWith([
      '1111|javaw.exe|1|"C:\\Java\\javaw.exe" -jar "C:\\Pos\\other.jar"',
      `8376|javaw.exe|1|javaw -jar "${dir}/qz-tray.jar"`,
      '2222|java.exe|0|"C:\\Java\\java.exe" -cp . Server',
    ]), dir, SELF_PID)
    expect(result.accepted.map((p) => p.pid)).toEqual([8376])
  })
})

describe('停止 / 启动确认', () => {
  it('旧 PID 消失且无严格 QZ 候选 → 退出确认成功', () => {
    fake = makeFake()
    fake.setQzRunning(true)
    const targets = [{ pid: fake.qzPid(), name: 'javaw.exe', sessionId: 1, commandLine: '', installDir: fake.qzDir }]
    expect(stopQzAndConfirm(fake.env, targets)).toBe(true)
    expect(isQzRunning(fake.env)).toBe(false)
  })

  it('存在其它无关 javaw.exe 时不影响退出确认', () => {
    fake = makeFake({ extraProcesses: ['1111|javaw.exe|1|"C:\\Java\\javaw.exe" -jar "C:\\Pos\\other.jar"'] })
    fake.setQzRunning(true)
    const targets = [{ pid: fake.qzPid(), name: 'javaw.exe', sessionId: 1, commandLine: '', installDir: fake.qzDir }]
    expect(stopQzAndConfirm(fake.env, targets)).toBe(true)
  })

  it('start 后出现新 PID → 启动确认成功，且新旧 PID 不同', () => {
    fake = makeFake()
    fake.setQzRunning(true)
    const oldPid = fake.qzPid()
    stopQzAndConfirm(fake.env, [{ pid: oldPid, name: 'javaw.exe', sessionId: 1, commandLine: '', installDir: fake.qzDir }])

    expect(startQzAndConfirm(fake.env, [oldPid])).toBe(true)
    expect(fake.qzPid()).not.toBe(oldPid)
  })

  it('完整重启：stop 成功 → 进入 start → 确认新 PID', () => {
    fake = makeFake()
    fake.setQzRunning(true)
    const oldPid = fake.qzPid()

    const outcome = restartQzIfRunning(fake.env)
    expect(outcome).toMatchObject({ attempted: true, ok: true })
    expect(fake.qzPid()).not.toBe(oldPid)
    expect(fake.processCalls.some((c) => c.command === 'cmd')).toBe(true)
  })
})

describe('安装完整流程与诊断日志', () => {
  it('QZ 在运行时安装成功：stop → start 实际执行 → 不回滚', () => {
    fake = makeFake()
    fake.setQzRunning(true)
    const oldPid = fake.qzPid()

    const result = install(fake.env)
    expect(result.ok).toBe(true)
    expect(result.status.code).toBe('OK')
    expect(existsSync(eshopCertPath(fake.env))).toBe(true)
    expect(existsSync(eshopStatePath(fake.env))).toBe(true)
    // start 阶段确实执行了
    expect(fake.processCalls.some((c) => c.command === 'cmd')).toBe(true)
    expect(fake.qzPid()).not.toBe(oldPid)
  })

  it('诊断日志覆盖目标 PID、taskkill 返回、每轮确认、进入 start 阶段', () => {
    fake = makeFake()
    fake.setQzRunning(true)
    const oldPid = fake.qzPid()
    install(fake.env)

    const log = readLogTail(eshopLogPath(fake.env), 500).join('\n')
    expect(log).toContain('restart begin installDir=')
    expect(log).toContain(`target pid=${oldPid}`)
    expect(log).toContain(`taskkill /PID ${oldPid}`)
    expect(log).toContain('stop-confirm #1')
    expect(log).toContain('entering start phase')
    expect(log).toContain('start invoke exitOk=')
    expect(log).toContain('start-confirm #1')
    // 不输出整套系统进程列表
    expect(log).not.toContain('Get-CimInstance')
  })

  it('启动失败 → 仍进入回滚，Root / properties / state.json 全部恢复', () => {
    fake = makeFake({ failStart: true })
    fake.setQzRunning(true)

    const result = install(fake.env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('QZ Tray 重启未能确认')
    expect(existsSync(eshopCertPath(fake.env))).toBe(false)
    expect(existsSync(eshopStatePath(fake.env))).toBe(false)
    expect(readFileSync(fake.propsPath, 'utf8')).toBe(DEFAULT_QZ_PROPERTIES)
  })

  it('停止失败时不进入 start 阶段', () => {
    fake = makeFake({ failStop: true })
    fake.setQzRunning(true)

    const result = install(fake.env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('无法确认 QZ Tray 进程已退出')
    const log = readLogTail(eshopLogPath(fake.env), 500).join('\n')
    expect(log).toContain('stop-confirm timeout')
    expect(log).not.toContain('entering start phase')
  })
})
