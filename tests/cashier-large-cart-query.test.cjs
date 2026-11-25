'use strict';

// No URL/env credential fallback: integration fixtures only use this disposable loopback cluster.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');
const ts = require('typescript');
const pg = require('pg');
const generated = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { NextRequest } = require('next/server');
const repo = path.resolve(__dirname, '..');
const source = path.resolve(process.env.CASHIER_QUERY_TEST_SOURCE_ROOT || repo);
const routePath = 'app/api/cashier/sales/route.ts';
const base = 'b0aa38a1d1bf4d1aa0f375f1c42da6e4436dc481';
const baseline = execFileSync('git', ['show', `${base}:${routePath}`], { cwd: repo, encoding: 'utf8' });
const routeText = fs.readFileSync(path.join(source, routePath), 'utf8');
const block = (text) => text.slice(text.indexOf('  let saleLines\n'), text.indexOf('  // 门店未配置系统内图片'));
const candidateBlock = block(routeText);
const productionBase = 'd1ffbaea3d01c219bfb45a99ea360c511f27cf36';
const productionRoute = execFileSync('git', ['show', `${productionBase}:${routePath}`], { cwd: repo, encoding: 'utf8' });
const tenantId = 'cmvulpn2e000006jvsqrt3y2n';
const storeId = 'cmvulpn8r000106jvpo58kye4';
const userId = 'cmvulpnf9000206jvi09qdgs9';
const scope = { tenantId, storeId };
const expected = Array.from({ length: 54 }, (_, index) => ({
  barcode: `ISOLATED-NORMAL54-${index}`, quantity: index < 38 ? 2 : 1,
  price: index === 53 ? 44.43 : 1, aux: index < 9,
}));
const cents = (value) => Math.round(Number(value) * 100);
const requestKey = (label) => {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// Run the actual batch adapter and original unit authority, not a fabricated result array.
const lookupModules = loader({});
const { ProductUnitError: LookupDomainError } = lookupModules.load('lib/product-unit.ts');
const { resolveCashierProductsBatched } = lookupModules.load('lib/cashier-product-batch.ts');
function lookupFunction(text, database) {
  const code = ts.transpileModule(`async function run(prisma, store, items) { ${block(text)} return saleLines; } exports.run=run;`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} };
  new Function('exports', 'resolveCashierProductsBatched', 'ProductUnitError', 'NextResponse', code)(
    m.exports, resolveCashierProductsBatched, LookupDomainError, { json: (body, options) => ({ body, status: options.status }) });
  return (items) => m.exports.run(database, { tenantId, businessType: 'RETAIL' }, items);
}

test('one batch preserves all original indices under reversed database order, including repeated barcodes', async () => {
  const items = Array.from({ length: 54 }, (_, index) => ({ barcode: `REPEATED-${index % 3}`, quantity: index + 1,
    tenantId: 'UNTRUSTED', businessType: 'RESTAURANT' }));
  const codes = ['REPEATED-0', 'REPEATED-1', 'REPEATED-2'];
  const rows = codes.map((barcode, i) => ({ id: barcode, tenantId, status: 'ACTIVE', barcode,
    sellPrice: i + 1, mainUnitName: 'piece', auxEnabled: false }));
  let calls = 0;
  const run = lookupFunction(routeText, { product: {
    findMany: async ({ where }) => {
      calls++;
      assert.deepEqual(where, { tenantId, status: 'ACTIVE', OR: [
        { barcode: { in: codes } }, { auxEnabled: true, auxBarcode: { in: codes } },
      ] });
      await sleep(1);
      return [...rows].reverse();
    },
    findFirst: async () => { assert.fail('unique batch matches must not issue per-line database queries'); },
  } });
  const resolved = await run(items);
  assert.equal(calls, 1);
  assert(resolved.every(x => x.product.tenantId === tenantId && x.multiUnitEligible));
  assert.deepEqual(resolved.map(x => ({ barcode: x.barcode, quantity: Number(x.sellingQuantity) })),
    items.map(({ barcode, quantity }) => ({ barcode, quantity })));
  resolved.forEach((line, i) => assert.equal(Number(line.lineAmount), (i % 3 + 1) * items[i].quantity));
});

test('a failed batch has no queued, in-flight fallback or retried reads and never releases a result', async () => {
  let calls = 0;
  const failure = Error('FIRST_OBSERVED_FAILURE');
  const run = lookupFunction(routeText, { product: {
    findMany: async () => { calls++; await sleep(1); throw failure; },
    findFirst: async () => { assert.fail('failed batches must not start fallback reads'); },
  } });
  await assert.rejects(run(expected.map((x, i) => ({ ...x, quantity: i + 1 }))), error => error === failure);
  await sleep(10);
  assert.equal(calls, 1, 'one failed batch cannot leave another database request in flight');
  const missing = await lookupFunction(routeText, { product: {
    findMany: async () => [], findFirst: async () => { assert.fail('missing products must not query again'); },
  } })([{ barcode: 'MISSING', quantity: 1 }]);
  assert.deepEqual(missing, { status: 404, body: { error: 'PRODUCT_NOT_FOUND', message: '商品不存在或已停用' } });
});

test('runtime candidate contains only the two approved deltas and preserves all Production transaction surroundings', () => {
  assert(candidateBlock.includes('saleLines = await resolveCashierProductsBatched(prisma,'));
  assert(!candidateBlock.includes('$transaction'));
  const reverseOnce = (text, from, to) => {
    assert.equal(text.split(from).length - 1, 1, `exactly one approved delta: ${from}`);
    return text.replace(from, to);
  };
  let restored = reverseOnce(routeText,
    "import { resolveCashierProductsBatched } from '@/lib/cashier-product-batch'\n", '');
  restored = reverseOnce(restored, '  ProductUnitError,\n', '  ProductUnitError,\n  resolveProductSellingUnit,\n');
  restored = reverseOnce(restored, candidateBlock, block(productionRoute));
  restored = reverseOnce(restored, 'const desktopNetworkMode = desktopRequest && validPrinting\n',
    'const desktopNetworkMode = desktopRequest\n');
  assert.equal(restored, productionRoute, 'financial transaction, idempotency ledger and print admission must remain byte-identical');
  for (const file of ['lib/product-unit.ts', 'lib/prisma.ts', 'lib/pos-request-ledger.ts',
    'lib/cashier-payment-confirmation.ts', 'lib/v3-print-job-adapter.ts', 'lib/cashier-shift.ts']) {
    assert.equal(fs.readFileSync(path.join(source, file), 'utf8'),
      execFileSync('git', ['show', `${productionBase}:${file}`], { cwd: repo, encoding: 'utf8' }));
  }
});

function loader(database, useBaseline = false) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file); if (!path.extname(file)) file += '.ts';
    if (cache.has(file)) return cache.get(file).exports;
    const text = useBaseline && file === path.join(source, routePath) ? baseline : fs.readFileSync(file, 'utf8');
    const m = new Module(file); m.filename = file; m.paths = module.paths; cache.set(file, m);
    m.require = (name) => {
      if (name === '@/lib/prisma' || name.startsWith('.') && path.resolve(path.dirname(file), name) === path.join(source, 'lib/prisma')) return { prisma: database };
      if (name === '@prisma/client') return generated;
      if (name.startsWith('@/')) return load(path.join(source, name.slice(2)));
      if (name.startsWith('.')) {
        const target = path.resolve(path.dirname(file), name);
        if (fs.existsSync(target + '.ts')) return load(target + '.ts');
        if (target.endsWith('.ts')) return load(target);
      }
      return require(require.resolve(name, { paths: [path.join(repo, 'node_modules'), path.dirname(file)] }));
    };
    m._compile(ts.transpileModule(text, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText, file);
    return m.exports;
  }
  return { load: (relative) => load(path.join(source, relative)) };
}

test('normal 54-line CASH route with unchanged business transaction on isolated PostgreSQL', {
  skip: process.env.RUN_LOCAL_LARGE_CART_PG !== '1', timeout: 180000,
}, async (t) => {
  assert(process.env.CASHIER_QUERY_TEST_SOURCE_ROOT, 'Use the actual Production-based runtime candidate, not the different main transaction');
  Object.assign(process.env, { NODE_ENV: 'production', VERCEL_ENV: 'production',
    AUTH_SECRET: 'ISOLATED-NORMAL54-NOT-PRODUCTION', ESHOP_DISABLE_DEV_HEADERS: '1', DESKTOP_OPERATOR_BOUNDARY_ENABLED: '1' });
  delete process.env.DESKTOP_NETWORK_PRINT_ENABLED;
  const admin = new pg.Pool({ host: '127.0.0.1', port: 56431, user: 'jason', database: 'postgres' });
  const databases = [], connections = [];
  let createdRole = false;
  let serial = 0;
  async function fixture({ delay = 0, baselineRoute = false, failProduct = false, transactionDelay = 0, failPayment = false } = {}) {
    const database = `native_inventory_test_normal54_${Date.now().toString(36)}_${++serial}`;
    assert.match(database, /^native_inventory_test_normal54_[a-z0-9_]+$/);
    await admin.query(`CREATE DATABASE ${database} TEMPLATE native_inventory_test_whole_order`); databases.push(database);
    const setup = new pg.Pool({ host: '127.0.0.1', port: 56431, user: 'jason', database });
    await setup.query('GRANT USAGE ON SCHEMA public, native_inventory TO postgres');
    await setup.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO postgres');
    await setup.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres');
    await setup.query('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA native_inventory TO postgres');
    await setup.query('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA native_inventory TO postgres');
    await setup.end();
    const stats = { active: 0, peak: 0, started: 0, transactionCalls: 0, byOperation: { findFirst: 0, findMany: 0 } };
    class DelayedClient extends pg.Client {
      query(text, values, cb) {
        if (typeof values === 'function') { cb = values; values = undefined; }
        const sql = typeof text === 'string' ? text : text?.text || '';
        const wait = sql.includes('"Product"') ? delay : 0;
        if (cb) return super.query(text, values, (err, result) => setTimeout(() => cb(err, result), wait));
        const value = super.query(text, values);
        return value && typeof value.then === 'function' ? value.then(async result => { await sleep(wait); return result; }) : value;
      }
    }
    const pool = new pg.Pool({ host: '127.0.0.1', port: 56431, user: 'postgres', database, max: 2,
      connectionTimeoutMillis: 5000, Client: DelayedClient });
    const db = new generated.PrismaClient({ adapter: new PrismaPg(pool) }); connections.push({ db, pool });
    assert.equal(await db.saleRecord.count(), 0, 'template must contain no sales');
    await db.store.update({ where: { id: storeId }, data: { businessType: 'RETAIL', currencyCode: 'USD', printKitchenTicket: false } });
    await db.product.createMany({ data: expected.map((item, i) => ({ id: `isolated-normal54-product-${i}`,
      tenantId, name: `ISOLATED product ${i}`, barcode: item.aux ? `ISOLATED-MAIN-${i}` : item.barcode,
      sellPrice: item.aux ? 0.5 : item.price, status: 'ACTIVE', mainUnitName: 'piece', printKitchenTicket: i % 2 === 0,
      auxEnabled: item.aux, auxBarcode: item.aux ? item.barcode : null, auxUnitName: item.aux ? 'pack' : null,
      auxConversionFactor: item.aux ? 2 : null, auxSellPrice: item.aux ? item.price : null,
    })) });
    const instrumented = new Proxy(db, { get(target, key) {
      if (key === 'product') return new Proxy(target.product, { get(delegate, operation) {
        const value = delegate[operation];
        if (!['findFirst', 'findMany'].includes(operation)) return typeof value === 'function' ? value.bind(delegate) : value;
        return async (...args) => {
          stats.started++; stats.byOperation[operation]++;
          stats.peak = Math.max(stats.peak, ++stats.active);
          try { if (failProduct) throw Error('SIMULATED_CONNECTION_ACQUISITION_TIMEOUT'); return await value.apply(delegate, args); }
          finally { stats.active--; }
        };
      } });
      if (key === '$transaction') return (fn, ...options) => {
        stats.transactionCalls++;
        return target.$transaction(async tx => fn(new Proxy(tx, { get(inner, name) {
          if (name === 'paymentIntent' && (transactionDelay || failPayment)) return { ...inner.paymentIntent, create: async args => {
            if (transactionDelay) await sleep(transactionDelay);
            if (failPayment) throw Error('SIMULATED_PAYMENT_WRITE_FAILURE');
            return inner.paymentIntent.create(args);
          } };
          const value = inner[name]; return typeof value === 'function' ? value.bind(inner) : value;
        } })), ...options); // Preserve the route's own transaction options/defaults exactly.
      };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const modules = loader(instrumented, baselineRoute);
    const cookie = modules.load('lib/session.ts').signSession({ ...scope, userId, role: 'OWNER' });
    const post = modules.load(routePath).POST;
    const request = (key, items = expected, method = 'CASH') => new NextRequest('http://127.0.0.1/api/cashier/sales', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': requestKey(key),
        'x-lightops-client': 'desktop-pos', 'x-pos-operator-source': 'ACCOUNT', cookie: `auth-session=${cookie}` },
      body: JSON.stringify({ storeCode: 'ST883DC00C', items: items.map((x, i) => ({ barcode: x.barcode, quantity: x.quantity, sugar: i % 2 ? '25' : 'no_sugar' })),
        paymentMethod: method, manualPaymentConfirmed: method === 'KHQR' }),
    });
    const counts = async () => ({ sales: await db.saleRecord.count(), payments: await db.paymentIntent.count(),
      idem: await db.cashierSaleIdempotency.count(), jobs: await db.eshopTrayPrintJob.count(), moves: await db.nativeInventoryMovement.count() });
    return { db, pool, stats, post, request, counts, modules };
  }
  const zero = { sales: 0, payments: 0, idem: 0, jobs: 0, moves: 0 };
  const check = (name, run) => t.test(name, {
    skip: !!process.env.CASHIER_QUERY_TEST_CASE && !new RegExp(process.env.CASHIER_QUERY_TEST_CASE).test(name),
  }, run);
  try {
    const role = await admin.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='postgres'");
    if (!role.rows.length) { await admin.query('CREATE ROLE postgres LOGIN NOSUPERUSER BYPASSRLS'); createdRole = true; }
    else assert.deepEqual(role.rows[0], { rolsuper: false, rolbypassrls: true });
    await check('baseline 54-way fanout reproduces real max2 / 5000ms pool-wait failure before any transaction', async () => {
      const f = await fixture({ delay: 350, baselineRoute: true });
      await assert.rejects(f.post(f.request('normal54-baseline')), /timeout|connection/i);
      await sleep(1000);
      assert.equal(f.stats.peak, 54); assert.equal(f.stats.transactionCalls, 0);
      assert.deepEqual(f.stats.byOperation, { findFirst: 54, findMany: 0 });
      assert.deepEqual(await f.counts(), zero);
    });
    await check('54 lines, 92 sales units, 13543 cents, current timestamps and normal local-first print handoff', async () => {
      const f = await fixture({ delay: 350 }); const before = Date.now();
      const response = await f.post(f.request('normal54-success')); const body = await response.json();
      assert.equal(response.status, 201, JSON.stringify(body)); assert.equal(cents(body.totalAmount), 13543);
      assert.equal(f.stats.peak, 1, 'the normal cart is one bounded database batch');
      assert.equal(f.stats.started, 1);
      assert.deepEqual(f.stats.byOperation, { findFirst: 0, findMany: 1 });
      const lines = await f.db.saleRecord.findMany({ orderBy: { createdAt: 'asc' } });
      assert.equal(lines.length, 54); assert.equal(new Set(lines.map(x => x.orderNo)).size, 1);
      assert.equal(lines.reduce((s, x) => s + Number(x.sellingQuantity ?? x.quantity), 0), 92);
      assert.equal(lines.reduce((s, x) => s + Number(x.quantity), 0), 110);
      assert.equal(lines.reduce((s, x) => s + cents(x.lineAmount), 0), 13543);
      lines.forEach((x, i) => { assert.equal(x.barcode, expected[i].barcode); assert.equal(x.status, 'COMPLETED');
        assert.equal(x.specSnapshot, i % 2 ? '微糖 25%' : '无糖'); assert(x.createdAt.getTime() >= before - 54); });
      const payment = await f.db.paymentIntent.findFirstOrThrow();
      assert.equal(payment.status, 'PAID'); assert.equal(payment.paymentMethod, 'CASH'); assert.equal(cents(payment.amount), 13543);
      assert(payment.paidAt.getTime() >= before); assert.equal(payment.orderNo, body.orderNo);
      assert.deepEqual(await f.counts(), { sales: 54, payments: 1, idem: 1, jobs: 0, moves: 0 });
      assert.equal(body.printing, undefined, 'normal Desktop sale must not add a competing Cloud print producer');
      // Existing Desktop local-first durable intake, without a USB transport or physical execution.
      const adapter = f.modules.load('lib/v3-print-job-adapter.ts');
      const bytes = Buffer.from(JSON.stringify({ orderNo: body.orderNo, total: 135.43, lines: expected }));
      const intent = { schemaVersion: 3, printJobId: 'network:' + createHash('sha256').update(body.orderNo + ':FRONT').digest('hex'),
        source: 'LOCAL_DESKTOP', role: 'FRONT', payloadKind: 'RAW_BYTES', orderNo: body.orderNo, rendererVersion: 'ISOLATED-HANDOFF-NO-PAPER',
        payloadBase64: bytes.toString('base64'), byteLength: bytes.length, payloadHash: createHash('sha256').update(bytes).digest('hex') };
      const expires = new Date(Date.now() + 60000);
      const first = await f.db.$transaction(tx => adapter.enqueueHeldV3PrintIntent(tx, scope, intent, expires));
      assert.equal(first.created, true);
      // An existing duplicate intake inside a PG transaction aborts that transaction.
      // The original job remains unique; no retry or physical execution is performed.
      await assert.rejects(f.db.$transaction(tx => adapter.enqueueHeldV3PrintIntent(tx, scope, intent, expires)));
      const job = await f.db.eshopTrayPrintJob.findFirstOrThrow(); assert.equal(job.payload.role, 'FRONT');
      assert.equal(job.physicalCompletionKnown, false); assert.equal(await f.db.eshopTrayPrintJob.count(), 1);
      const shift = lines.filter(x => x.createdAt.getTime() >= before - 1000 && x.createdAt.getTime() <= Date.now());
      assert.equal(shift.reduce((s, x) => s + cents(x.lineAmount), 0), 13543);
      console.log(JSON.stringify({ result: 'normal54', elapsedMs: Date.now() - before, maxProductFanout: f.stats.peak,
        orderNo: body.orderNo, lines: 54, sellingUnits: 92, cents: 13543, printJobs: 1, physicalPaperVerified: false }));
    });
    await check('two simultaneous 54-line normal carts remain bounded; existing numbering conflicts roll back atomically', async () => {
      const f = await fixture({ delay: 150 });
      const start = Date.now(); const results = await Promise.all(['cart-a', 'cart-b'].map(k => f.post(f.request(k))));
      assert(results.every(x => [201, 500].includes(x.status))); assert(f.stats.peak <= 4); // Retain the old outer concurrency safety bound.
      assert(f.stats.peak <= 2);
      assert.deepEqual(f.stats.byOperation, { findFirst: 0, findMany: 2 });
      const committed = results.filter(x => x.status === 201).length; assert(committed >= 1);
      // Original generateRecordNo uses count+1: distinct concurrent orders can collide.
      // Preserve this rule; verify failures cannot leave a partial order/payment.
      assert.deepEqual(await f.counts(), { sales: committed * 54, payments: committed, idem: committed, jobs: 0, moves: 0 });
      const paid = await f.db.paymentIntent.findMany(); assert(paid.every(x => x.status === 'PAID' && cents(x.amount) === 13543));
      console.log(JSON.stringify({ result: 'two54Carts', statuses: results.map(x => x.status),
        elapsedMs: Date.now() - start, maxProductFanoutPerInstance: f.stats.peak, existingCountPlusOneRuleUnchanged: true }));
    });
    await check('eight simultaneous identical request keys produce exactly one financial result', async () => {
      const f = await fixture();
      const responses = await Promise.all(Array.from({ length: 8 }, () => f.post(f.request('one-identical-key'))));
      const bodies = await Promise.all(responses.map(x => x.json()));
      assert(responses.every(x => x.status === 201), JSON.stringify(bodies));
      assert.equal(new Set(bodies.map(x => x.orderNo)).size, 1);
      assert.deepEqual(await f.counts(), { sales: 54, payments: 1, idem: 1, jobs: 0, moves: 0 });
    });
    await check('invalid product and query timeout never enter the financial transaction', async () => {
      const missing = await fixture(); const items = expected.map((x, i) => i === 3 ? { ...x, barcode: 'ISOLATED-MISSING' } : x);
      const response = await missing.post(missing.request('missing-product', items));
      assert.equal(response.status, 404); assert.equal(missing.stats.transactionCalls, 0); assert.deepEqual(await missing.counts(), zero);
      const timed = await fixture({ failProduct: true });
      await assert.rejects(timed.post(timed.request('query-timeout')), /SIMULATED_CONNECTION_ACQUISITION_TIMEOUT/);
      assert.equal(timed.stats.transactionCalls, 0); assert.deepEqual(await timed.counts(), zero);
      assert.equal(timed.stats.started, 1, 'a batch failure must not retry');
      assert.deepEqual(timed.stats.byOperation, { findFirst: 0, findMany: 1 });
    });
    await check('payment failure and original default transaction timeout roll back all rows', async () => {
      for (const options of [{ failPayment: true }, { transactionDelay: 5200 }]) {
        const f = await fixture(options); const response = await f.post(f.request('rollback-case'));
        assert.equal(response.status, 500); assert.deepEqual(await f.counts(), zero);
      }
    });
    await check('lost response or UNKNOWN is resolved read-only; payload conflict cannot create another order', async () => {
      const f = await fixture(); const response = await f.post(f.request('lost-response'));
      assert.equal(response.status, 201); // The caller intentionally discards the body; it must not submit again.
      const before = await f.counts();
      const records = await f.db.cashierSaleIdempotency.findMany({ where: { ...scope, idempotencyKey: requestKey('lost-response') } });
      assert.equal(records.length, 1); assert.equal(records[0].status, 'SUCCEEDED');
      const paid = await f.db.paymentIntent.findMany({ where: { orderNo: records[0].resultSnapshot.orderNo } });
      assert.equal(paid.length, 1); assert.equal(paid[0].status, 'PAID');
      assert.deepEqual(await f.counts(), before);
      assert.equal(await f.db.cashierSaleIdempotency.count({ where: { ...scope, idempotencyKey: requestKey('unknown-not-proven') } }), 0);
      assert.deepEqual(await f.counts(), before, 'unknown means no financial POST or print intake');
      const changed = expected.map((x, i) => i ? x : { ...x, quantity: x.quantity + 1 });
      const conflict = await f.post(f.request('lost-response', changed));
      assert.equal(conflict.status, 409); assert.deepEqual(await f.counts(), before);
    });
  } finally {
    for (const { db, pool } of connections) { await db.$disconnect(); await pool.end(); }
    for (const name of databases) await admin.query(`DROP DATABASE ${name}`);
    if (createdRole) await admin.query('DROP ROLE postgres');
    await admin.end();
  }
});
