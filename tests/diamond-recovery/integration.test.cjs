'use strict';
// ONLY fixed loopback PostgreSQL. Reuses the original 17-test template; no env URL fallback.
const {test}=require('node:test'),assert=require('node:assert/strict');
const pg=require('pg'),{PrismaClient}=require('@prisma/client'),{PrismaPg}=require('@prisma/adapter-pg');
const {createController,manifest,FENCE_ID,STOP_ID,WITNESS_ID,GATE_ID,VERIFY_ID}=require('../../lib/diamond-recovery/controller.cjs');
const {BASE_ENV,token,tokenHash,request,input,gateFixture,gateRow,deviceId,sign}=require('./helpers.cjs');
const scope={tenantId:manifest.tenantId,storeId:manifest.storeId};
Object.assign(process.env,BASE_ENV);delete process.env.DESKTOP_NETWORK_PRINT_ENABLED;
let admin,createdRole=false;const databases=[],connections=[];
async function clone(label) {
 const name='native_inventory_test_oneclick_'+label+'_'+Date.now().toString(36);assert(/^native_inventory_test_oneclick_[a-z0-9_]+$/.test(name));
 await admin.query('CREATE DATABASE '+name+' TEMPLATE native_inventory_test_whole_order');databases.push(name);
 const setup=new pg.Pool({host:'127.0.0.1',port:56431,user:'jason',database:name});await setup.query('GRANT USAGE ON SCHEMA public TO postgres');await setup.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO postgres');await setup.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres');await setup.query('GRANT USAGE ON SCHEMA native_inventory TO postgres');await setup.query('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA native_inventory TO postgres');await setup.query('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA native_inventory TO postgres');await setup.end();
 const pool=new pg.Pool({host:'127.0.0.1',port:56431,user:'postgres',database:name,max:2});const db=new PrismaClient({adapter:new PrismaPg(pool)});connections.push({db,pool});
 const t=token();await db.desktopDevice.create({data:{id:'cmvyx1jes000208l14t5vf9ur',...scope,installationIdHash:'ISOLATED',tokenHash:'ISOLATED-'+name,tokenIssuedAt:new Date(),tokenExpiresAt:new Date(Date.now()+3600000)}});
 await db.browserPosDevice.create({data:{id:'ISOLATED-ONECLICK-BROWSER',...scope,browserDeviceId:deviceId,tokenHash:tokenHash(t),tokenIssuedAt:new Date(),tokenExpiresAt:new Date(Date.now()+3600000),scopes:[]}});
 await db.v3PrintControlPlane.update({where:{storeId:scope.storeId},data:{ownerDeviceId:'cmvyx1jes000208l14t5vf9ur',ownerEpoch:2,leaseId:'ISOLATED-LEASE-'+name,leaseExpiresAt:new Date(Date.now()+3600000)}});
 const env={...BASE_ENV,DATABASE_URL:'postgresql://postgres@127.0.0.1:56431/'+name};const g=gateFixture(env,t);await db.operationLog.create({data:gateRow(g)});return {db,pool,t,env,g,controller:createController(db,{env})};
}
async function counts(db){return {sales:await db.saleRecord.count(),payments:await db.paymentIntent.count(),idem:await db.cashierSaleIdempotency.count(),jobs:await db.eshopTrayPrintJob.count(),moves:await db.nativeInventoryMovement.count(),acceptance:await db.operationLog.count({where:{id:FENCE_ID}})};}
test('new packaged entry, real durable PK race, recovery proof, paper-only witness and uncertainty',async t=>{
 admin=new pg.Pool({host:'127.0.0.1',port:56431,user:'jason',database:'postgres'});
 try {
  const roles=await admin.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='postgres'");
  if(!roles.rows.length){await admin.query('CREATE ROLE postgres LOGIN NOSUPERUSER BYPASSRLS');createdRole=true;}else{assert.equal(roles.rows[0].rolsuper,false);assert.equal(roles.rows[0].rolbypassrls,true);}
  const f=await clone('primary');const req=()=>request(f.t);
  await t.test('actual local runtime is postgres/non-super/bypass; exact device/account scopes; GET is read-only',async()=>{
   const devicesBefore=JSON.stringify({desktop:await f.db.desktopDevice.findMany(),browser:await f.db.browserPosDevice.findMany()});
   const id=await f.controller.authenticate(req());assert.equal(id.triggerUserId,manifest.approvedActorId);assert.equal(id.source,'DEVICE');assert.equal((await f.controller.status(id)).state,'READY');assert.deepEqual(await counts(f.db),{sales:0,payments:0,idem:0,jobs:0,moves:0,acceptance:0});
   assert.equal(JSON.stringify({desktop:await f.db.desktopDevice.findMany(),browser:await f.db.browserPosDevice.findMany()}),devicesBefore);
   await assert.rejects(createController(f.db,{env:{...f.env,AUTH_SECRET:undefined}}).authenticate(req()));
   await assert.rejects(f.controller.authenticate(request('invalid')));
   await assert.rejects(f.controller.authenticate(request(f.t,{'x-pos-device-id':'wrong'})));
   await assert.rejects(f.controller.authenticate(request(f.t,{'x-pos-operator-source':'ACCOUNT'})));
   const wrong=sign({tenantId:'different-tenant',storeId:scope.storeId,userId:manifest.approvedActorId,role:'OWNER'});await assert.rejects(f.controller.authenticate(request(f.t,{'x-pos-operator-source':'ACCOUNT',cookie:'auth-session='+wrong})));
   await f.db.browserPosDevice.update({where:{id:'ISOLATED-ONECLICK-BROWSER'},data:{status:'REVOKED'}});await assert.rejects(f.controller.authenticate(req()));await f.db.browserPosDevice.update({where:{id:'ISOLATED-ONECLICK-BROWSER'},data:{status:'ACTIVE'}});
  });
  await t.test('proved pre-acceptance refusal leaves no fence or financial effect; technical Gate correction can admit safely',async()=>{
   await f.db.operationLog.delete({where:{id:GATE_ID}});const result=await f.controller.execute(req(),input());assert.equal(result.state,'BLOCKED_NOT_ACCEPTED');assert.equal(result.accepted,false);assert.equal((await counts(f.db)).acceptance,0);assert.equal((await counts(f.db)).sales,0);await f.db.operationLog.create({data:gateRow(f.g)});
  });
  await t.test('20 concurrent requests across fresh controllers: exactly one acceptance and one financial invocation',async()=>{
   const devicesBeforeSale=JSON.stringify({desktop:await f.db.desktopDevice.findMany(),browser:await f.db.browserPosDevice.findMany()});
   const r=await Promise.all(Array.from({length:20},()=>createController(f.db,{env:f.env}).execute(req(),input())));
   assert(r.every(x=>['PROCESSING','COMMITTED_WAITING_PRINT'].includes(x.state)),JSON.stringify(r));
   assert.deepEqual(await counts(f.db),{sales:54,payments:1,idem:1,jobs:1,moves:0,acceptance:1});
   const id=await f.controller.authenticate(req());const state=await f.controller.status(id);assert.equal(state.state,'COMMITTED_WAITING_PRINT');assert.match(state.orderNo,/^S-20261120-ST883DC00C-/);
   const sale=await f.db.saleRecord.findMany();assert.equal(new Set(sale.map(x=>x.orderNo)).size,1);assert.equal(sale.reduce((n,x)=>n+Number(x.sellingQuantity),0),92);assert.equal(sale.reduce((n,x)=>n+Number(x.quantity),0),110);assert.equal(Math.round(sale.reduce((n,x)=>n+Number(x.lineAmount),0)*100),13543);
   assert(sale.every(x=>x.createdAt>=new Date('2026-11-19T17:00Z')&&x.createdAt<new Date('2026-11-20T17:00Z')));
   assert.equal(await f.db.saleRecord.count({where:{createdAt:{gte:new Date('2026-11-20T17:00Z')}}}),0);
   const audit=await f.db.operationLog.findFirstOrThrow({where:{actionType:manifest.task}});assert.equal(audit.payloadSnapshot.recoveryDayNewCashCents,0);assert.equal(audit.payloadSnapshot.cashAlreadyCountedInOriginalShift,true);assert(Math.abs(Date.parse(audit.payloadSnapshot.recoveryPostingAt)-Date.now())<60000);assert(audit.payloadSnapshot.handoverRecoveryEvidence.originalSignedRecordSha256);
   const paid=await f.db.paymentIntent.findFirstOrThrow();assert.equal(paid.status,'PAID');assert.equal(paid.paymentMethod,'CASH');assert(Math.abs(paid.paidAt.getTime()-Date.now())<60000);assert.equal(await f.db.paymentTransaction.count(),0);
   const job=await f.db.eshopTrayPrintJob.findFirstOrThrow();assert.equal(job.maxAttempts,1);assert.equal(job.schemaVersion,3);assert.equal(job.payload.role,'FRONT');assert.equal(job.expiresAt.toISOString(),'2026-11-21T16:13:36.233Z');
   assert.equal(await f.db.nativeInventoryMovement.count(),0);
   const realRows=[...(await f.db.paymentIntent.findMany()),...(await f.db.cashierSaleIdempotency.findMany()),...(await f.db.eshopTrayPrintJob.findMany()),...(await f.db.operationLog.findMany())];assert(realRows.every(row=>Math.abs(row.createdAt.getTime()-Date.now())<120000));assert.equal(job.payload.networkRequest.order.createdAt,sale[0].createdAt.toISOString());assert.equal(JSON.stringify({desktop:await f.db.desktopDevice.findMany(),browser:await f.db.browserPosDevice.findMany()}),devicesBeforeSale);
  });
  await t.test('lost response / reload / repeated POST only reads same order; gate removal cannot cause second financial call',async()=>{
   const before=await counts(f.db);await f.db.operationLog.delete({where:{id:GATE_ID}});const out=await createController(f.db,{env:f.env}).execute(req(),input());assert.equal(out.state,'COMMITTED_WAITING_PRINT');assert.deepEqual(await counts(f.db),before);
  });
  await t.test('no paper witness before known transport success; UNKNOWN print stops and cannot re-submit',async()=>{
   await assert.rejects(f.controller.execute(req(),{...input(),action:'confirmPaper',paperComplete:true,receiverAcknowledged:true,receiverName:'ISOLATED receiver'}));const job=await f.db.eshopTrayPrintJob.findFirstOrThrow();await f.db.eshopTrayPrintJob.update({where:{id:job.id},data:{status:'FAILED',resultStatus:'CROSSING_UNKNOWN',effectBoundary:'CROSSING_UNKNOWN',completedAt:new Date()}});
   assert.equal((await f.controller.execute(req(),input())).state,'UNKNOWN');await assert.rejects(f.controller.execute(req(),{...input(),action:'confirmPaper',paperComplete:true,receiverAcknowledged:true,receiverName:'ISOLATED receiver'}));assert.equal((await counts(f.db)).sales,54);
   // Isolated fixture transition only; production code has no repair/ACK path.
   await f.db.eshopTrayPrintJob.update({where:{id:job.id},data:{status:'SUCCEEDED',resultStatus:'CROSSED',effectBoundary:'CROSSED',completedAt:new Date()}});
   assert.equal((await f.controller.status(await f.controller.authenticate(req()))).state,'PAPER_CONFIRMABLE');
   await assert.rejects(f.controller.execute(req(),{...input(),action:'confirmPaper',paperComplete:true,receiverAcknowledged:true,receiverName:'ISOLATED WRONG RECEIVER'}));
   const otherCredential=sign({v:'pos-device-v1',...scope,storeCode:manifest.storeCode,deviceId,issuedBy:manifest.approvedActorId,iat:Date.now()});await assert.rejects(f.controller.execute(request(otherCredential),{...input(),action:'confirmPaper',paperComplete:true,receiverAcknowledged:true,receiverName:'ISOLATED receiver'}));await assert.rejects(f.controller.execute(request(otherCredential),{...input(),action:'reportPaperFailure'}));
   await Promise.all(Array.from({length:5},()=>f.controller.execute(req(),{...input(),action:'confirmPaper',paperComplete:true,receiverAcknowledged:true,receiverName:'ISOLATED receiver'})));
   assert.equal(await f.db.operationLog.count({where:{id:WITNESS_ID}}),1);assert.equal((await f.controller.status(await f.controller.authenticate(req()))).state,'PAPER_CONFIRMED');assert.equal((await f.db.eshopTrayPrintJob.findUniqueOrThrow({where:{id:job.id}})).physicalCompletionKnown,false);
   assert.deepEqual(await counts(f.db),{sales:54,payments:1,idem:1,jobs:1,moves:0,acceptance:1});
  });
  await t.test('terminal print without proved crossed result freezes even after a paper witness; no repeat transaction',async()=>{
   const job=await f.db.eshopTrayPrintJob.findFirstOrThrow();await f.db.eshopTrayPrintJob.update({where:{id:job.id},data:{resultStatus:null,effectBoundary:null}});assert.equal((await f.controller.execute(req(),input())).state,'UNKNOWN');assert.equal((await counts(f.db)).sales,54);
   await f.db.eshopTrayPrintJob.update({where:{id:job.id},data:{resultStatus:'CROSSED',effectBoundary:'CROSSED'}});
  });
  await t.test('post-commit reconciliation response loss freezes without repeating sale, payment or print',async()=>{
   const r=await clone('lostreconcile');const proxy=new Proxy(r.db,{get(target,key){if(key==='operationLog')return {...target.operationLog,create:async args=>{const v=await target.operationLog.create(args);if(args.data.id===VERIFY_ID)throw Error('SIMULATED_LOST_RECONCILIATION_RESPONSE');return v;}};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
   assert.equal((await createController(proxy,{env:r.env}).execute(request(r.t),input())).state,'UNKNOWN');assert.deepEqual(await counts(r.db),{sales:54,payments:1,idem:1,jobs:1,moves:0,acceptance:1});assert.equal((await r.controller.execute(request(r.t),input())).state,'UNKNOWN');assert.equal(await r.db.operationLog.count({where:{id:STOP_ID}}),1);
  });
  await t.test('financial rollback consumes durable acceptance and freezes forever; no fallback/replay',async()=>{
   const r=await clone('rollback');await r.db.product.update({where:{id:manifest.expectedLines[0].productId},data:{sellPrice:999}});
   const state=await r.controller.execute(request(r.t),input());assert.equal(state.state,'UNKNOWN');assert.deepEqual(await counts(r.db),{sales:0,payments:0,idem:0,jobs:0,moves:0,acceptance:1});assert.equal(await r.db.operationLog.count({where:{id:STOP_ID}}),1);
   await r.db.product.update({where:{id:manifest.expectedLines[0].productId},data:{sellPrice:manifest.expectedLines[0].priceCents/100}});assert.equal((await createController(r.db,{env:r.env}).execute(request(r.t),input())).state,'UNKNOWN');assert.equal((await counts(r.db)).sales,0);
  });
  await t.test('acceptance insert response loss never invokes finance and creates UNKNOWN freeze',async()=>{
   const r=await clone('lostacceptance');const proxy=new Proxy(r.db,{get(target,key){if(key==='operationLog')return {...target.operationLog,create:async args=>{const v=await target.operationLog.create(args);if(args.data.id===FENCE_ID)throw Error('SIMULATED_LOST_INSERT_RESPONSE');return v;}};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
   const c=createController(proxy,{env:r.env});assert.equal((await c.execute(request(r.t),input())).state,'UNKNOWN');assert.deepEqual(await counts(r.db),{sales:0,payments:0,idem:0,jobs:0,moves:0,acceptance:1});assert.equal((await r.controller.execute(request(r.t),input())).state,'UNKNOWN');
  });
  await t.test('operator-reported paper failure persists FAILED audit and stops without changing native print result or another financial call',async()=>{
   const before=await counts(f.db);const job=JSON.stringify(await f.db.eshopTrayPrintJob.findMany());const r=await f.controller.execute(req(),{...input(),action:'reportPaperFailure'});assert.equal(r.state,'UNKNOWN');const stop=await f.db.operationLog.findUniqueOrThrow({where:{id:STOP_ID}});assert.equal(stop.status,'FAILED');assert.equal(stop.payloadSnapshot.state,'UNKNOWN');assert.equal(await counts(f.db).then(JSON.stringify),JSON.stringify(before));assert.equal(JSON.stringify(await f.db.eshopTrayPrintJob.findMany()),job);assert.equal((await f.controller.execute(req(),input())).state,'UNKNOWN');
  });
 } finally {
  for(const {db,pool} of connections){await db.$disconnect();await pool.end();}
  for(const name of databases)await admin.query('DROP DATABASE '+name);
  if(createdRole)await admin.query('DROP ROLE postgres');await admin.end();
 }
});
