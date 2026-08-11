import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(target) : entry.name.endsWith('.ts') ? [target] : []
  })
}

describe('ES-TRAY-02 FIELD scope boundary', () => {
  it('adds only the Cloud print worker and one exact FIELD store binding', () => {
    const source = sourceFiles(path.resolve(__dirname, '../src')).map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(source).toMatch(/ST169E7000/)
    expect(source).toMatch(/\/api\/store-runtime\/runtime\/tasks\/claim/)
    expect(source).not.toMatch(/heartbeat|taskQueue|task_queue|mDNS|auto.?discover|customer.?display|scanner|\bOTA\b/i)
    expect(source).not.toMatch(/qz-tray|printers\.find|net\.Socket/)
  })

  it('keeps one fixed Windows queue and the frozen Local API unchanged', () => {
    const transport = readFileSync(path.resolve(__dirname, '../src/printing/windowsQueueTransport.ts'), 'utf8')
    const localApi = readFileSync(path.resolve(__dirname, '../src/localApi.ts'), 'utf8')
    expect(transport).toMatch(/ESHOP_TRAY_QUEUE_NAME = '前台'/)
    expect(transport).not.toMatch(/findPrinter|listPrinter|discover/i)
    expect(localApi).toMatch(/'\/v1\/health'/)
    expect(localApi).toMatch(/'\/v1\/print'/)
    expect(localApi).not.toMatch(/\/activate|\/heartbeat|\/tasks|\/identity/)
  })

  it('stores the bearer only through Electron safeStorage and never logs secrets or payloads', () => {
    const credentials = readFileSync(path.resolve(__dirname, '../src/cloud/credentialStore.ts'), 'utf8')
    const main = readFileSync(path.resolve(__dirname, '../src/main.ts'), 'utf8')
    expect(credentials).toMatch(/safeStorage\.encryptString/)
    expect(credentials).toMatch(/safeStorage\.decryptString/)
    expect(credentials).not.toMatch(/plaintext|writeFile\([^\n]*deviceToken/)
    expect(main).not.toMatch(/console\.(?:log|info|warn|error).*token|console\.(?:log|info|warn|error).*payload/i)
  })
})
