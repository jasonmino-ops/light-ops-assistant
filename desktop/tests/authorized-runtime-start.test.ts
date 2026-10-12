import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  AuthorizedRuntimeStartupStageRunner,
  createAuthorizedRuntimeStartupDiagnostics,
} from '../src/main/activation/activationRuntime'
import { initLogger } from '../src/main/logger'

describe('authorized runtime startup', () => {
  it('persists stage evidence with correlation ID and redacts credentials', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'eshop-authorized-runtime-'))
    try {
      initLogger(baseDir)
      const runner = new AuthorizedRuntimeStartupStageRunner(createAuthorizedRuntimeStartupDiagnostics())
      await runner.run('hardware', 'corr-hardware-001', async () => undefined)
      await expect(runner.run('ipc', 'corr-ipc-001', async () => {
        throw new Error('PIN=123456 deviceToken=secret-token Authorization: Bearer full-secret')
      })).rejects.toThrow()

      const logText = readFileSync(join(baseDir, 'logs/eshop-desktop.log'), 'utf8')
      expect(logText).toContain('corr-hardware-001')
      expect(logText).toContain('corr-ipc-001')
      expect(logText).toContain('"status":"BEGIN"')
      expect(logText).toContain('"status":"PASS"')
      expect(logText).toContain('"status":"FAILED"')
      expect(logText).toContain('"failedStage":"ipc"')
      expect(logText).toContain('"exceptionType":"Error"')
      expect(logText).toContain('[redacted]')
      expect(logText).not.toContain('123456')
      expect(logText).not.toContain('secret-token')
      expect(logText).not.toContain('full-secret')
    } finally {
      rmSync(baseDir, { recursive: true, force: true })
    }
  })

  it('reuses completed IPC and windows after a later stage fails', async () => {
    const events: Array<{ stage: string; status: string; reused?: boolean }> = []
    const runner = new AuthorizedRuntimeStartupStageRunner((event) => events.push(event))
    const calls = {
      hardware: 0,
      ipc: 0,
      employee: 0,
      customerAttempts: 0,
      customerCreated: 0,
      display: 0,
      tray: 0,
    }

    const start = async () => {
      await runner.run('hardware', 'corr-start', async () => { calls.hardware += 1 })
      await runner.run('ipc', 'corr-start', async () => { calls.ipc += 1 })
      await runner.run('employee-window', 'corr-start', async () => { calls.employee += 1 })
      await runner.run('customer-window', 'corr-start', async () => {
        calls.customerAttempts += 1
        if (calls.customerAttempts === 1) throw new Error('customer window failed')
        calls.customerCreated += 1
      })
      await runner.run('display-watch', 'corr-start', async () => { calls.display += 1 })
      await runner.run('tray', 'corr-start', async () => { calls.tray += 1 })
    }

    await expect(start()).rejects.toThrow('customer window failed')
    await expect(start()).resolves.toBeUndefined()
    expect(calls).toEqual({
      hardware: 1,
      ipc: 1,
      employee: 1,
      customerAttempts: 2,
      customerCreated: 1,
      display: 1,
      tray: 1,
    })
    expect(events).toContainEqual({ stage: 'ipc', status: 'BEGIN', correlationId: 'corr-start', reused: true })
    expect(events).toContainEqual({ stage: 'employee-window', status: 'PASS', correlationId: 'corr-start', reused: true })
    expect(events).toContainEqual({ stage: 'tray', status: 'PASS', correlationId: 'corr-start' })
  })

  it('keeps all authorized startup stages behind the idempotent runner', () => {
    const source = readFileSync(join(__dirname, '../src/main/main.ts'), 'utf8')
    for (const stage of ['hardware', 'ipc', 'employee-window', 'customer-window', 'display-watch', 'tray']) {
      expect(source).toContain(`authorizedRuntimeStages.run('${stage}'`)
    }
    expect(source).toContain('authorizedRuntimeStartPromise')
    expect(source).toContain('ipcRegistrationAttempted')
    expect(source).toContain('if (ipcRegistered) return')
  })
})
