import { describe, it, expect } from 'vitest'
import {
  IPC_CHANNELS,
  SENDABLE_BY_ROLE,
  INVOKABLE_BY_ROLE,
  RECEIVABLE_BY_ROLE,
} from '../src/shared/ipcChannels'

describe('IPC 通道白名单（A6）', () => {
  it('通道全集固定为 17 个，且全部带 eshop: 前缀', () => {
    const all = Object.values(IPC_CHANNELS)
    expect(all).toHaveLength(17)
    for (const ch of all) expect(ch.startsWith('eshop:')).toBe(true)
    expect(new Set(all).size).toBe(all.length)
  })

  it('员工窗口只能发送 cart:publish，只能 invoke health、受控原生全屏与部署诊断', () => {
    expect(SENDABLE_BY_ROLE.employee).toEqual([IPC_CHANNELS.CART_PUBLISH])
    expect(INVOKABLE_BY_ROLE.employee).toEqual([
      IPC_CHANNELS.HEALTH_GET,
      IPC_CHANNELS.EMPLOYEE_FULLSCREEN_ENTER,
      IPC_CHANNELS.EMPLOYEE_FULLSCREEN_EXIT,
      IPC_CHANNELS.EMPLOYEE_FULLSCREEN_STATE,
      IPC_CHANNELS.DEPLOYMENT_GET_HEALTH,
      IPC_CHANNELS.DEPLOYMENT_GET_SYSTEM_INFO,
      IPC_CHANNELS.DEPLOYMENT_RETRY_CLOUD,
      IPC_CHANNELS.DEPLOYMENT_RELOAD_BUSINESS,
      IPC_CHANNELS.DEPLOYMENT_RECHECK_PROVIDER,
      IPC_CHANNELS.DEPLOYMENT_RECHECK_DISPLAYS,
      IPC_CHANNELS.DEPLOYMENT_OPEN_LOGS,
      IPC_CHANNELS.DEPLOYMENT_EXPORT_DIAGNOSTICS,
      IPC_CHANNELS.DEPLOYMENT_QUIT,
      IPC_CHANNELS.DEPLOYMENT_RETURN_TO_ACTIVATION,
    ])
  })

  it('顾客窗口只能发送 display:ready，禁止 invoke（无法反向控制 POS）', () => {
    expect(SENDABLE_BY_ROLE.customer).toEqual([IPC_CHANNELS.DISPLAY_READY])
    expect(INVOKABLE_BY_ROLE.customer).toEqual([])
    // 顾客窗口不允许发送购物车数据
    expect(SENDABLE_BY_ROLE.customer).not.toContain(IPC_CHANNELS.CART_PUBLISH)
    expect(INVOKABLE_BY_ROLE.customer).not.toContain(IPC_CHANNELS.EMPLOYEE_FULLSCREEN_ENTER)
    expect(INVOKABLE_BY_ROLE.customer).not.toContain(IPC_CHANNELS.EMPLOYEE_FULLSCREEN_EXIT)
    expect(INVOKABLE_BY_ROLE.customer).not.toContain(IPC_CHANNELS.EMPLOYEE_FULLSCREEN_STATE)
    expect(INVOKABLE_BY_ROLE.customer).not.toContain(IPC_CHANNELS.DEPLOYMENT_GET_SYSTEM_INFO)
    expect(INVOKABLE_BY_ROLE.customer).not.toContain(IPC_CHANNELS.DEPLOYMENT_EXPORT_DIAGNOSTICS)
  })

  it('只有顾客窗口接收 cart:apply', () => {
    expect(RECEIVABLE_BY_ROLE.customer).toEqual([IPC_CHANNELS.CART_APPLY])
    expect(RECEIVABLE_BY_ROLE.employee).toEqual([])
  })

  it('白名单中不存在任意执行类通道', () => {
    const all = Object.values(IPC_CHANNELS) as string[]
    for (const ch of all) {
      expect(ch).not.toMatch(/exec|eval|shell|fs|file|spawn|command/i)
    }
  })
})
