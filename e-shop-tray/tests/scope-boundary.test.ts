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
})
