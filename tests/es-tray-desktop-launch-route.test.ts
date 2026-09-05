import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium, type Browser, type Route } from 'playwright'

const launchPage = fs.readFileSync('app/cashier/launch/page.tsx', 'utf8')
const consumeRoute = fs.readFileSync(
  'app/api/computer-client/browser-launch/consume/route.ts',
  'utf8',
)
const desktopPosPage = fs.readFileSync('app/desktop/pos/page.tsx', 'utf8')
const deviceClient = fs.readFileSync('lib/es-tray-device-client.ts', 'utf8')
const cashierPage = fs.readFileSync('app/cashier/page.tsx', 'utf8')
const browserCashierUrl = fs.readFileSync('app/home/computer-console-url.ts', 'utf8')

const runtimeBaseUrl = process.env.A12_LAUNCH_RUNTIME_BASE_URL?.replace(/\/$/, '')
const chromePath = process.env.A12_LAUNCH_CHROME_PATH?.trim()
const storeCode = 'ST169E7000'
const orderNo = 'ORDER-A12-2-001'

let cases = 0
async function test(name: string, run: () => void | Promise<void>) {
  await run()
  cases += 1
  console.log(`PASS ${name}`)
}

function jsonRoute(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function openRejectedLaunch(browser: Browser, status: number, error: string) {
  const page = await browser.newPage()
  let consumeCount = 0
  await page.route('**/api/computer-client/browser-launch/consume', async (route) => {
    consumeCount += 1
    await jsonRoute(route, { error }, status)
  })
  await page.goto(`${runtimeBaseUrl}/cashier/launch#ticket=rejected-ticket`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await page.waitForTimeout(200)
  const result = {
    consumeCount,
    pathname: new URL(page.url()).pathname,
    redirectedToDevicePos: new URL(page.url()).pathname === '/desktop/pos',
  }
  await page.close()
  return result
}

async function runValidLaunch(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const observed: Array<{ method: string; pathname: string; headers: Record<string, string> }> = []
  let consumeBody: Record<string, unknown> | null = null
  const now = new Date().toISOString()

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return
    observed.push({
      method: request.method(),
      pathname: url.pathname,
      headers: request.headers(),
    })
  })

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/api/computer-client/browser-launch/consume') {
      consumeBody = request.postDataJSON() as Record<string, unknown>
      return jsonRoute(route, { storeCode, posDeviceToken: 'runtime-browser-pos-session' })
    }
    if (url.pathname === '/api/cashier/store') {
      return jsonRoute(route, {
        storeName: 'A12 Store',
        storeId: 'store-a12',
        tenantId: 'tenant-a12',
        currencyCode: 'USD',
        products: [],
        categories: [],
        printKitchenTicket: false,
      })
    }
    if (url.pathname === '/api/records') {
      return jsonRoute(route, {
        items: [{
          recordNo: 'REC-A12-001',
          orderNo,
          createdAt: now,
          paymentMethod: 'CASH',
          status: 'COMPLETED',
          lineAmount: 1,
          quantity: 1,
          unitPrice: 1,
          productNameSnapshot: 'Runtime item',
          specSnapshot: '',
        }],
      })
    }
    if (url.pathname === '/api/es-tray-02/device/config') {
      return jsonRoute(route, { fieldOnly: true, enabled: true })
    }
    if (url.pathname === `/api/es-tray-02/device/orders/${orderNo}`) {
      return jsonRoute(route, {
        orderNo,
        createdAt: now,
        paymentMethod: 'CASH',
        paymentStatus: 'PAID',
        saleStatus: 'COMPLETED',
        totalAmount: 1,
        currencyCode: 'USD',
        items: [],
      })
    }
    if (url.pathname === '/api/cashier/orders') return jsonRoute(route, { orders: [] })
    if (url.pathname === '/api/cashier/pending-orders') return jsonRoute(route, { orders: [] })
    return jsonRoute(route, {})
  })

  await page.goto(`${runtimeBaseUrl}/cashier/launch?storeCode=ATTACKER#ticket=valid-ticket`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await page.waitForURL(/\/desktop\/pos\?/, { timeout: 30_000 })
  const redirect = new URL(page.url())
  const storedToken = await page.evaluate((code) => (
    localStorage.getItem(`cashier:posDeviceToken:${code}`)
  ), storeCode)

  const recordsButton = page.getByRole('button', {
    name: /Sales records|销售记录|កំណត់ត្រាលក់/,
  }).first()
  await recordsButton.waitFor({ timeout: 30_000 })
  await recordsButton.click()
  const orderButton = page.getByRole('button').filter({ hasText: orderNo }).first()
  await orderButton.waitFor({ timeout: 30_000 })
  const configRequest = page.waitForRequest((request) => (
    new URL(request.url()).pathname === '/api/es-tray-02/device/config'
  ))
  const orderRequest = page.waitForRequest((request) => (
    new URL(request.url()).pathname === `/api/es-tray-02/device/orders/${orderNo}`
  ))
  await orderButton.click()
  await Promise.all([configRequest, orderRequest])
  await page.waitForTimeout(200)
  const bodyText = await page.locator('body').innerText()
  await page.close()

  return { redirect, storedToken, consumeBody, observed, bodyText }
}

async function main() {
  await test('official Desktop launch reads the one-time ticket only from the URL fragment', () => {
    assert.match(launchPage, /window\.location\.hash/)
    assert.match(launchPage, /fragment\.get\('ticket'\)/)
  })

  await test('the fragment is removed before ticket validation or network use', () => {
    const clearIndex = launchPage.indexOf("window.history.replaceState(null, '', '/cashier/launch')")
    const fetchIndex = launchPage.indexOf("fetch('/api/computer-client/browser-launch/consume'")
    assert.ok(clearIndex > -1 && fetchIndex > clearIndex)
  })

  await test('the launch page still consumes through the existing BrowserPosDevice endpoint', () => {
    assert.match(launchPage, /fetch\('\/api\/computer-client\/browser-launch\/consume'/)
    assert.match(launchPage, /method: 'POST'/)
  })

  await test('consume success must supply both storeCode and posDeviceToken', () => {
    assert.match(launchPage, /typeof body\?\.storeCode !== 'string'/)
    assert.match(launchPage, /typeof body\?\.posDeviceToken !== 'string'/)
  })

  await test('redirect store context comes from the server-validated binding response', () => {
    assert.match(consumeRoute, /storeCode: binding\.store\.code/)
    assert.match(launchPage, /new URLSearchParams\(\{ storeCode: body\.storeCode, mode: 'pos' \}\)/)
    assert.doesNotMatch(launchPage, /location\.search[\s\S]*get\(['"]storeCode/)
  })

  await test('URLSearchParams provides encoded store context and mode=pos', () => {
    const params = new URLSearchParams({ storeCode: 'STORE A/&', mode: 'pos' })
    assert.equal(params.toString(), 'storeCode=STORE+A%2F%26&mode=pos')
  })

  await test('the launch page exposes neither deviceSecret nor an OWNER-session dependency', () => {
    assert.doesNotMatch(launchPage, /deviceSecret|x-installation-id|OWNER|apiFetch/i)
    assert.doesNotMatch(consumeRoute, /claimSecret|deviceSecret/)
  })

  await test('the existing non-device browser cashier entry remains /cashier', () => {
    assert.match(browserCashierUrl, /publicUrl\(`\/cashier\?\$\{params\.toString\(\)\}`\)/)
    assert.doesNotMatch(browserCashierUrl, /\/desktop\/pos/)
  })

  await test('mobile and OWNER navigation are not introduced into the device launch page', () => {
    assert.doesNotMatch(launchPage, /\/m\/|\/home|\/records|Telegram/)
  })

  await test('the target Desktop page still selects POS mode from mode=pos', () => {
    assert.match(desktopPosPage, /params\.get\('mode'\) === 'pos'/)
    assert.match(desktopPosPage, /mode === 'pos'[\s\S]*<CashierPage \/>/)
  })

  await test('device runtime detection remains exact to /desktop/pos', () => {
    assert.match(deviceClient, /window\.location\.pathname === '\/desktop\/pos'/)
  })

  await test('the reused order detail still selects the device order endpoint in Desktop POS', () => {
    assert.match(deviceClient, /`\/api\/es-tray-02\/device\/orders\/\$\{encodeURIComponent\(orderNo\)\}`/)
    assert.match(cashierPage, /<OrderDetailSheet[\s\S]*orderNo=\{selectedDesktopRecordOrderNo\}/)
  })

  assert.ok(runtimeBaseUrl, 'A12_LAUNCH_RUNTIME_BASE_URL is required')
  const browser = await chromium.launch({
    headless: true,
    ...(chromePath ? { executablePath: chromePath } : {}),
  })
  try {
    await test('missing ticket does not consume or enter Desktop POS', async () => {
      const page = await browser.newPage()
      let consumeCount = 0
      await page.route('**/api/computer-client/browser-launch/consume', async (route) => {
        consumeCount += 1
        await jsonRoute(route, {})
      })
      await page.goto(`${runtimeBaseUrl}/cashier/launch`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(200)
      assert.equal(consumeCount, 0)
      assert.equal(new URL(page.url()).pathname, '/cashier/launch')
      await page.close()
    })

    await test('invalid or expired ticket cannot enter Desktop POS', async () => {
      const result = await openRejectedLaunch(browser, 409, 'LAUNCH_TICKET_INVALID_OR_EXPIRED')
      assert.equal(result.consumeCount, 1)
      assert.equal(result.pathname, '/cashier/launch')
      assert.equal(result.redirectedToDevicePos, false)
    })

    await test('revoked or unavailable binding cannot enter Desktop POS', async () => {
      const result = await openRejectedLaunch(browser, 409, 'COMPUTER_NOT_BOUND')
      assert.equal(result.consumeCount, 1)
      assert.equal(result.pathname, '/cashier/launch')
      assert.equal(result.redirectedToDevicePos, false)
    })

    const runtime = await runValidLaunch(browser)

    await test('valid official launch reaches the exact server-scoped Desktop POS URL', () => {
      assert.equal(runtime.redirect.pathname, '/desktop/pos')
      assert.equal(runtime.redirect.searchParams.get('storeCode'), storeCode)
      assert.equal(runtime.redirect.searchParams.get('mode'), 'pos')
      assert.notEqual(runtime.redirect.searchParams.get('storeCode'), 'ATTACKER')
    })

    await test('valid launch preserves the delegated BrowserPosDevice session without URL exposure', () => {
      assert.equal(runtime.storedToken, 'runtime-browser-pos-session')
      assert.equal(runtime.redirect.href.includes('runtime-browser-pos-session'), false)
      assert.deepEqual(Object.keys(runtime.consumeBody ?? {}).sort(), ['browserDeviceId', 'ticket'])
    })

    await test('sales-record selection triggers device config and scoped order detail', () => {
      assert.ok(runtime.observed.some((request) => request.pathname === '/api/es-tray-02/device/config'))
      assert.ok(runtime.observed.some((request) => request.pathname === `/api/es-tray-02/device/orders/${orderNo}`))
    })

    await test('device order detail carries delegated headers and loads successfully', () => {
      const request = runtime.observed.find((entry) => entry.pathname === `/api/es-tray-02/device/orders/${orderNo}`)
      assert.ok(request?.headers['x-pos-device-id'])
      assert.ok(request?.headers['x-pos-device-token'])
      assert.equal(request?.headers['x-lightops-client'], 'desktop-pos')
      assert.ok(runtime.bodyText.includes(orderNo))
      assert.doesNotMatch(runtime.bodyText, /订单详情加载失败|Failed to load order details/)
    })

    await test('runtime verification creates no print job', () => {
      assert.equal(runtime.observed.some((request) => request.pathname.includes('/print-jobs')), false)
    })
  } finally {
    await browser.close()
  }

  console.log(`es-tray Desktop launch route tests passed (${cases} cases)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
