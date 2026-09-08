import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { signSession } from '../lib/session'
import * as media from '../app/api/stores/[id]/electronic-menu-media/route'
import * as banner from '../app/api/stores/[id]/banner/route'
import * as publicMedia from '../app/api/public/stores/[code]/electronic-menu-media/route'
import { GET as publicBanner } from '../app/api/public/stores/[code]/banner/route'
import { GET as display } from '../app/api/public/electronic-menu/route'
import { GET as h5 } from '../app/api/public/menu/route'

const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
const png = Buffer.from('PNG original fixture bytes')
const idContext = (id = 'a') => ({ params: Promise.resolve({ id }) })
const codeContext = (code = 'STORE-A') => ({ params: Promise.resolve({ code }) })
function req(method: string, body?: BodyInit, identity: 'OWNER' | 'STAFF' | 'NONE' = 'OWNER') {
  const headers: Record<string, string> = {}
  if (identity !== 'NONE') headers.cookie = `auth-session=${signSession({ tenantId: 'tenant-a', storeId: 'a', userId: 'user-a', role: identity })}`
  return new NextRequest('http://localhost/api/stores/a/electronic-menu-media', { method, body, headers })
}
function upload(type = 'image/gif', bytes: Uint8Array = gif) {
  const form = new FormData()
  form.append('file', new File([Uint8Array.from(bytes)], 'promotion.gif', { type }))
  return form
}

type Row = Record<string, unknown> & { id: string; code: string; tenantId: string; status: string }
type Query = { where: Record<string, unknown>; select?: Record<string, boolean>; data?: Record<string, unknown> }
async function fixture(run: (f: { rows: Row[]; writes: Query[]; reads: Query[]; failWrites: () => void; failMediaReads: () => void }) => Promise<void>) {
  const row = (id: string, tenantId: string, status = 'ACTIVE'): Row => ({
    id, code: `STORE-${id.toUpperCase()}`, tenantId, status, name: `Store ${id}`, currencyCode: 'USD',
    businessType: 'GENERAL', announcement: null, promoText: null,
    bannerData: `data:image/png;base64,${png.toString('base64')}`, bannerUrl: `/banner-${id}.png`,
    electronicMenuMediaData: null, electronicMenuMediaUrl: null,
  })
  const rows = [row('a', 'tenant-a'), row('a2', 'tenant-a'), row('b', 'tenant-b'), row('off', 'tenant-b', 'DISABLED')]
  const writes: Query[] = [], reads: Query[] = [], restore: Array<() => void> = []
  const previousMode = process.env.NODE_ENV
  Reflect.set(process.env, 'NODE_ENV', 'production')
  let fail = false, failRead = false
  function replace(target: object, name: string, value: unknown) {
    const old = Reflect.get(target, name)
    Reflect.set(target, name, value); restore.push(() => { Reflect.set(target, name, old) })
  }
  function find(args: Query) {
    reads.push(args)
    if (failRead && (args.select?.electronicMenuMediaData || args.select?.electronicMenuMediaUrl)) throw new Error('PRIVATE_MEDIA_DATABASE_DETAIL')
    const found = rows.find(r => Object.entries(args.where).every(([k, v]) => r[k] === v))
    if (!found) return null
    return args.select ? Object.fromEntries(Object.keys(args.select).map(k => [k, found[k]])) : { ...found }
  }
  replace(prisma.store, 'findFirst', async (q: Query) => find(q))
  replace(prisma.store, 'findUnique', async (q: Query) => find(q))
  replace(prisma.store, 'update', async (q: Query) => {
    if (fail) throw new Error('PRIVATE_DATABASE_DETAIL')
    assert.equal(q.where.tenantId, 'tenant-a')
    const found = rows.find(r => r.id === q.where.id && r.tenantId === q.where.tenantId)
    assert.ok(found)
    writes.push(q); Object.assign(found, q.data); return { ...found }
  })
  replace(prisma.tenant, 'findUnique', async () => ({ status: 'ACTIVE' }))
  replace(prisma.user, 'findUnique', async () => ({ status: 'ACTIVE' }))
  replace(prisma.product, 'findMany', async () => [])
  replace(prisma.productCategory, 'findMany', async () => [])
  replace(prisma, '$queryRaw', async () => [])
  try { await run({ rows, writes, reads, failWrites: () => { fail = true }, failMediaReads: () => { failRead = true } }) } finally {
    restore.reverse().forEach(f => f())
    if (previousMode === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV')
    else Reflect.set(process.env, 'NODE_ENV', previousMode)
  }
}

test('dedicated and banner upload share exact MIME/2MiB/multipart errors with no rejected writes', async () => {
  await fixture(async ({ writes }) => {
    for (const endpoint of [media, banner]) {
      for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
        assert.equal((await endpoint.POST(req('POST', upload(type)), idContext())).status, 200)
      }
      assert.equal((await endpoint.POST(req('POST', upload('image/gif', new Uint8Array(2 * 1024 * 1024))), idContext())).status, 200)
      const before = writes.length
      for (const [body, error] of [
        [upload('image/gif', new Uint8Array(2 * 1024 * 1024 + 1)), '图片不能超过 2MB'],
        [upload('image/svg+xml'), '仅支持 JPG / PNG / WebP / GIF'],
        [upload('video/mp4'), '仅支持 JPG / PNG / WebP / GIF'],
        [new FormData(), '缺少 file 字段'],
        ['not multipart', '请求格式错误'],
      ] as Array<[BodyInit, string]>) {
        const response = await endpoint.POST(req('POST', body), idContext())
        assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error })
      }
      const form = new FormData(); form.set('file', 'pretend-file')
      assert.equal((await endpoint.POST(req('POST', form), idContext())).status, 400)
      assert.equal(writes.length, before)
    }
  })
})

test('OWNER/session and tenant isolation gate all dedicated operations and legacy writes', async () => {
  await fixture(async ({ writes, reads }) => {
    for (const endpoint of [media, banner]) {
      for (const role of ['NONE', 'STAFF'] as const) {
        assert.equal((await endpoint.POST(req('POST', upload(), role), idContext())).status, 403)
        assert.equal((await endpoint.DELETE(req('DELETE', undefined, role), idContext())).status, 403)
      }
      for (const id of ['b', 'missing']) {
        assert.equal((await endpoint.POST(req('POST', upload()), idContext(id))).status, 403)
        assert.equal((await endpoint.DELETE(req('DELETE'), idContext(id))).status, 403)
      }
    }
    for (const role of ['NONE', 'STAFF'] as const) assert.equal((await media.GET(req('GET', undefined, role), idContext())).status, 403)
    assert.equal((await media.GET(req('GET'), idContext('b'))).status, 403)
    const forged = new NextRequest('http://localhost/api/stores/a/electronic-menu-media', { method: 'POST', body: upload(), headers: {
      'x-tenant-id': 'tenant-a', 'x-store-id': 'a', 'x-user-id': 'user-a', 'x-role': 'OWNER',
    } })
    assert.equal((await media.POST(forged, idContext())).status, 403)
    assert.equal(writes.length, 0)
    assert.ok(reads.every(r => r.select?.id && r.select?.code && !r.select?.electronicMenuMediaData))
  })
})

test('A banner stays on H5, B GIF is dedicated only, clear restores A; same-tenant stores remain separate', async () => {
  await fixture(async ({ rows, writes, reads }) => {
    const originalBanner = rows[0].bannerData
    const before = await display(new NextRequest('http://localhost/api/public/electronic-menu?code=STORE-A'))
    assert.equal((await before.json()).store.electronicMenuMediaUrl, null)
    const response = await media.POST(req('POST', upload()), idContext())
    const b = (await response.json()).electronicMenuMediaUrl
    assert.match(b, /^\/api\/public\/stores\/STORE-A\/electronic-menu-media\?v=[a-f0-9]{64}$/)
    assert.equal(rows[0].bannerData, originalBanner)
    assert.equal(rows[0].bannerUrl, '/banner-a.png')
    assert.deepEqual(Object.keys(writes[0].data!).sort(), ['electronicMenuMediaData', 'electronicMenuMediaUrl'])
    assert.equal(rows[1].electronicMenuMediaUrl, null)
    assert.equal(rows[2].electronicMenuMediaUrl, null)
    const image = await publicMedia.GET(req('GET', undefined, 'NONE'), codeContext())
    assert.equal(image.headers.get('content-type'), 'image/gif')
    assert.equal(image.headers.get('cache-control'), 'no-store')
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), gif)
    const homeImage = await publicBanner(req('GET', undefined, 'NONE'), codeContext())
    assert.deepEqual(Buffer.from(await homeImage.arrayBuffer()), png)
    assert.equal(homeImage.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    const menu = await display(new NextRequest('http://localhost/api/public/electronic-menu?code=STORE-A'))
    const data = await menu.json()
    assert.equal(data.store.electronicMenuMediaUrl, b)
    assert.equal(data.store.bannerUrl, '/banner-a.png')
    assert.doesNotMatch(JSON.stringify(data), /tenantId|bannerData|electronicMenuMediaData|base64/)
    const h5Response = await h5(new NextRequest('http://localhost/api/public/menu?code=STORE-A'))
    const h5Data = await h5Response.json()
    assert.equal(h5Data.store.bannerUrl, '/banner-a.png')
    assert.ok(!('electronicMenuMediaUrl' in h5Data.store))
    const management = await media.GET(req('GET'), idContext())
    assert.equal(management.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await management.json(), { electronicMenuMediaUrl: b, bannerUrl: '/banner-a.png' })
    const bStore = await display(new NextRequest('http://localhost/api/public/electronic-menu?code=STORE-B'))
    assert.equal((await bStore.json()).store.electronicMenuMediaUrl, null)
    assert.ok(reads.some(r => r.where.code === 'STORE-A' && r.where.tenantId === 'tenant-a' && r.where.status === 'ACTIVE' && Object.keys(r.select!).join() === 'electronicMenuMediaUrl'))
    await media.POST(req('POST', upload()), idContext('a2'))
    assert.match(String(rows[1].electronicMenuMediaUrl), /STORE-A2/)
    await media.DELETE(req('DELETE'), idContext())
    await media.DELETE(req('DELETE'), idContext())
    assert.equal(rows[0].electronicMenuMediaData, null)
    assert.equal(rows[0].electronicMenuMediaUrl, null)
    assert.ok(rows[1].electronicMenuMediaUrl)
    assert.equal(rows[0].bannerData, originalBanner)
    const cleared = await display(new NextRequest('http://localhost/api/public/electronic-menu?code=STORE-A'))
    const restored = (await cleared.json()).store
    assert.equal(restored.electronicMenuMediaUrl, null); assert.equal(restored.bannerUrl, '/banner-a.png')
    assert.equal((await publicMedia.GET(req('GET'), codeContext())).status, 404)
  })
})

test('identical retries are stable, rapid replacements version distinctly, banner updates/clear leave dedicated intact', async () => {
  await fixture(async ({ rows }) => {
    const a = await (await media.POST(req('POST', upload()), idContext())).json()
    const retry = await (await media.POST(req('POST', upload()), idContext())).json()
    assert.deepEqual(a, retry)
    const b = await (await media.POST(req('POST', upload('image/png', png)), idContext())).json()
    assert.notEqual(a.electronicMenuMediaUrl, b.electronicMenuMediaUrl)
    await banner.POST(req('POST', upload()), idContext())
    assert.equal(rows[0].electronicMenuMediaUrl, b.electronicMenuMediaUrl)
    const legacy = await publicBanner(req('GET'), codeContext())
    assert.deepEqual(Buffer.from(await legacy.arrayBuffer()), gif)
    await banner.DELETE(req('DELETE'), idContext())
    assert.equal(rows[0].bannerData, null)
    assert.equal(rows[0].electronicMenuMediaUrl, b.electronicMenuMediaUrl)
  })
})

test('anonymous media is GET-only; malformed/unknown/inactive selectors never expose other store images', async () => {
  await fixture(async ({ rows, reads, writes }) => {
    rows[0].electronicMenuMediaData = `data:image/gif;base64,${gif.toString('base64')}`
    for (const code of ['', '../STORE-A', 'STORE-A\n', 'A'.repeat(65)]) {
      const before = reads.length
      const response = await publicMedia.GET(req('GET'), codeContext(code))
      assert.equal(response.status, 400); assert.equal(await response.text(), '')
      assert.equal(reads.length, before)
    }
    for (const code of ['MISSING', 'STORE-OFF', 'STORE-B']) {
      const response = await publicMedia.GET(req('GET'), codeContext(code))
      assert.equal(response.status, 404); assert.equal(await response.text(), '')
    }
    rows[0].electronicMenuMediaData = 'malformed'
    const invalid = await publicMedia.GET(req('GET'), codeContext())
    assert.equal(invalid.status, 500); assert.equal(await invalid.text(), '')
    assert.deepEqual(Object.keys(publicMedia), ['GET'])
    assert.equal(writes.length, 0)
  })
})

test('failed writes preserve both field pairs and return generic retryable errors', async () => {
  await fixture(async ({ rows, failWrites, writes }) => {
    const before = structuredClone(rows)
    failWrites()
    for (const result of [await media.POST(req('POST', upload()), idContext()), await media.DELETE(req('DELETE'), idContext())]) {
      assert.equal(result.status, 503)
      assert.equal(result.headers.get('cache-control'), 'no-store')
      assert.doesNotMatch(await result.text(), /PRIVATE_DATABASE_DETAIL|tenant-a/)
    }
    assert.deepEqual(rows, before); assert.equal(writes.length, 0)
  })
})


test('media query failures are bounded and disclose no internal error or fallback from another store', async () => {
  await fixture(async ({ failMediaReads, writes }) => {
    failMediaReads()
    for (const response of [
      await media.GET(req('GET'), idContext()),
      await publicMedia.GET(req('GET'), codeContext()),
      await display(new NextRequest('http://localhost/api/public/electronic-menu?code=STORE-A')),
    ]) {
      assert.equal(response.status, 503)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.doesNotMatch(await response.text(), /PRIVATE_|tenant-a|banner-a/)
    }
    assert.equal(writes.length, 0)
  })
})
