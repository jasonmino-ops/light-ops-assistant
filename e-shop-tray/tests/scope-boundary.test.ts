import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(target) : entry.name.endsWith('.ts') ? [target] : []
  })
}

describe('ES-TRAY-01 scope boundary', () => {
  it('contains no Store Runtime, cloud, activation, identity, heartbeat, or task queue implementation', () => {
    const source = sourceFiles(path.resolve(__dirname, '../src'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')
    expect(source).not.toMatch(/storeRuntime|store-runtime|cloudClient|activation|heartbeat|taskQueue|task_queue/i)
    expect(source).not.toMatch(/BrowserWindow|qz-tray|printers\.find|net\.Socket/)
  })

  it('keeps one fixed Windows queue and only the frozen Local API endpoints', () => {
    const transport = readFileSync(path.resolve(__dirname, '../src/printing/windowsQueueTransport.ts'), 'utf8')
    const localApi = readFileSync(path.resolve(__dirname, '../src/localApi.ts'), 'utf8')
    expect(transport).toMatch(/ESHOP_TRAY_QUEUE_NAME = '前台'/)
    expect(transport).not.toMatch(/findPrinter|listPrinter|discover/i)
    expect(localApi).toMatch(/'\/v1\/health'/)
    expect(localApi).toMatch(/'\/v1\/print'/)
    expect(localApi).not.toMatch(/\/activate|\/heartbeat|\/tasks|\/identity/)
  })

  it('isolates the exact Preview origin to the FIELD-SANDBOX packaged entry point', () => {
    const formalMain = readFileSync(path.resolve(__dirname, '../src/main.ts'), 'utf8')
    const fieldMain = readFileSync(path.resolve(__dirname, '../src/main.fieldSandbox.ts'), 'utf8')
    const fieldBuilder = readFileSync(path.resolve(__dirname, '../electron-builder.field-sandbox.yml'), 'utf8')
    const exactOrigin = 'https://light-ops-assistant-kly7gvtbe-sunxiaojian0910-2556s-projects.vercel.app'

    expect(formalMain).not.toContain('FIELD_SANDBOX')
    expect(fieldMain).toMatch(/ESHOP_TRAY_ALLOWED_ORIGINS\.add\(ESHOP_TRAY_FIELD_SANDBOX_ORIGIN\)/)
    expect(fieldBuilder).toContain('main: dist/main.fieldSandbox.js')
    expect(fieldBuilder).toContain('E-Shop-Tray-Setup-${version}-FIELD-SANDBOX.${ext}')
    expect(fieldMain + fieldBuilder).not.toContain('*.vercel.app')

    const localApi = readFileSync(path.resolve(__dirname, '../src/localApi.ts'), 'utf8')
    expect(localApi.split(exactOrigin)).toHaveLength(2)
  })
})
