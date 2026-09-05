import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Channel A scope boundary', () => {
  it('keeps queue selection fixed to 前台 and does not introduce QZ or NP330', async () => {
    const source = await readFile(path.resolve(__dirname, '../src/printing/windowsQueueTransport.ts'), 'utf8')
    expect(source).toContain("ESHOP_TRAY_QUEUE_NAME = '前台'")
    expect(source).not.toMatch(/NP330|qz\./i)
  })

  it('packages only the Tray and its existing RAW script', async () => {
    const config = await readFile(path.resolve(__dirname, '../electron-builder.yml'), 'utf8')
    expect(config).toContain('Write-RawPrint.ps1')
    expect(config).not.toMatch(/installer\/mvp|NP330/i)
  })
})
