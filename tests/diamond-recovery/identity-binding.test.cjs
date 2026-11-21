'use strict';
// New alias boundary only. Reuses the sealed local template; no production URL.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fixtures=require('./local-db.cjs');
const {createController,manifest,FENCE_ID,STOP_ID}=require('../../lib/diamond-recovery/controller.cjs');
const {BASE_ENV,request,input}=require('./helpers.cjs');
const CURRENT='076c9f3c-2d62-45f1-a7f4-f1dc6deec429';
Object.assign(process.env,BASE_ENV);delete process.env.DESKTOP_NETWORK_PRINT_ENABLED;
const body=id=>({...input(),holdId:id});
async function counts(db){return {sales:await db.saleRecord.count(),payments:await db.paymentIntent.count(),idem:await db.cashierSaleIdempotency.count(),jobs:await db.eshopTrayPrintJob.count(),moves:await db.nativeInventoryMovement.count(),accepted:await db.operationLog.count({where:{id:FENCE_ID}})};}
test('current/original hold identity shares the existing one-shot case',async t=>{
 await fixtures.start();
 try{
  const f=await fixtures.clone('idbinding');
  await t.test('only original and proven current hold may trigger; historical aliases remain evidence-only',async()=>{
   for(const id of ['unrecognized-hold','fcf89f83-9e1f-4319-a028-df72a0967c38','900fe73a-fd96-4610-8e05-6c8cda3a2d17','642ac3b8-3234-4cd9-86b8-dae9d0338ea4'])await assert.rejects(f.controller.execute(request(f.t),body(id)),/STOP_WRONG_HOLD/);
   await assert.rejects(f.controller.execute(request(f.t),{...body(CURRENT),cartSha256:'f'.repeat(64)}));
   assert.deepEqual(await counts(f.db),{sales:0,payments:0,idem:0,jobs:0,moves:0,accepted:0});
  });
  await t.test('mixed current/original concurrency creates one whole order and records selected identity',async()=>{
   const results=await Promise.all(Array.from({length:16},(_,i)=>createController(f.db,{env:f.env}).execute(request(f.t),body(i%2?CURRENT:manifest.holdId))));
   assert(results.every(r=>['PROCESSING','COMMITTED_WAITING_PRINT'].includes(r.state)),JSON.stringify(results));
   assert.deepEqual(await counts(f.db),{sales:54,payments:1,idem:1,jobs:1,moves:0,accepted:1});
   const lines=await f.db.saleRecord.findMany(),payment=await f.db.paymentIntent.findFirstOrThrow(),idem=await f.db.cashierSaleIdempotency.findFirstOrThrow();
   assert.equal(new Set(lines.map(x=>x.orderNo)).size,1);assert.equal(lines.reduce((n,x)=>n+Number(x.sellingQuantity),0),92);assert.equal(Math.round(lines.reduce((n,x)=>n+Number(x.lineAmount),0)*100),13543);
   assert.equal(payment.paymentMethod,'CASH');assert.equal(payment.status,'PAID');assert.equal(Number(payment.amount),135.43);assert.equal(idem.idempotencyKey,manifest.key);assert.equal(manifest.holdId,'b9a1663d-1ddf-405e-b2ac-6c4430186287');
   const fence=await f.db.operationLog.findUniqueOrThrow({where:{id:FENCE_ID}});assert([CURRENT,manifest.holdId].includes(fence.payloadSnapshot.selectedHoldId));assert(fence.payloadSnapshot.originalHoldIds.includes(CURRENT));assert.equal(fence.targetId,manifest.holdId);
   await f.controller.execute(request(f.t),body(CURRENT));await f.controller.execute(request(f.t),body(manifest.holdId));assert.deepEqual(await counts(f.db),{sales:54,payments:1,idem:1,jobs:1,moves:0,accepted:1});
  });
  await t.test('UNKNOWN from current hold freezes original identity without replay',async()=>{
   const r=await fixtures.clone('idunknown');await r.db.product.update({where:{id:manifest.expectedLines[0].productId},data:{sellPrice:999}});
   assert.equal((await r.controller.execute(request(r.t),body(CURRENT))).state,'UNKNOWN');assert.equal((await r.controller.execute(request(r.t),body(manifest.holdId))).state,'UNKNOWN');
   assert.deepEqual(await counts(r.db),{sales:0,payments:0,idem:0,jobs:0,moves:0,accepted:1});assert.equal(await r.db.operationLog.count({where:{id:STOP_ID}}),1);
  });
 }finally{await fixtures.stop();}
});
