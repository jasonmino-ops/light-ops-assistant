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
const managementName = /Management center|管理中心|មជ្ឈមណ្ឌលគ្រប់គ្រង/i

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
  const pageErrors: string[] = []
  page.on('pageerror', (pageError) => pageErrors.push(pageError.message))
  await page.route('**/api/computer-client/browser-launch/consume', async (route) => {
    consumeCount += 1
    await jsonRoute(route, { error }, status)
  })
  const consumeRequestObserved = page.waitForRequest((request) => (
    new URL(request.url()).pathname === '/api/computer-client/browser-launch/consume'
  ))
  await page.goto(`${runtimeBaseUrl}/cashier/launch#ticket=rejected-ticket`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await consumeRequestObserved
  await page.locator('section[aria-live="polite"]').filter({ hasText: '⚠️' }).waitFor({
    state: 'visible',
    timeout: 30_000,
  })
  const result = {
    consumeCount,
    pathname: new URL(page.url()).pathname,
    redirectedToDevicePos: new URL(page.url()).pathname === '/desktop/pos',
    pageErrors,
  }
  await page.close()
  return result
}

async function runValidLaunch(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const observed: Array<{ method: string; pathname: string; url: string; headers: Record<string, string> }> = []
  let consumeBody: Record<string, unknown> | null = null
  let consumeCount = 0
  let releaseAccess!: () => void
  const accessGate = new Promise<void>(resolve => { releaseAccess = resolve })
  const accessObserved = page.waitForRequest(request => new URL(request.url()).pathname === '/api/cashier/access')
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.addInitScript(() => {
    Object.assign(window, { __unexpectedPrints: 0 })
    window.print = () => { (window as unknown as { __unexpectedPrints: number }).__unexpectedPrints++ }
  })

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return
    observed.push({
      method: request.method(),
      pathname: url.pathname,
      url: request.url(),
      headers: request.headers(),
    })
  })

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/api/computer-client/browser-launch/consume') {
      consumeCount++
      consumeBody = request.postDataJSON() as Record<string, unknown>
      return jsonRoute(route, { storeCode, posDeviceToken: 'runtime-browser-pos-session' })
    }
    if (url.pathname === '/api/cashier/access') {
      await accessGate
      const headers = request.headers()
      assert.equal(url.searchParams.get('storeCode'), storeCode)
      assert.equal(headers['x-pos-device-token'], 'runtime-browser-pos-session')
      assert.equal(headers['x-pos-device-id'], consumeBody?.browserDeviceId)
      return jsonRoute(route, { ok: true })
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
    if (url.pathname === '/api/cashier/orders') return jsonRoute(route, { orders: [] })
    if (url.pathname === '/api/cashier/pending-orders') return jsonRoute(route, { orders: [] })
    return jsonRoute(route, {})
  })

  try {
  await page.goto(`${runtimeBaseUrl}/cashier/launch?storeCode=ATTACKER#ticket=valid-ticket&redirect=https://attacker.invalid&host=10.1.2.3&port=9100`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await page.waitForURL(/\/desktop\/pos\?/, { timeout: 30_000 })
  await accessObserved
  await page.locator('main[aria-busy="true"]').waitFor({ state: 'visible' })
  assert.equal(await page.getByRole('button', { name: managementName }).count(), 0,
    'public store data alone must not establish authorization')
  releaseAccess()
  const redirect = new URL(page.url())
  const storedToken = await page.evaluate((code) => (
    localStorage.getItem(`cashier:posDeviceToken:${code}`)
  ), storeCode)

  const management = page.getByRole('button', { name: managementName })
  await management.waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(await page.evaluate(() => (window as unknown as { __unexpectedPrints: number }).__unexpectedPrints), 0)
  if (process.env.A12_LAUNCH_EVIDENCE_DIR) await page.screenshot({ path: `${process.env.A12_LAUNCH_EVIDENCE_DIR}/authorized-desktop.png` })
  await management.click()
  await page.waitForURL(url => url.pathname === '/management')
  const managementUrl = new URL(page.url())
  assert.equal(await page.evaluate(() => (window as unknown as { __unexpectedPrints: number }).__unexpectedPrints), 0)
  assert.deepEqual(pageErrors, [])
  return { redirect, storedToken, consumeBody: consumeBody as Record<string, unknown> | null, consumeCount, observed, managementUrl }
  } finally {
    releaseAccess()
    await page.close()
  }
}

async function rejectAccessAfterConsume(browser: Browser, status: 401 | 403) {
  const page = await browser.newPage()
  let consumes = 0
  let accesses = 0
  try {
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/computer-client/browser-launch/consume') {
        consumes++
        return jsonRoute(route, { storeCode, posDeviceToken: 'explicitly-denied-session' })
      }
      if (url.pathname === '/api/cashier/access') {
        accesses++
        assert.equal(url.searchParams.get('storeCode'), storeCode)
        assert.equal(route.request().headers()['x-pos-device-token'], 'explicitly-denied-session')
        return jsonRoute(route, { error: 'DEVICE_ACCESS_DENIED' }, status)
      }
      if (url.pathname === '/api/cashier/store') return jsonRoute(route, { storeName: 'Public is not authorization', products: [], categories: [] })
      return jsonRoute(route, {})
    })
    await page.goto(`${runtimeBaseUrl}/cashier/launch#ticket=valid-but-revoked-session`)
    await page.waitForURL(/\/desktop\/pos\?/)
    await page.waitForFunction(code => !localStorage.getItem(`cashier:posDeviceToken:${code}`), storeCode)
    assert.equal(consumes, 1)
    assert.equal(accesses, 1)
    assert.equal(await page.getByRole('button', { name: managementName }).count(), 0)
    assert.equal(new URL(page.url()).href.includes('explicitly-denied-session'), false)
  } finally { await page.close() }
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
    for (const mode of ['FRONT_ONLY', 'SHARED_PRINTER']) {
      await test(`Network ${mode} reuses the consumed binding session and opens exact cashier opt-in`, async () => {
        const page = await browser.newPage()
        let consumeBody: unknown
        await page.route('**/api/**', async route => {
          const url = new URL(route.request().url())
          if (url.pathname === '/api/computer-client/browser-launch/consume') {
            consumeBody = route.request().postDataJSON()
            return jsonRoute(route, { storeCode, posDeviceToken: 'network-runtime-session' })
          }
          if (url.pathname === '/api/cashier/store') return jsonRoute(route, { storeName: 'Network test store', products: [], categories: [] })
          return jsonRoute(route, {})
        })
        await page.goto(`${runtimeBaseUrl}/cashier/launch?storeCode=ATTACKER#ticket=network-ticket&networkPrint=v01&networkMode=${mode}&redirect=https://attacker.invalid&host=10.1.2.3&port=9100`, { waitUntil: 'domcontentloaded' })
        await page.waitForURL(url => url.pathname === '/cashier', { timeout: 30000 })
        const target = new URL(page.url())
        assert.equal(target.origin, new URL(runtimeBaseUrl!).origin)
        assert.equal(target.hash, '')
        assert.deepEqual(Object.fromEntries(target.searchParams), { storeCode, from: 'desktop', networkPrint: 'v01', networkMode: mode })
        assert.deepEqual(Object.keys(consumeBody as object).sort(), ['browserDeviceId', 'ticket'])
        assert.equal(await page.evaluate(code => localStorage.getItem(`cashier:posDeviceToken:${code}`), storeCode), 'network-runtime-session')
        assert.equal(target.href.includes('network-runtime-session'), false)
        await page.close()
      })
    }
    for (const options of ['networkPrint=v01&networkMode=DUAL_PRINTER', 'networkPrint=v01', 'networkMode=FRONT_ONLY', 'networkPrint=invalid&networkMode=FRONT_ONLY']) {
      await test(`invalid explicit Network options reject without auth consumption or legacy fallback: ${options}`, async () => {
        const page = await browser.newPage()
        let consumes = 0
        await page.route('**/api/computer-client/browser-launch/consume', async route => {
          consumes++; return jsonRoute(route, { storeCode, posDeviceToken: 'must-not-consume' })
        })
        await page.goto(`${runtimeBaseUrl}/cashier/launch#ticket=network-ticket&${options}`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(250)
        assert.equal(consumes, 0)
        assert.equal(new URL(page.url()).pathname, '/cashier/launch')
        assert.equal(new URL(page.url()).hash, '')
        await page.close()
      })
    }
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
      assert.deepEqual(result.pageErrors, [])
    })

    await test('revoked or unavailable binding cannot enter Desktop POS', async () => {
      const result = await openRejectedLaunch(browser, 409, 'COMPUTER_NOT_BOUND')
      assert.equal(result.consumeCount, 1)
      assert.equal(result.pathname, '/cashier/launch')
      assert.equal(result.redirectedToDevicePos, false)
      assert.deepEqual(result.pageErrors, [])
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

    await test('ticket is consumed exactly once and explicit access proof gates the supported UI', () => {
      assert.equal(runtime.consumeCount, 1)
      const accesses = runtime.observed.filter(request => request.pathname === '/api/cashier/access')
      assert.equal(accesses.length, 1)
      assert.equal(accesses[0].headers['x-pos-device-id'], runtime.consumeBody?.browserDeviceId)
      assert.equal(accesses[0].headers['x-pos-device-token'], 'runtime-browser-pos-session')
    })

    await test('authorized management navigation preserves server store binding and never exposes token', () => {
      assert.equal(runtime.managementUrl.origin, new URL(runtimeBaseUrl!).origin)
      assert.deepEqual(Object.fromEntries(runtime.managementUrl.searchParams), { from: 'desktop', storeCode })
      assert.equal(runtime.managementUrl.href.includes('runtime-browser-pos-session'), false)
      assert.equal(runtime.observed.some(request => request.url.includes('runtime-browser-pos-session')), false)
    })

    await test('runtime verification creates no print job', () => {
      assert.equal(runtime.observed.some((request) => request.pathname.includes('/print-jobs')), false)
      assert.equal(runtime.observed.some(request => /print|reprint|relay|claim/.test(request.pathname)), false)
    })
    for (const status of [401, 403] as const) await test(`explicit access ${status} after ticket consumption cannot authorize Desktop`, () => rejectAccessAfterConsume(browser, status))
  } finally {
    await browser.close()
  }

  console.log(`es-tray Desktop launch route tests passed (${cases} cases)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
