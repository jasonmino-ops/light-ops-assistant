import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { signSession } from '../lib/session'
import { reportRange } from '../lib/product-sales/dates'
import { COPY } from '../lib/product-sales/copy'
import { IMAGE_COPY } from '../lib/product-sales/image-copy'
import type { ProductSalesResult } from '../lib/product-sales/contract'

// Local built app only. Report APIs use fixtures; actual html2canvas, PNG,
// preview and download run in Chromium. Native file sharing is simulated.
const base = process.env.PRODUCT_SALES_UI_BASE_URL ?? 'http://127.0.0.1:3107'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
const output = '.task-state/product-sales-images'
const now = new Date('2026-09-09T05:12:34Z')
const stores = [{ tenantId: 'ta', storeId: 'sa', storeName: '金边旗舰店 Phnom Penh ហាងភ្នំពេញ', currencyCode: 'USD' }, { tenantId: 'tb', storeId: 'sb', storeName: 'សាខាទី២', currencyCode: 'KHR' }]
const products = [{ tenantId: 'ta', productId: 'p1', name: '冰咖啡 Iced coffee កាហ្វេទឹកកក', barcode: '100', status: 'ACTIVE' }, { tenantId: 'tb', productId: 'p2', name: '茶 <script>bad()</script> ទឹកតែទឹកដោះគោ', barcode: '200', status: 'ACTIVE' }]
const result: ProductSalesResult = {
  range: reportRange({ period: 'TODAY' }, now), generatedAt: now.toISOString(), stores,
  rows: products.map((p, i) => ({ ...p, storeId: stores[i].storeId, quantity: i ? '3.00' : '1.50', salesAmount: i ? '12000.00' : '30.25', refundAmount: i ? '0.00' : '0.25' })),
  totals: [{ currencyCode: 'USD', quantity: '1.50', salesAmount: '30.25', refundAmount: '0.25' }, { currencyCode: 'KHR', quantity: '3.00', salesAmount: '12000.00', refundAmount: '0.00' }], unidentifiedSales: 0, unidentifiedRefunds: 1,
}
async function main() {
  mkdirSync(output, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
    await context.addCookies([{ name: 'auth-session', value: signSession({ tenantId: 'ta', storeId: 'sa', userId: 'owner', role: 'OWNER' }), url: base }])
    await context.addInitScript(() => {
      // tsx preserves function names in serialized callbacks using this helper.
      Reflect.set(globalThis, '__name', Function('value', 'return value'))
      if (!localStorage.getItem('lang')) localStorage.setItem('lang', 'zh')
      const state = { encodes: 0, shares: 0, revoked: [] as string[], mode: 'success', active: false, digest: '', fileName: '', resolveShare: null as null | (() => void) }
      ;(window as any).imageTest = state
      const originalEncode = HTMLCanvasElement.prototype.toBlob
      HTMLCanvasElement.prototype.toBlob = function (...args) { state.encodes++; return originalEncode.apply(this, args) }
      const originalRevoke = URL.revokeObjectURL
      URL.revokeObjectURL = (url) => { state.revoked.push(url); originalRevoke(url) }
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => state.mode !== 'unsupported' })
      Object.defineProperty(navigator, 'share', { configurable: true, value: (data: ShareData) => {
        state.shares++; state.active = navigator.userActivation.isActive
        const file = data.files![0]; state.fileName = file.name
        void file.arrayBuffer().then((bytes) => crypto.subtle.digest('SHA-256', bytes)).then((bytes) => { state.digest = Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, '0')).join('') })
        if (state.mode === 'cancel') return Promise.reject(new DOMException('cancelled', 'AbortError'))
        if (state.mode === 'fail') return Promise.reject(new Error('unavailable'))
        if (state.mode === 'pending') return new Promise<void>((resolve) => { state.resolveShare = resolve })
        return Promise.resolve()
      } })
    })
    let queryResult = result
    let queryCount = 0, writes = 0
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== new URL(base).origin) return route.fulfill({ status: 200, contentType: url.hostname.includes('fonts') ? 'text/css' : 'application/javascript', body: '' })
      if (!url.pathname.startsWith('/api/')) return route.continue()
      const path = url.pathname.replace('/api/owner/product-sales', '')
      let data: unknown = {}
      if (url.pathname === '/api/auth/status') data = { ok: true }
      else if (url.pathname === '/api/me') data = { role: 'OWNER', storeId: 'sa', tenantId: 'ta' }
      else if (url.pathname === '/api/es-tray-02/config') data = { fieldOnly: true, enabled: false }
      else if (path === '/options') data = { stores, products, today: '2026-09-09', nextCursor: null }
      else if (path === '/groups') data = []
      else if (path === '/query') { queryCount++; data = queryResult }
      else if (path === '/reports') data = { reports: [{ id: 'history-1', groupId: 'group', reportDate: '2026-09-08', generatedAt: now.toISOString(), name: '重点商品 ក្រុមកាហ្វេ' }], nextCursor: null }
      else if (path === '/reports/history-1') data = { result: { ...result, groupName: '重点商品 ក្រុមកាហ្វេ', range: reportRange({ period: 'YESTERDAY' }, now) } }
      else if (route.request().method() !== 'GET') { writes++; return route.fulfill({ status: 500, body: 'unexpected write' }) }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    })
    const page = await context.newPage()
    const errors: string[] = []
    const downloads: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('download', (d) => downloads.push(d.suggestedFilename()))
    await page.goto(`${base}/product-sales`)
    await page.getByRole('checkbox', { name: /Iced coffee/ }).check()
    await page.getByRole('checkbox', { name: /bad/ }).check()
    await page.getByRole('button', { name: COPY.zh.query, exact: true }).click()
    const modal = page.getByRole('dialog')
    for (const lang of ['zh', 'en', 'km'] as const) {
      if (lang !== 'zh') {
        await page.evaluate((lang) => localStorage.setItem('lang', lang), lang)
        await page.reload()
        await page.getByRole('button', { name: /2026-09-08 ·/ }).click()
      }
      const copy = IMAGE_COPY[lang]
      const before = await page.evaluate(() => (window as any).imageTest.encodes)
      await page.getByRole('button', { name: copy.generate, exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
      await expect(modal.getByRole('img')).toBeVisible({ timeout: 20000 })
      assert.equal(await page.evaluate(() => (window as any).imageTest.encodes), before + 1, 'duplicate clicks generate just once')
      assert.equal(await page.evaluate(() => (window as any).imageTest.shares), 0, 'generation never auto-shares')
      await expect(modal).toHaveJSProperty('scrollWidth', await modal.evaluate((node) => node.clientWidth))
      await expect(page.locator('[data-report-image-row]')).toHaveCount(2)
      await expect(page.locator('[data-report-image-card] script')).toHaveCount(0)
      const [download] = await Promise.all([page.waitForEvent('download'), modal.getByRole('button', { name: copy.download, exact: true }).click()])
      const saved = `${output}/${lang === 'zh' ? 'query' : 'history'}-${lang}.png`
      await download.saveAs(saved)
      const bytes = readFileSync(saved)
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG')
      assert.equal(bytes.readUInt32BE(16), 720)
      assert.ok(bytes.readUInt32BE(20) > 1000)
      const digest = createHash('sha256').update(bytes).digest('hex')
      await modal.getByRole('button', { name: copy.share, exact: true }).click()
      await expect(modal.getByRole('status')).toHaveText(copy.shared)
      await expect.poll(() => page.evaluate(() => (window as any).imageTest.digest)).toBe(digest)
      assert.equal(await page.evaluate(() => (window as any).imageTest.active), true, 'native share retains actual click activation')
      assert.equal(await page.evaluate(() => (window as any).imageTest.fileName), download.suggestedFilename())
      await modal.screenshot({ path: `${output}/preview-${lang}.png` })
      const oldUrl = await modal.getByRole('img').getAttribute('src')
      await modal.getByRole('button', { name: copy.close, exact: true }).click()
      await expect(modal).toHaveCount(0)
      assert.ok(await page.evaluate((url) => (window as any).imageTest.revoked.includes(url), oldUrl))
    }
    assert.equal(downloads.length, 3, 'only three explicit saves occurred')
    await page.evaluate(() => localStorage.setItem('lang', 'zh')); await page.reload()
    await page.getByRole('button', { name: /2026-09-08 ·/ }).click()
    const generate = () => page.getByRole('button', { name: IMAGE_COPY.zh.generate, exact: true }).click()
    const close = () => modal.getByRole('button', { name: IMAGE_COPY.zh.close, exact: true }).click()
    const mode = (value: string) => page.evaluate((value) => { (window as any).imageTest.mode = value }, value)
    const share = () => modal.getByRole('button', { name: IMAGE_COPY.zh.share, exact: true }).click()
    await generate(); await expect(modal.getByRole('img')).toBeVisible()
    await mode('cancel'); await share(); await expect(modal.getByRole('status')).toHaveText(IMAGE_COPY.zh.cancelled)
    await mode('fail'); await share(); await expect(modal.getByRole('alert')).toHaveText(IMAGE_COPY.zh.shareFailed)
    await expect(modal.getByRole('button', { name: IMAGE_COPY.zh.share, exact: true })).toBeEnabled()
    // Pending native UI is bounded, but never duplicated even after its deadline.
    await page.clock.install()
    await mode('pending')
    const priorShares = await page.evaluate(() => (window as any).imageTest.shares)
    await modal.getByRole('button', { name: IMAGE_COPY.zh.share, exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
    await expect(modal.getByRole('status')).toHaveText(IMAGE_COPY.zh.sharing)
    await page.clock.fastForward(30_001)
    await expect(modal.getByRole('alert')).toHaveText(IMAGE_COPY.zh.sharePending)
    await share()
    assert.equal(await page.evaluate(() => (window as any).imageTest.shares), priorShares + 1)
    await page.evaluate(() => (window as any).imageTest.resolveShare())
    await mode('success'); await share(); await expect(modal.getByRole('status')).toHaveText(IMAGE_COPY.zh.shared)
    await close()
    // A browser without native file sharing still has preview and explicit save.
    await mode('unsupported'); await generate(); await expect(modal.getByRole('img')).toBeVisible()
    await expect(modal.getByRole('button', { name: IMAGE_COPY.zh.share, exact: true })).toHaveCount(0)
    await expect(modal.getByText(IMAGE_COPY.zh.unavailable)).toBeVisible()
    await close()
    // Renderer failure must not leave busy stuck or export an empty PNG.
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.toBlob
      HTMLCanvasElement.prototype.toBlob = function (callback) { HTMLCanvasElement.prototype.toBlob = original; callback(null) }
    })
    await generate(); await expect(modal.getByRole('alert')).toHaveText(IMAGE_COPY.zh.failed)
    await expect(modal.getByRole('button', { name: IMAGE_COPY.zh.generate, exact: true })).toBeEnabled()
    await close()
    // Delayed fonts: cancel and retry. Old work cannot publish into the new modal.
    async function holdFonts() {
      await page.evaluate(() => {
        let release!: () => void
        const pending = new Promise<void>((resolve) => { release = resolve })
        Object.defineProperty(document.fonts, 'ready', { configurable: true, get: () => pending })
        ;(window as any).releaseFonts = () => { Reflect.deleteProperty(document.fonts, 'ready'); release() }
      })
    }
    await holdFonts(); await generate(); await expect(modal.getByRole('status')).toHaveText(IMAGE_COPY.zh.generating)
    await close(); await page.evaluate(() => (window as any).releaseFonts())
    await generate(); await expect(modal.getByRole('img')).toBeVisible(); await close()
    await holdFonts(); await generate(); await expect(modal.getByRole('status')).toHaveText(IMAGE_COPY.zh.generating)
    await page.clock.fastForward(15_001)
    await expect(modal.getByRole('alert')).toHaveText(IMAGE_COPY.zh.timeout)
    await expect(modal.getByRole('button', { name: IMAGE_COPY.zh.generate, exact: true })).toBeEnabled()
    await page.evaluate(() => (window as any).releaseFonts())
    await expect(modal.getByRole('img')).toHaveCount(0)
    await close()
    // Preserve other render jobs while cleaning this invocation's clone even
    // when html2canvas itself fails before it returns its canvas.
    await page.evaluate(() => {
      const other = document.createElement('iframe')
      other.id = 'other-capture'; other.className = 'html2canvas-container'
      other.setAttribute('data-html2canvas-ignore', 'true'); other.style.display = 'none'
      document.body.appendChild(other)
    })
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => {
        const original = HTMLCanvasElement.prototype.getContext
        HTMLCanvasElement.prototype.getContext = function (...args: any[]): any {
          if (this.width >= 360 && this.height > 1000) {
            HTMLCanvasElement.prototype.getContext = original
            ;(window as any).failedCanvas = this
            throw new Error('simulated renderer allocation failure')
          }
          return (original as any).apply(this, args)
        }
      })
      await generate(); await expect(modal.getByRole('alert')).toHaveText(IMAGE_COPY.zh.failed)
      await expect(page.locator('iframe.html2canvas-container')).toHaveCount(1)
      assert.ok(await page.evaluate(() => (window as any).failedCanvas.width === 0 && (window as any).failedCanvas.height === 0))
      await close()
    }
    // Stall inside the cloned document, after its iframe has been created.
    async function holdCloneFonts() {
      await page.evaluate(() => {
        const append = document.body.appendChild
        document.body.appendChild = function <T extends Node>(node: T): T {
          const appended = append.call(this, node) as T
          if (node instanceof HTMLIFrameElement && node.className === 'html2canvas-container') {
            document.body.appendChild = append
            const cloned = node.contentDocument!
            const closeDocument = cloned.close.bind(cloned)
            cloned.close = () => {
              closeDocument()
              let resolve!: () => void
              const ready = new Promise<void>((done) => { resolve = done })
              Object.defineProperty(cloned.fonts, 'ready', { configurable: true, get: () => ready })
              ;(window as any).releaseClone = () => { Reflect.deleteProperty(cloned.fonts, 'ready'); resolve() }
            }
          }
          return appended
        }
      })
    }
    for (const boundary of ['timeout', 'cancel']) {
      await holdCloneFonts(); await generate()
      await expect(page.locator('iframe.html2canvas-container')).toHaveCount(2)
      if (boundary === 'timeout') {
        await page.clock.fastForward(15_001)
        await expect(modal.getByRole('alert')).toHaveText(IMAGE_COPY.zh.timeout)
      } else await close()
      await expect(page.locator('iframe.html2canvas-container')).toHaveCount(1)
      await expect(page.locator('#other-capture')).toHaveCount(1)
      await page.evaluate(() => (window as any).releaseClone())
      if (boundary === 'timeout') { await expect(modal.getByRole('img')).toHaveCount(0); await close() }
    }
    await page.locator('#other-capture').evaluate((node) => node.remove())
    await generate(); await expect(modal.getByRole('img')).toBeVisible()
    await expect(page.locator('iframe.html2canvas-container')).toHaveCount(0)
    await close()
    // The supported 100-product selection still fits with adaptive resolution.
    queryResult = { ...result, rows: Array.from({ length: 100 }, (_, i) => ({ ...result.rows[0], productId: `normal${i}`, name: `商品 ${i} កាហ្វេ Coffee` })) }
    await page.getByRole('checkbox', { name: /Iced coffee/ }).check()
    await page.getByRole('button', { name: COPY.zh.query, exact: true }).click()
    await generate(); await expect(modal.getByRole('img')).toBeVisible({ timeout: 20000 })
    await expect(page.locator('[data-report-image-row]')).toHaveCount(100)
    assert.ok(await modal.getByRole('img').evaluate((node: HTMLImageElement) => node.naturalHeight > 10000 && node.naturalWidth >= 360))
    await close()
    // Oversized content is explicitly rejected, with no silent missing rows.
    queryResult = { ...result, rows: Array.from({ length: 100 }, (_, i) => ({ ...result.rows[0], productId: `long${i}`, name: '中文 កាហ្វេ English '.repeat(100) })) }
    await page.getByRole('checkbox', { name: /Iced coffee/ }).check()
    await page.getByRole('button', { name: COPY.zh.query, exact: true }).click()
    await generate(); await expect(modal.getByRole('alert')).toHaveText(IMAGE_COPY.zh.large)
    await close()
    queryResult = result
    await page.getByRole('button', { name: COPY.zh.query, exact: true }).click()
    await generate(); await expect(modal.getByRole('img')).toBeVisible()
    const lastUrl = await modal.getByRole('img').getAttribute('src')
    await close()
    await page.getByRole('button', { name: /2026-09-08 ·/ }).click()
    await generate(); await expect(modal.getByRole('img')).toBeVisible()
    assert.notEqual(await modal.getByRole('img').getAttribute('src'), lastUrl)
    await expect(page.locator('[data-report-image-card]')).toContainText('重点商品 ក្រុមកាហ្វេ')
    await close()
    assert.equal(writes, 0, 'image paths never write or send print jobs')
    assert.equal(queryCount, 4, 'image generation never refetches or recalculates sales')
    assert.equal(downloads.length, 3, 'cancel, failures and timeouts never auto-download')
    assert.deepEqual(errors, [])
    console.log('PASS: query/history PNG, mobile zh/en/km, exact downloaded/shared bytes, activation, cancellation, errors, deadlines, repeated clicks, stale work, URL/owned canvas/clone cleanup, other capture isolation and no writes')
  } finally { await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
