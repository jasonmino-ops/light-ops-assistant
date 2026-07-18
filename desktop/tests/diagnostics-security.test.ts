import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getHealthSnapshot, recordHealthError } from '../src/main/runtimeHealth'
import { loadConfig } from '../src/main/config'
import {
  assembleAndWriteBundle,
  assertDiagnosticsEntriesSafe,
  buildSafeRecentLogText,
  exportDiagnosticsBundle,
} from '../src/main/deploymentSupport'
import {
  maskStoreCode,
  shortenInstallationId,
  type DeploymentSystemInfo,
} from '../src/shared/deploymentDiagnostics'

const electronState = vi.hoisted(() => ({
  savePath: '',
}))

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.2.0-pilot.2',
    getLocale: () => 'zh-CN',
    getPath: (name: string) => join(tmpdir(), `eshop-test-${name}`),
  },
  dialog: {
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: electronState.savePath })),
  },
  screen: {
    getAllDisplays: () => [
      {
        id: 1,
        scaleFactor: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
        rotation: 0,
        internal: true,
      },
    ],
  },
  shell: {
    openPath: vi.fn(async () => ''),
  },
}))

const fullStoreCode = 'STORE-A'
const fullInstallationId = 'installation-secret-1234567890'

function makeSystemInfo(overrides: Partial<DeploymentSystemInfo> = {}): DeploymentSystemInfo {
  const health = getHealthSnapshot().deployment
  return {
    version: '0.2.0-pilot.2',
    distributionClass: 'UNSIGNED_INTERNAL',
    shortInstallationId: shortenInstallationId(fullInstallationId),
    maskedStoreCode: maskStoreCode(fullStoreCode),
    activationState: 'AUTHORIZED_RUNNING',
    cloudState: 'loaded',
    providerState: 'ok',
    displayState: '1 display(s), 0 external',
    logsState: 'available',
    lastError: null,
    lastFailureCode: null,
    lastSuccessfulCloudLoadAt: null,
    windowsVersion: 'Windows test',
    arch: 'x64',
    locale: 'zh-CN',
    uptimeSeconds: 1,
    runtimeHealth: health,
    ...overrides,
  }
}

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'ep-mb3-07b1-diag-'))
}

function hostileLogText() {
  return [
    JSON.stringify({
      ts: '2026-07-18T00:00:00.000Z',
      level: 'info',
      event: 'config.loaded',
      data: {
        storeCode: fullStoreCode,
        url: `https://elifekh.com/desktop/pos?storeCode=${fullStoreCode}&deviceToken=raw-token`,
        arbitrary: { nested: 'must not cross' },
      },
    }),
    JSON.stringify({
      ts: '2026-07-18T00:00:01.000Z',
      level: 'error',
      event: 'health.error',
      data: {
        component: 'employee-window',
        message: [
          `failed https://elifekh.com/desktop/pos?storeCode=${fullStoreCode}&pin=123456`,
          'Error: raw failure',
          '    at Object.<anonymous> (C:\\Users\\Jason\\app.js:12:34)',
          'Authorization: Bearer raw-token',
          'customer phone +85512345678 address Phnom Penh',
          'order ORD-1 payment card receipt text',
          'DATABASE_URL=postgres://secret',
        ].join('\n'),
      },
    }),
  ].join('\n')
}

function expectNoRawDiagnosticsContent(value: string) {
  expect(value).not.toContain(fullStoreCode)
  expect(value).not.toContain(fullInstallationId)
  expect(value).not.toContain('https://elifekh.com')
  expect(value).not.toContain('deviceToken')
  expect(value).not.toContain('raw-token')
  expect(value).not.toContain('pin=123456')
  expect(value).not.toContain('Bearer')
  expect(value).not.toContain('+85512345678')
  expect(value).not.toContain('Phnom Penh')
  expect(value).not.toContain('ORD-1')
  expect(value).not.toContain('card receipt')
  expect(value).not.toContain('DATABASE_URL')
  expect(value).not.toContain('C:\\Users\\Jason')
  expect(value).not.toContain('app.js:12:34')
}

describe('diagnostics fail-closed security', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    loadConfig(dir)
    electronState.savePath = join(dir, 'diagnostics.zip')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rebuilds recent logs from allowed fields without raw lines or unsafe values', async () => {
    const safeLogText = buildSafeRecentLogText(hostileLogText(), {
      fullStoreCode,
      fullInstallationId,
    })
    expectNoRawDiagnosticsContent(safeLogText)
    expect(safeLogText).toContain('config.loaded')
    expect(safeLogText).toContain('health.error')
    expect(safeLogText).not.toContain('arbitrary')

    const logPath = join(dir, 'eshop-desktop.log')
    writeFileSync(logPath, hostileLogText(), 'utf8')
    const target = join(dir, 'safe.zip')
    const result = await assembleAndWriteBundle({
      filePath: target,
      bundleName: basename(target),
      systemInfo: makeSystemInfo(),
      activation: {
        state: 'AUTHORIZED_RUNNING',
        storeCodeHint: fullStoreCode,
        installationId: fullInstallationId,
      },
      provider: null,
      logPath,
    })

    expect(result).toMatchObject({ ok: true, fileName: 'safe.zip' })
    const zipText = readFileSync(target, 'utf8')
    expect(zipText).toContain('recent-main-logs.jsonl')
    expectNoRawDiagnosticsContent(zipText)
  })

  it('fails export if unsafe content survives into a bundle entry', () => {
    expect(() =>
      assertDiagnosticsEntriesSafe([
        {
          name: 'unsafe.json',
          data: Buffer.from('{"authorization":"Bearer raw-token"}', 'utf8'),
        },
      ]),
    ).toThrow(/DIAGNOSTICS_REDACTION_FAILED/)
  })

  it('does not create the final target after diagnostics timeout', async () => {
    const result = await exportDiagnosticsBundle({
      activation: {
        state: 'AUTHORIZED_RUNNING',
        storeCodeHint: fullStoreCode,
        installationId: fullInstallationId,
      },
      provider: null,
      timeoutMs: 10,
      delayBeforeFinalRenameMs: 100,
    })

    expect(result).toEqual({
      ok: false,
      error: 'DIAGNOSTICS_EXPORT_TIMEOUT',
      message: '诊断包导出超时',
    })
    expect(existsSync(electronState.savePath)).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(existsSync(electronState.savePath)).toBe(false)
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('publishes the final ZIP only after scan and atomic rename', async () => {
    const target = join(dir, 'atomic.zip')
    const result = await assembleAndWriteBundle({
      filePath: target,
      bundleName: basename(target),
      systemInfo: makeSystemInfo(),
      activation: {
        state: 'AUTHORIZED_RUNNING',
        storeCodeHint: fullStoreCode,
        installationId: fullInstallationId,
      },
      provider: null,
      logPath: null,
    })

    expect(result).toMatchObject({ ok: true, fileName: 'atomic.zip' })
    expect(existsSync(target)).toBe(true)
  })

  it('does not create the final ZIP when final scan fails', async () => {
    const target = join(dir, 'scan-fail.zip')
    await expect(assembleAndWriteBundle({
      filePath: target,
      bundleName: basename(target),
      systemInfo: makeSystemInfo({ maskedStoreCode: fullStoreCode }),
      activation: {
        state: 'AUTHORIZED_RUNNING',
        storeCodeHint: fullStoreCode,
        installationId: fullInstallationId,
      },
      provider: null,
      logPath: null,
    })).rejects.toThrow(/DIAGNOSTICS_REDACTION_FAILED/)

    expect(existsSync(target)).toBe(false)
  })

  it('stores lastError as a structured safe object', () => {
    recordHealthError(
      'employee-window',
      [
        `did-fail-load https://elifekh.com/desktop/pos?storeCode=${fullStoreCode}`,
        'Error: boom',
        '    at crash (C:\\Users\\Jason\\app.ts:1:2)',
      ].join('\n'),
    )

    const lastError = getHealthSnapshot().lastError
    expect(lastError).toEqual({
      code: expect.any(String),
      component: 'employee-window',
      occurredAt: expect.any(String),
      safeMessage: expect.any(String),
    })
    const serialized = JSON.stringify(lastError)
    expectNoRawDiagnosticsContent(serialized)
  })
})
