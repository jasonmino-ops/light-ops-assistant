import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium, expect } from '@playwright/test'
import { signSession } from '../lib/session'
import { reportRange } from '../lib/product-sales/dates'
import type { GroupView, ProductSalesResult } from '../lib/product-sales/contract'
import { parsePrintRequest, type EshopTrayPrintRequest } from '../lib/es-tray-relay/contract'

// Run against a local built app. APIs use fixtures; real UI and printing helper run
// in Chromium. Only the native print dialog is replaced so no paper is consumed.
const base = process.env.PRODUCT_SALES_UI_BASE_URL ?? 'http://127.0.0.1:3107'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'local server only')
const now = new Date('2026-09-09T12:00:00+07:00')
const stores = [{ tenantId: 'ta', storeId: 'sa', storeName: '金边一店', currencyCode: 'USD' }, { tenantId: 'tb', storeId: 'sb', storeName: '金边二店', currencyCode: 'USD' }]
const products = [{ tenantId: 'ta', productId: 'p1', name: '咖啡', barcode: '100', status: 'ACTIVE' }, { tenantId: 'tb', productId: 'p2', name: '茶 <script>bad()</script>', barcode: '200', status: 'ACTIVE' }]
const result: ProductSalesResult = {
  range: reportRange({ period: 'TODAY' }, now), generatedAt: now.toISOString(), stores,
  rows: products.map((p, i) => ({ ...p, storeId: stores[i].storeId, quantity: '1.00', salesAmount: i ? '20.00' : '10.00', refundAmount: '0.00' })),
  totals: [{ currencyCode: 'USD', quantity: '2.00', salesAmount: '30.00', refundAmount: '0.00' }], unidentifiedSales: 0, unidentifiedRefunds: 0,
}
async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await context.addCookies([{ name: 'auth-session', value: signSession({ tenantId: 'ta', storeId: 'sa', userId: 'owner', role: 'OWNER' }), url: base }])
    await context.addInitScript(() => { localStorage.setItem('lang', 'zh') })
    let saved: GroupView[] = [{ id: 'revoked', name: '撤权单店组', enabled: true, selection: { storeId: 'revoked-store', products: [{ tenantId: 'old', productId: 'old-product' }] }, createdAt: now.toISOString(), updatedAt: now.toISOString() }]
    let failOptions = false
    const queryBodies: any[] = []
    let writes = 0
    let relayEnabled = false
    let failRelay = true
    const printRequests: EshopTrayPrintRequest[] = []
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== new URL(base).origin) return route.fulfill({ status: 200, contentType: url.hostname.includes('fonts') ? 'text/css' : 'application/javascript', body: '' })
      if (!url.pathname.startsWith('/api/')) return route.continue()
      let data: unknown = {}; let status = 200
      const path = url.pathname.replace('/api/owner/product-sales', '')
      if (url.pathname === '/api/auth/status') data = { ok: true }
      else if (url.pathname === '/api/me') data = { role: 'OWNER', storeId: 'sa', tenantId: 'ta' }
      else if (url.pathname === '/api/es-tray-02/config') data = { fieldOnly: true, enabled: relayEnabled }
      else if (url.pathname === '/api/es-tray-02/print-jobs') {
        const payload = parsePrintRequest(route.request().postDataJSON())
        printRequests.push(payload)
        if (failRelay) { status = 503; data = { error: 'TEST_RESPONSE_UNCERTAIN' } }
        else { status = 202; data = { fieldOnly: true, productionContract: true, schemaVersion: 1, jobId: 'report-print', requestId: payload.requestId, status: 'PENDING_RECEIVE', created: false } }
      }
      else if (path === '/options') {
        if (url.searchParams.get('storeId') === 'revoked-store') { status = 403; data = { error: 'STORE_ACCESS_DENIED' } }
        else if (failOptions) { failOptions = false; status = 500; data = { error: 'INTERNAL_ERROR' } }
        else data = { stores, products: products.filter((p) => !url.searchParams.get('storeId') || stores.some((s) => s.storeId === url.searchParams.get('storeId') && s.tenantId === p.tenantId)), today: '2026-09-09', nextCursor: null }
      } else if (path === '/query') {
        const body = route.request().postDataJSON(); queryBodies.push(body)
        if (body.storeId === 'revoked-store') { status = 403; data = { error: 'STORE_ACCESS_DENIED' } }
        else data = { ...result, range: reportRange(body, now) }
      } else if (path === '/groups' && route.request().method() === 'GET') data = saved
      else if (path === '/groups' || path.startsWith('/groups/')) {
        writes++
        const body = route.request().postDataJSON()
        const old = saved.find((group) => path === `/groups/${group.id}`)
        const group = { ...old, ...body, createdAt: old?.createdAt ?? now.toISOString(), updatedAt: new Date(now.getTime() + writes).toISOString() } as GroupView
        saved = [group, ...saved.filter((item) => item.id !== group.id)]; data = group
      } else if (path === '/reports') data = { reports: [{ id: 'history-1', groupId: 'group', reportDate: '2026-09-08', generatedAt: now.toISOString(), name: '昨日固定组' }], nextCursor: null }
      else if (path === '/reports/history-1') data = { result: { ...result, groupName: '昨日固定组', range: reportRange({ period: 'YESTERDAY' }, now) } }
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}/product-sales`)
    await expect(page.getByRole('heading', { name: '商品销售查询', exact: true })).toBeVisible()
    await page.getByRole('checkbox', { name: /咖啡/ }).check()
    await page.getByRole('checkbox', { name: /茶/ }).check()
    await page.getByRole('button', { name: '自定义', exact: true }).click()
    await page.getByLabel('开始日期').fill('2026-09-08')
    await page.getByLabel('结束日期').fill('2026-09-09')
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await expect(page.locator('strong').filter({ hasText: /^30\.00$/ })).toBeVisible()
    assert.equal(queryBodies.at(-1).products.length, 2)
    assert.equal(queryBodies.at(-1).dateFrom, '2026-09-08')
    await page.getByLabel('商品组名称').fill('重点商品')
    await page.getByRole('button', { name: '保存新组', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('商品组已保存。')
    assert.equal(writes, 1)
    await page.getByRole('button', { name: '重点商品', exact: true }).click()
    await expect(page.locator('table tbody tr')).toHaveCount(2)
    await page.getByLabel('商品组名称').fill('重点商品调整')
    await page.getByRole('button', { name: '更新商品组', exact: true }).click()
    await expect(page.getByRole('button', { name: '重点商品调整', exact: true })).toBeVisible()

    // Use the real openExistingBrowserPrint popup path. Patch just native print.
    await page.evaluate(() => {
      const nativeOpen = window.open.bind(window)
      window.open = (...args) => {
        const popup = nativeOpen(...args)
        if (popup) popup.print = () => { popup.document.body.dataset.printCalled = 'yes' }
        return popup
      }
    })
    const popupPromise = page.waitForEvent('popup')
    await page.getByRole('button', { name: '打印', exact: true }).click()
    const popup = await popupPromise
    await expect(popup.locator('body')).toHaveAttribute('data-print-called', 'yes')
    await expect(popup.locator('.total-value')).toHaveText('30.00')
    await expect(popup.locator('tbody script')).toHaveCount(0)
    await popup.close()

    // History print through real popup-block fallback; dispatch afterprint cleanup.
    await page.getByRole('button', { name: '2026-09-08 · 昨日固定组 ›', exact: true }).click()
    await expect(page.getByRole('heading', { name: '昨日固定组', exact: true })).toBeVisible()
    await page.evaluate(() => {
      window.open = () => null
      window.print = () => { document.body.dataset.printCalled = 'yes' }
    })
    await page.getByRole('button', { name: '打印', exact: true }).click()
    await expect(page.locator('body')).toHaveAttribute('data-print-called', 'yes')
    await expect(page.locator('#__oprint .total-value')).toHaveText('30.00')
    await page.evaluate(() => { window.dispatchEvent(new Event('afterprint')) })
    await expect(page.locator('#__oprint')).toHaveCount(0)

    // The same Production receipt capability runs with the real HTML renderer.
    // Only its remote enqueue response is replaced; no physical job is created.
    relayEnabled = true
    await page.reload()
    await page.getByRole('button', { name: '重点商品调整', exact: true }).click()
    await expect(page.locator('table tbody tr')).toHaveCount(2)
    await expect(page.getByText(/实时结果（未结日），截至: 2026-09-09 12:00:00/)).toBeVisible()
    await expect(page.getByText(/2026-09-09 00:00:00 → 2026-09-09 12:00:00/)).toBeVisible()
    assert.equal(printRequests.length, 0, 'loading and querying never send print jobs')
    await page.getByRole('button', { name: '打印', exact: true }).click()
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('打印未能确认发送，请检查现有打印服务后重试。')
    assert.equal(printRequests.length, 1)
    assert.ok(printRequests[0].commandStream.byteLength > 10_000, 'complete report renders into a substantial receipt stream')
    assert.match(printRequests[0].orderNo, /^product-sales-report:[a-f0-9]{64}$/)
    assert.equal('storeId' in printRequests[0], false, 'all-store report does not override the active OWNER print target')
    failRelay = false
    await page.getByRole('button', { name: '打印', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('报表已发送，请在打印机确认出纸。')
    assert.deepEqual(printRequests[1], printRequests[0], 'UI retry reuses exact rendered bytes and request identity')
    await page.getByRole('button', { name: '2026-09-08 · 昨日固定组 ›', exact: true }).click()
    await expect(page.getByText('完整历史时段', { exact: true })).toBeVisible()
    await expect(page.getByRole('status')).toHaveCount(0, { timeout: 5000 })
    assert.equal(printRequests.length, 2, 'opening history neither prints nor retains the prior report send status')
    await page.getByRole('button', { name: '打印', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('报表已发送，请在打印机确认出纸。')
    assert.equal(printRequests.length, 3)
    assert.notEqual(printRequests[2].orderNo, printRequests[1].orderNo, 'history prints its own result document')

    // A saved single-store group remains manageable after that store is revoked.
    await page.getByRole('button', { name: '撤权单店组', exact: true }).click()
    await expect(page.getByRole('button', { name: '重新加载商品', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '停用', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '停用', exact: true }).click()
    await expect(page.getByRole('button', { name: '撤权单店组 · 已停用', exact: true })).toBeVisible()
    await page.getByLabel('门店范围').selectOption('')
    await expect(page.getByRole('checkbox', { name: /咖啡/ })).toBeEnabled()
    // A temporary options error has an explicit recovery action.
    failOptions = true
    await page.getByRole('searchbox').fill('咖啡')
    await page.getByRole('button', { name: '重新加载商品', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: /咖啡/ })).toBeEnabled()
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: '重点商品调整', exact: true }).click()
    await expect(page.locator('table tbody tr')).toHaveCount(2)
    mkdirSync('.task-state', { recursive: true })
    await page.screenshot({ path: '.task-state/product-sales-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByLabel('门店范围')).toBeVisible()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile page has no horizontal overflow')
    await page.screenshot({ path: '.task-state/product-sales-mobile.png', fullPage: true })
    assert.deepEqual(errors, [], 'no uncaught browser errors')
    await context.close()
    console.log('product sales browser passed: live cutoff, groups/history, existing OWNER receipt render/send/retry, browser fallback, revoked store recovery and desktop/mobile')
  } finally { await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
