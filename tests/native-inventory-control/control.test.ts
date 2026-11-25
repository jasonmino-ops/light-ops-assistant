import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { chromium, devices } from '@playwright/test'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient } from '@prisma/client'
import { NextRequest } from 'next/server'
import { GET, PUT } from '../../app/api/native-inventory/sales-control/route'
import { GET as inventoryGet, PUT as inventoryPut } from '../../app/api/native-inventory/[resource]/route'
import { prisma } from '../../lib/prisma'
import { signSession } from '../../lib/session'
import { controlIntent, type SalesControlIntent, type SalesControlResult, type SalesControlState } from '../../lib/native-inventory/sales-control'
import { posRequestIdentity, writePosRequest } from '../../lib/pos-request-ledger'

for (const name of ['DATABASE_URL', 'CONTROL_FIXTURE_OWNER_URL']) {
  const url = new URL(process.env[name] ?? 'http://invalid')
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.pathname, '/native_inventory_test_control_production')
}
assert.equal(process.env.NATIVE_INVENTORY_TEST_DATABASE, '1')
const ownerDb = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: process.env.CONTROL_FIXTURE_OWNER_URL })) })
// Fixture input for the deployed database currency-capture contract; do not
// import main's legacy helper, which is absent from the Production source tree.
async function recordInventoryOrderCurrency(tx: Prisma.TransactionClient, source: object) {
  await tx.$queryRaw`SELECT set_config('eshop.inventory_order_currency',${JSON.stringify(source)},true)`
}

test('Diamond sales control: real PostgreSQL ledger, signed identity and atomic command', async t => {
  t.after(async () => { await Promise.all([prisma.$disconnect(), ownerDb.$disconnect()]) })
  const [runtime] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`
  assert.deepEqual(runtime, { rolsuper: false, rolbypassrls: false })
  const tenant = await ownerDb.tenant.create({ data: { name: 'Control fixture tenant' } })
  const foreign = await ownerDb.tenant.create({ data: { name: 'Foreign fixture tenant' } })
  const diamond = await ownerDb.store.create({ data: { id:'diamond-control-fixture', tenantId: tenant.id, name: 'Diamond fixture', code: 'ST883DC00C' } })
  const peer = await ownerDb.store.create({ data: { tenantId: tenant.id, name: 'Peer fixture', code: randomUUID() } })
  const other = await ownerDb.store.create({ data: { tenantId: foreign.id, name: 'Other fixture', code: randomUUID() } })
  async function user(tenantId: string, role: 'OWNER' | 'STAFF') {
    return ownerDb.user.create({ data: { tenantId, role, username: randomUUID(), displayName: 'Fixture person', telegramId: String(Math.floor(Math.random()*1e12)+1) } })
  }
  const owner = await user(tenant.id, 'OWNER'), staff = await user(tenant.id, 'STAFF'), outsider = await user(foreign.id, 'OWNER')
  await ownerDb.userStoreRole.createMany({ data: [
    { tenantId: tenant.id, storeId: diamond.id, userId: owner.id, role: 'OWNER' },
    { tenantId: tenant.id, storeId: peer.id, userId: owner.id, role: 'OWNER' },
    { tenantId: tenant.id, storeId: diamond.id, userId: staff.id, role: 'STAFF' },
    { tenantId: foreign.id, storeId: other.id, userId: outsider.id, role: 'OWNER' },
  ] })
  await ownerDb.nativeInventoryStore.createMany({ data: [diamond, peer, other].map(s => ({ tenantId: s.tenantId, storeId: s.id, currencyCode: s.currencyCode, enabledAt: new Date() })) })
  await ownerDb.nativeInventoryReceiver.create({ data: { tenantId: tenant.id, storeId: diamond.id, userId: staff.id } })
  await ownerDb.$executeRaw`INSERT INTO native_inventory.sales_pilot(pilot_store_id,sheets_store_id,sheets_retired_at) VALUES(${diamond.id},${diamond.id},clock_timestamp())`
  const product = await ownerDb.product.create({ data: { tenantId: tenant.id, name: 'Fixture product', barcode: randomUUID(), sellPrice: 10 } })
  const scope = { tenantId: tenant.id, storeId: diamond.id }
  function headers(person = owner, storeId = diamond.id, age = 0) {
    const auth_date = String(Math.floor(Date.now()/1000)-age)
    const identity = JSON.stringify({ id: Number(person.telegramId) })
    const secret = createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN!).digest()
    const hash = createHmac('sha256', secret).update(`auth_date=${auth_date}\nuser=${identity}`).digest('hex')
    return { cookie: 'auth-session='+signSession({ tenantId: person.tenantId, storeId, userId: person.id, role: person.role }),
      'x-telegram-init-data': new URLSearchParams({ auth_date, user: identity, hash }).toString(), 'content-type': 'application/json' }
  }
  async function api(body?: object, person = owner, storeId = diamond.id, extra = {}) {
    const req = new NextRequest('http://localhost/api/native-inventory/sales-control', { method: body ? 'PUT':'GET',
      headers: { ...headers(person,storeId), ...extra }, body: body && JSON.stringify(body) })
    const res = process.env.CONTROL_TEST_URL ? await fetch(process.env.CONTROL_TEST_URL+'/api/native-inventory/sales-control',{
      method:body?'PUT':'GET',headers:Object.fromEntries(req.headers.entries()),body:body&&JSON.stringify(body),
    }) : await (body ? PUT(req) : GET(req))
    return { status: res.status, body: await res.json() }
  }
  async function state() { const r=await api(); assert.equal(r.status,200,JSON.stringify(r.body)); return r.body.data as SalesControlState }
  async function intent(enabled: boolean): Promise<SalesControlIntent> {
    const s=await state()
    return { id:randomUUID(), enabled, expectedVersion:s.version, expectedEpoch:s.epoch,
      confirmations:{terminalsRefreshed:true,offlineQueueEmpty:true,noCheckout:true} }
  }
  async function command(enabled: boolean) {
    const r=await api(await intent(enabled)); assert.equal(r.status,200,JSON.stringify(r.body));
    assert.equal(r.body.data.outcome,'APPLIED',JSON.stringify(r.body)); await delay(5); return r.body.data as SalesControlResult
  }
  async function balance() { const item=await ownerDb.nativeInventoryItem.findFirst({where:{...scope,productId:product.id}}); return item?.onHand.toNumber() }
  async function sale(quantity: number, options: { status?: 'COMPLETED'|'PENDING_PAYMENT'; offline?: boolean } = {}) {
    return prisma.$transaction(async tx => {
      await recordInventoryOrderCurrency(tx,{...scope,kind:'POS',currencyCode:diamond.currencyCode,paymentCurrencyCode:diamond.currencyCode})
      const record=await tx.saleRecord.create({data:{...scope,operatorUserId:owner.id,productId:product.id,
        recordNo:randomUUID(),orderNo:randomUUID(),barcode:product.barcode!,productNameSnapshot:product.name,
        quantity,unitPrice:10,lineAmount:quantity*10,saleType:'SALE',status:options.status??'COMPLETED',
        ...(options.offline?{source:'CASHIER_OFFLINE',offlineOrderId:randomUUID()}:{}),
      }})
      if(record.status==='COMPLETED') await tx.paymentIntent.create({data:{...scope,operatorUserId:owner.id,orderNo:record.orderNo!,paymentMethod:'CASH',amount:quantity*10,status:'PAID'}})
      return record
    })
  }
  async function refund(originalId: string, quantity: number) {
    return prisma.saleRecord.create({data:{...scope,operatorUserId:owner.id,productId:product.id,
      recordNo:randomUUID(),orderNo:randomUUID(),barcode:product.barcode!,productNameSnapshot:product.name,
      quantity,unitPrice:10,lineAmount:-quantity*10,saleType:'REFUND',status:'COMPLETED',originalSaleRecordId:originalId}})
  }

  await t.test('real owner, receiver read-only, other store/tenant, expired proof and CSRF', async () => {
    assert.equal((await state()).enabled,false)
    const viewed=await api(undefined,staff); assert.equal(viewed.status,200); assert.equal(viewed.body.data.canControl,false)
    assert.equal((await api(await intent(true),staff)).status,403)
    assert.equal((await api(undefined,outsider,diamond.id)).status,403)
    assert.equal((await api(await intent(true),owner,peer.id)).status,403)
    const peerRead=await api(undefined,owner,peer.id)
    if(process.env.CONTROL_PRODUCTION_RUNTIME==='1') assert.equal(peerRead.status,403)
    else assert.equal(peerRead.body.data.available,false)
    assert.equal((await api(await intent(true),owner,diamond.id,{'sec-fetch-site':'cross-site',origin:'https://attacker.invalid'})).status,403)
    const expired=new NextRequest('http://localhost/api/native-inventory/sales-control',{headers:headers(owner,diamond.id,1000)})
    assert.equal((await GET(expired)).status,403)
    assert.throws(()=>controlIntent({...awaitPlaceholder(),tenantId:foreign.id}))
  })
  function awaitPlaceholder() { return {id:randomUUID(),enabled:true,expectedVersion:'0',expectedEpoch:null,confirmations:{terminalsRefreshed:true,offlineQueueEmpty:true,noCheckout:true}} }
  await t.test('server refuses missing field confirmation and pending payment; audits rejection', async () => {
    const missing=await intent(true); missing.confirmations.offlineQueueEmpty=false
    assert.equal((await api(missing)).body.data.error,'FIELD_CONFIRMATION_REQUIRED')
    const pending=await sale(1,{status:'PENDING_PAYMENT'})
    assert.equal((await api(await intent(true))).body.data.error,'UNSETTLED_OPERATIONS')
    await ownerDb.saleRecord.update({where:{id:pending.id},data:{status:'CANCELLED'}})
    assert.equal((await state()).enabled,false)
  })
  await t.test('each server-side unsettled category independently blocks activation', async () => {
    const customer=await ownerDb.customerOrder.create({data:{...scope,storeCode:diamond.code,orderNo:randomUUID(),itemsJson:'[]',totalAmount:0,status:'PENDING'}})
    assert.equal((await api(await intent(true))).body.data.error,'UNSETTLED_OPERATIONS')
    await ownerDb.customerOrder.update({where:{id:customer.id},data:{status:'CANCELLED'}})
    const payment=await ownerDb.paymentIntent.create({data:{...scope,operatorUserId:owner.id,orderNo:randomUUID(),paymentMethod:'CASH',amount:1}})
    assert.equal((await api(await intent(true))).body.data.error,'UNSETTLED_OPERATIONS')
    await ownerDb.paymentIntent.update({where:{id:payment.id},data:{status:'CANCELLED'}})
    const provider=await ownerDb.paymentTransaction.create({data:{...scope,provider:'FIXTURE',method:'CASH',trxId:randomUUID(),amount:1,currency:diamond.currencyCode}})
    assert.equal((await api(await intent(true))).body.data.error,'UNSETTLED_OPERATIONS')
    await ownerDb.paymentTransaction.update({where:{id:provider.id},data:{status:'CANCELLED'}})
    const upload=await ownerDb.offlineSaleSyncMap.create({data:{...scope,deviceId:randomUUID(),offlineOrderId:randomUUID(),status:'FAILED'}})
    assert.equal((await api(await intent(true))).body.data.error,'UNSETTLED_OPERATIONS')
    await ownerDb.offlineSaleSyncMap.update({where:{id:upload.id},data:{status:'SYNCED'}})
  })
  await t.test('same request replay/concurrency, changed payload, and stale state', async () => {
    const on=await intent(true)
    const [a,b]=await Promise.all([api(on),api(on)])
    assert.equal(a.body.data.outcome,'APPLIED'); assert.deepEqual(a.body,b.body)
    assert.equal((await api({...on,enabled:false})).status,409)
    assert.equal((await api({...on,id:randomUUID()})).body.data.error,'CONTROL_STATE_CHANGED')
    const epoch=(await state()).epoch; await command(true); assert.equal((await state()).epoch,epoch)
  })
  const first=await sale(4)
  await t.test('first sale creates negative balance, OFF refunds and partial refund cancellation', async () => {
    assert.equal(await balance(),-4)
    await command(false)
    const returned=await refund(first.id,1); assert.equal(await balance(),-3)
    await prisma.saleRecord.update({where:{id:returned.id},data:{status:'CANCELLED'}})
    assert.equal(await balance(),-4)
    await prisma.saleRecord.update({where:{id:returned.id},data:{status:'CANCELLED'}})
    assert.equal(await balance(),-4)
    await refund(first.id,2); assert.equal(await balance(),-2)
    await refund(first.id,2); assert.equal(await balance(),0)
    await assert.rejects(refund(first.id,1),/NATIVE_REFUND_QTY_EXCEEDED/)
    assert.equal(await balance(),0)
  })
  await t.test('OFF sale never gains a movement or phantom refund after re-enable; offline late upload excluded', async () => {
    const off=await sale(3); assert.equal(await balance(),0)
    const pending=await sale(1,{status:'PENDING_PAYMENT'})
    await ownerDb.saleRecord.update({where:{id:pending.id},data:{status:'CANCELLED'}})
    await command(true)
    await refund(off.id,2); assert.equal(await balance(),0)
    await sale(2,{offline:true}); assert.equal(await balance(),0)
  })
  await t.test('sale cancellation after partial refund restores remaining, late refund cancellation adds nothing', async () => {
    const original=await sale(4); const partial=await refund(original.id,1); assert.equal(await balance(),-3)
    await command(false)
    await prisma.saleRecord.update({where:{id:original.id},data:{status:'CANCELLED'}}); assert.equal(await balance(),0)
    await prisma.saleRecord.update({where:{id:partial.id},data:{status:'CANCELLED'}}); assert.equal(await balance(),0)
  })
  await t.test('refund cancellation before sale cancellation also balances to zero; repeat movement is a no-op', async () => {
    await command(true)
    const original=await sale(3), returned=await refund(original.id,1)
    await command(false)
    await prisma.saleRecord.update({where:{id:returned.id},data:{status:'CANCELLED'}})
    assert.equal(await balance(),-3)
    await prisma.saleRecord.update({where:{id:original.id},data:{status:'CANCELLED'}})
    assert.equal(await balance(),0)
    const item=await ownerDb.nativeInventoryItem.findFirstOrThrow({where:{...scope,productId:product.id}})
    const [repeat]=await prisma.$queryRaw<{applied:boolean}[]>`SELECT public.native_inventory_move(${tenant.id},${diamond.id},${item.id},${original.id},'SALE_CANCEL',2,NULL,NULL,NULL,${owner.id},NULL,${original.id}) AS applied`
    assert.equal(repeat.applied,false)
    assert.equal(await balance(),0)
  })
  await t.test('uncommitted old-epoch pending order cannot gain admission after activation', async () => {
    let created!:()=>void, release!:()=>void
    const ready=new Promise<void>(resolve=>{created=resolve}), commit=new Promise<void>(resolve=>{release=resolve})
    const old=prisma.$transaction(async tx=>{
      const record=await tx.saleRecord.create({data:{...scope,operatorUserId:owner.id,productId:product.id,
        recordNo:randomUUID(),orderNo:randomUUID(),barcode:product.barcode!,productNameSnapshot:product.name,
        quantity:1,unitPrice:10,lineAmount:10,saleType:'SALE',status:'PENDING_PAYMENT'}})
      created(); await commit; return record
    },{timeout:5000})
    try { await ready; await command(true) } finally { release() }
    const record=await old
    await prisma.saleRecord.update({where:{id:record.id},data:{status:'COMPLETED'}})
    assert.equal(await balance(),0)
    assert.equal(await ownerDb.nativeInventoryMovement.count({where:{...scope,type:'SALE',sourceId:record.id}}),0)
    await command(false)
  })
  await t.test('OFF tracked POS partial refunds still require a request ID and replay only once', async () => {
    await command(true)
    const original=await sale(3)
    await command(false)
    const body={saleType:'REFUND',originalSaleRecordId:original.id,refundQty:1,refundReason:'fixture'}
    const missing=posRequestIdentity(new Request('http://localhost/api/sales'),body)
    const actor={...scope,userId:owner.id}
    const execute=(identity:ReturnType<typeof posRequestIdentity>)=>prisma.$transaction(async tx=>writePosRequest(tx,actor,'POS_REFUND',diamond.code,identity,async()=>{
      const record=await tx.saleRecord.create({data:{...scope,operatorUserId:owner.id,productId:product.id,
        recordNo:randomUUID(),orderNo:randomUUID(),barcode:product.barcode!,productNameSnapshot:product.name,
        quantity:1,unitPrice:10,lineAmount:-10,saleType:'REFUND',status:'COMPLETED',originalSaleRecordId:original.id}})
      return {id:record.id}
    }))
    await assert.rejects(execute(missing),error=>(error as {code?:string}).code==='IDEMPOTENCY_KEY_REQUIRED')
    assert.equal(await balance(),-3)
    const key=randomUUID()
    const identity=posRequestIdentity(new Request('http://localhost/api/sales',{headers:{'idempotency-key':key}}),body)
    const [a,b]=await Promise.all([execute(identity),execute(identity)])
    assert.deepEqual(a,b); assert.deepEqual(await execute(identity),a)
    assert.equal(await balance(),-2)
    assert.equal(await ownerDb.saleRecord.count({where:{...scope,originalSaleRecordId:original.id}}),1)
    if(process.env.CONTROL_PRODUCTION_RUNTIME==='1') {
      const response=await fetch(process.env.CONTROL_TEST_URL+'/api/sales',{method:'POST',headers:headers(),body:JSON.stringify(body)})
      assert.equal(response.status,409,await response.text())
      const httpKey=randomUUID()
      const sendSame=()=>fetch(process.env.CONTROL_TEST_URL+'/api/sales',{method:'POST',headers:{...headers(),'idempotency-key':httpKey},body:JSON.stringify(body)})
      const first=await sendSame(), replay=await sendSame()
      assert.equal(first.status,201,await first.clone().text()); assert.equal(replay.status,201,await replay.clone().text())
      assert.deepEqual(await first.json(),await replay.json())
      assert.equal(await balance(),-1)
    }
    await prisma.saleRecord.update({where:{id:original.id},data:{status:'CANCELLED'}})
    assert.equal(await balance(),0)
  })
  await t.test('request resolution fences delayed execution and recovers committed response loss', async () => {
    const delayed=await intent(true)
    const resolved=await api({...delayed,resolve:true}); assert.equal(resolved.body.data.outcome,'NOT_APPLIED')
    assert.deepEqual((await api(delayed)).body,resolved.body); assert.equal((await state()).enabled,false)
    const lost=await intent(true)
    const original=await api(lost) // simulate response loss after server commit
    assert.deepEqual((await api({...lost,resolve:true})).body,original.body)
    assert.equal((await state()).enabled,true)
  })
  await t.test('parallel partial refunds never exceed original issue; disable races refund and sale safely', async () => {
    const original=await sale(2)
    const results=await Promise.allSettled([refund(original.id,2),refund(original.id,2)])
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
    const issued=await sale(2)
    const off=await intent(false)
    await Promise.all([api(off),refund(issued.id,1),sale(1)])
    const movements=await ownerDb.nativeInventoryMovement.findMany({where:{...scope,originalId:issued.id,type:'REFUND'}})
    assert.equal(movements.length,1); assert.equal(movements[0].quantity.toNumber(),1)
    assert.equal((await state()).enabled,false)
  })
  await t.test('concurrent original request versus resolution has one immutable decision', async () => {
    const on=await intent(true)
    const [applied,resolved]=await Promise.all([api(on),api({...on,resolve:true})])
    assert.deepEqual(applied.body,resolved.body)
    assert.ok(['APPLIED','NOT_APPLIED'].includes(applied.body.data.outcome))
    assert.equal((await state()).enabled,applied.body.data.outcome==='APPLIED')
    if((await state()).enabled) await command(false)
  })
  await t.test('H5 paid sale deducts once; cancellation after disable never auto-restocks', async () => {
    await command(true)
    const h5=await ownerDb.product.create({data:{tenantId:tenant.id,name:'H5 control fixture',barcode:randomUUID(),sellPrice:10}})
    const order=await prisma.$transaction(async tx=>{
      await recordInventoryOrderCurrency(tx,{...scope,kind:'H5',currencyCode:diamond.currencyCode})
      return tx.customerOrder.create({data:{...scope,storeCode:diamond.code,orderNo:randomUUID(),status:'COMPLETED',paymentStatus:'PAID',
        itemsJson:JSON.stringify([{productId:h5.id,name:h5.name,quantity:2,lineAmount:20}]),totalAmount:20,paidAmount:20}})
    })
    const item=await ownerDb.nativeInventoryItem.findFirstOrThrow({where:{...scope,productId:h5.id}})
    assert.equal(item.onHand.toNumber(),-2)
    await prisma.customerOrder.update({where:{id:order.id},data:{status:'COMPLETED',paymentStatus:'PAID'}})
    await command(false)
    await prisma.customerOrder.update({where:{id:order.id},data:{status:'CANCELLED'}})
    assert.equal((await ownerDb.nativeInventoryItem.findFirstOrThrow({where:{...scope,id:item.id}})).onHand.toNumber(),-2)
    assert.equal(await ownerDb.nativeInventoryMovement.count({where:{...scope,itemId:item.id}}),1)
  })
  await t.test('receipt confirmation remains atomic/idempotent; inventory query remains available', async () => {
    async function inventory(resource:string,body?:object) {
      const req=new NextRequest('http://localhost/api/native-inventory/'+resource,{method:body?'PUT':'GET',headers:headers(),body:body&&JSON.stringify(body)})
      const res=await (body?inventoryPut:inventoryGet)(req,{params:Promise.resolve({resource})})
      const result=await res.json(); assert.equal(res.status,200,JSON.stringify(result)); return result.data
    }
    const item=await ownerDb.nativeInventoryItem.findFirstOrThrow({where:{...scope,productId:product.id}})
    const before=await balance(), supplierId=randomUUID(), receiptId=randomUUID()
    await inventory('suppliers',{id:supplierId,name:'Fixture control supplier'})
    const saved=await inventory('receipts',{id:receiptId,revision:0,supplierId,lines:[{itemId:item.id,unitId:'BASE',quantity:'8',unitPrice:'3'}]})
    await Promise.all([inventory('receipt-confirmation',{id:receiptId,revision:1}),inventory('receipt-confirmation',{id:receiptId,revision:1})])
    assert.equal(await balance(),before!+8)
    assert.equal(await ownerDb.nativeInventoryMovement.count({where:{...scope,type:'RECEIPT',sourceId:receiptId+':'+saved.lines[0].lineNo}}),1)
    assert.ok(Array.isArray(await inventory('items')))
  })
  await t.test('audit immutable to application, request result scoped to actor, no public execute', async () => {
    await assert.rejects(prisma.$queryRaw`SELECT * FROM native_inventory.sales_control_operation`,/permission denied/)
    await assert.rejects(prisma.$executeRaw`UPDATE native_inventory.sales_control_version SET version=999`,/permission denied/)
    const [audit]=await ownerDb.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM native_inventory.sales_control_operation`
    assert.ok(audit.count>=BigInt(10))
    const [acl]=await ownerDb.$queryRaw<{ exposed: boolean }[]>`SELECT has_function_privilege('anon','native_inventory.sales_control_command(text,text,text,uuid,jsonb,boolean)','EXECUTE') AS exposed`
    assert.equal(acl.exposed,false)
    const another=await user(tenant.id,'OWNER')
    await ownerDb.userStoreRole.create({data:{...scope,userId:another.id,role:'OWNER'}})
    const id=await intent(false)
    assert.equal((await api(id)).body.data.outcome,'APPLIED')
    assert.equal((await api(id,another)).status,409)
    await assert.rejects(prisma.$queryRaw`SELECT native_inventory.sales_control_command(${tenant.id},${diamond.id},${staff.id},${randomUUID()}::uuid,${JSON.stringify(id)}::jsonb,false)`,/OWNER_REQUIRED/)
    await assert.rejects(prisma.$queryRaw`SELECT native_inventory.sales_control_command(${foreign.id},${other.id},${owner.id},${randomUUID()}::uuid,${JSON.stringify(id)}::jsonb,false)`,/OWNER_REQUIRED/)
    await assert.rejects(prisma.$queryRaw`SELECT native_inventory.sales_control_state(${foreign.id},${diamond.id},${owner.id})`,/STORE_ACCESS_DENIED/)
  })
  await t.test('mobile/desktop control rendering, staff read-only, stale GET response cannot overwrite current OFF', async () => {
    assert.ok(process.env.CONTROL_TEST_URL)
    const origin=process.env.CONTROL_TEST_URL!
    const browser=await chromium.launch({headless:true})
    try {
      for(const mobile of [false,true]) {
        const context=await browser.newContext(mobile?devices['iPhone 13']:{viewport:{width:1280,height:900}})
        await context.route('https://telegram.org/**',route=>route.fulfill({status:200,contentType:'text/javascript',body:''}))
        await context.addCookies([{name:'auth-session',value:headers().cookie.slice('auth-session='.length),url:origin}])
        await context.addInitScript(({proof,id})=>{Object.defineProperty(window,'Telegram',{value:{WebApp:{initData:proof,ready(){},expand(){}}}}); sessionStorage.setItem('tg-authed-uid',id)}, {proof:headers()['x-telegram-init-data'],id:owner.telegramId!})
        const page=await context.newPage()
        let first!:()=>void
        const held=new Promise<void>(resolve=>{first=resolve})
        let started!:()=>void
        const ready=new Promise<void>(resolve=>{started=resolve})
        let reads=0
        const current=await state()
        await page.route('**/api/native-inventory/sales-control',async route=>{
          if(route.request().method()!=='GET') return route.continue()
          if(++reads===1) { started(); await held; return route.fulfill({json:{outcome:'SUCCESS',data:{...current,enabled:true}}}) }
          return route.fulfill({json:{outcome:'SUCCESS',data:{...current,enabled:false}}})
        })
        await page.goto(origin+'/native-inventory')
        await Promise.race([ready,delay(15000).then(()=>{throw new Error('Control did not mount: '+page.url())})])
        await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
        const region=page.locator('section[aria-label="销售自动扣减"]')
        await region.getByRole('button',{name:'开启自动扣减'}).waitFor()
        first()
        await delay(80)
        assert.equal(await region.getByRole('status').first().textContent(),'已关闭')
        await region.getByRole('button',{name:'开启自动扣减'}).click()
        assert.equal(await region.getByRole('checkbox').count(),3)
        assert.equal(await region.getByRole('button',{name:'确认开启'}).isDisabled(),true)
        const width=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}))
        assert.ok(width.scroll<=width.width+1,'no horizontal overflow')
        await page.screenshot({path:`.task-state/control-test-run/control-${mobile?'mobile':'desktop'}.png`,fullPage:true})
        await context.close()
      }
      const staffContext=await browser.newContext(devices['iPhone 13'])
      await staffContext.route('https://telegram.org/**',route=>route.fulfill({status:200,contentType:'text/javascript',body:''}))
      await staffContext.addCookies([{name:'auth-session',value:headers(staff).cookie.slice('auth-session='.length),url:origin}])
      await staffContext.addInitScript(({proof,id})=>{Object.defineProperty(window,'Telegram',{value:{WebApp:{initData:proof,ready(){},expand(){}}}}); sessionStorage.setItem('tg-authed-uid',id)}, {proof:headers(staff)['x-telegram-init-data'],id:staff.telegramId!})
      const staffPage=await staffContext.newPage()
      await staffPage.goto(origin+'/native-inventory')
      const staffControl=staffPage.locator('section[aria-label="销售自动扣减"]')
      await staffControl.getByText('仅老板可更改，员工仅查看状态。').waitFor()
      assert.equal(await staffControl.getByRole('button',{name:'开启自动扣减'}).count(),0)
      await staffContext.close()
    } finally { await browser.close() }
  })
})
