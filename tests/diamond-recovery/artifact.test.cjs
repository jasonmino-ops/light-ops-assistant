'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const local=require('./local-db.cjs');const {BASE_ENV,deviceId,input}=require('./helpers.cjs');
const root=path.resolve(__dirname,'../..');
test('actual Next production artifact runs case API with in isolated DB with synthetic Gate; no production writes',async t=>{
 Object.assign(process.env,BASE_ENV);delete process.env.DESKTOP_NETWORK_PRINT_ENABLED;await local.start();const fixture=await local.clone('artifact');const pool=fixture.pool;
 const counts=async()=>JSON.stringify((await pool.query('SELECT (SELECT COUNT(*) FROM "SaleRecord") sales,(SELECT COUNT(*) FROM "PaymentIntent") payments,(SELECT COUNT(*) FROM "OperationLog") logs,(SELECT COUNT(*) FROM "EshopTrayPrintJob") jobs')).rows);
 const before=await counts();const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const server=cp.spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,...fixture.env},stdio:['ignore','pipe','pipe']});let log='';server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
 const url='http://127.0.0.1:'+port+'/api/cashier/recovery/diamond-13543';
 try {
  for(let i=0;i<100;i++){try{await fetch(url,{signal:AbortSignal.timeout(500)});break;}catch{await new Promise(r=>setTimeout(r,100));}if(i===99)throw Error(log);}
  const headers={'x-lightops-client':'desktop-pos','x-pos-operator-source':'DEVICE','x-pos-device-id':deviceId,'x-pos-device-token':fixture.t};
  await t.test('compiled server packaging resolves all dependencies; authenticated GET is READY for complete synthetic Gate',async()=>{const gate=await fixture.db.operationLog.findUniqueOrThrow({where:{id:'diamond:13543:gate:v1'}});await fixture.db.operationLog.delete({where:{id:gate.id}});const off=await fetch(url,{headers});assert.equal(off.status,200,log);assert.equal((await off.json()).state,'BLOCKED');await fixture.db.operationLog.create({data:gate});const r=await fetch(url,{headers});assert.equal(r.status,200,log);assert.equal(r.headers.get('set-cookie'),null);assert.equal((await r.json()).state,'READY');assert.match(r.headers.get('cache-control'),/no-store/);});
  await t.test('cross-origin, malformed and injected payloads never cross business boundary',async()=>{
   let r=await fetch(url,{method:'POST',headers:{...headers,origin:'https://evil.invalid','content-type':'application/json'},body:JSON.stringify(input())});assert.equal(r.status,403);
   r=await fetch(url,{method:'POST',headers:{...headers,origin:'https://elifekh.com','content-type':'application/json'},body:JSON.stringify({...input(),FOUNDER_APPROVED:true})});assert.equal(r.status,409);
   assert.equal(await counts(),before);
  });
  await t.test('actual optimized server executes the sealed 54-line core once, persists reconciliation and preserves one original print',async()=>{
   const r=await fetch(url,{method:'POST',headers:{...headers,origin:'https://elifekh.com','content-type':'application/json'},body:JSON.stringify(input()),signal:AbortSignal.timeout(85000)});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body)+log);assert.equal(body.state,'COMMITTED_WAITING_PRINT',JSON.stringify(body)+log);
   const db=fixture.db;assert.equal(await db.saleRecord.count(),54);assert.equal(await db.paymentIntent.count(),1);assert.equal(await db.eshopTrayPrintJob.count(),1);assert.equal(await db.nativeInventoryMovement.count(),0);const again=await fetch(url,{method:'POST',headers:{...headers,origin:'https://elifekh.com','content-type':'application/json'},body:JSON.stringify(input())});assert.equal((await again.json()).orderNo,body.orderNo);assert.equal(await db.saleRecord.count(),54);
  });
  const nft=JSON.parse(fs.readFileSync(root+'/.next/server/app/api/cashier/recovery/diamond-13543/route.js.nft.json'));assert(!nft.files.some(f=>f.includes('/private/tmp/')||f.includes('/Users/')||f.includes('typescript/lib')));
 }finally{server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));await local.stop();}
});
