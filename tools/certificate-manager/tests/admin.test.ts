import { afterEach, describe, expect, it } from 'vitest'
import { checkAdmin } from '../src/core/admin'
import { makeFake, type Fake } from './helpers/fakeEnv'

let fake: Fake | null = null
afterEach(() => {
  fake?.cleanup()
  fake = null
})

describe('管理员权限（进程令牌）', () => {
  it('已提升 → elevated=true，来源是令牌', () => {
    fake = makeFake({ elevated: true })
    const result = checkAdmin(fake.env)
    expect(result).toMatchObject({ elevated: true, inAdminGroup: true, source: 'token' })
  })

  it('管理员组成员但未提升 → elevated=false，提示右键以管理员身份运行', () => {
    fake = makeFake({ elevated: false, inAdminGroup: true })
    const result = checkAdmin(fake.env)
    expect(result.elevated).toBe(false)
    expect(result.inAdminGroup).toBe(true)
    expect(result.detail).toContain('以管理员身份运行')
  })

  it('非管理员账户 → 提示换账户，不提示右键提权', () => {
    fake = makeFake({ elevated: false, inAdminGroup: false })
    const result = checkAdmin(fake.env)
    expect(result.detail).toContain('不是管理员')
    expect(result.detail).not.toContain('右键')
  })

  it('判定用的是 IsInRole 而不是用户名或目录探针', () => {
    fake = makeFake()
    checkAdmin(fake.env)
    const script = fake.processCalls.find((c) => c.command === 'powershell')?.args.join(' ') ?? ''
    expect(script).toContain('WindowsPrincipal')
    expect(script).toContain('IsInRole')
    expect(script).toContain('S-1-5-32-544')
  })

  it('QZ 目录未发现时权限判定照常工作 —— 现场误判的根因', () => {
    // 旧实现拿"能否写 QZ 目录"当判据，qzInstallDir 为 null 时必然报权限不足。
    fake = makeFake({ qzInstalled: false, elevated: true })
    expect(fake.env.qzInstallDir).toBeNull()
    expect(checkAdmin(fake.env)).toMatchObject({ elevated: true, source: 'token' })
  })

  it('令牌读不到时退回写探针，并在提示里说明是兜底结论', () => {
    fake = makeFake({ adminQuery: 'fail' })
    const result = checkAdmin(fake.env)
    expect(result.source).toBe('write-probe')
    expect(result.detail).toContain('无法读取进程令牌')
    // 临时目录可写，兜底判定为通过
    expect(result.elevated).toBe(true)
  })

  it('令牌读不到且目录也不可写 → 判为权限不足，不放行', () => {
    fake = makeFake({ adminQuery: 'fail', qzInstalled: false })
    const result = checkAdmin(fake.env)
    expect(result.source).toBe('write-probe')
    expect(result.elevated).toBe(false)
  })
})
