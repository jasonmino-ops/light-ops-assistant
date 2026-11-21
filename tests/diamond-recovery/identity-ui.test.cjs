'use strict';
// Only the new live ID and cross-ID latch; existing nine UI leaves are reused.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {chromium}=require('@playwright/test'),wm=require('next/dist/compiled/webpack/webpack');wm.init();
const root=path.resolve(__dirname,'../..'),original=require('../../lib/diamond-recovery/frozen/held-orders.json')[0],current={...original,id:'076c9f3c-2d62-45f1-a7f4-f1dc6deec429',createdAt:'2026-11-21T11:15:11.182Z'};
test('current held-order UI uses the sealed case without modifying its source',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'diamond-id-ui-'));let server,browser;
 try{
  await new Promise((resolve,reject)=>wm.webpack({mode:'development',context:root,target:'web',entry:path.join(__dirname,'ui-harness.tsx'),output:{path:dir,filename:'harness.js'},devtool:false,resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':root}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[path.join(__dirname,'tsx-loader.cjs')]}]}}).run((e,s)=>e||s.hasErrors()?reject(e||Error(s.toString({all:false,errors:true}))):resolve()));
  const bundle=fs.readFileSync(path.join(dir,'harness.js'));server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/harness.js'?'text/javascript':'text/html');res.end(req.url==='/harness.js'?bundle:'<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/harness.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/desktop/pos';browser=await chromium.launch({headless:true});
  async function page(context,order){const p=await context.newPage();await p.addInitScript(props=>{window.recoveryHold=props.order;window.recoveryIdle=props.idle;localStorage.setItem('cashier:posDeviceToken:ST883DC00C','ISOLATED-DEVICE-TOKEN');localStorage.setItem('cashier:deviceId','ISOLATED-DEVICE');},{order,lang:'zh',idle:true});return p;}
  const recover=p=>p.getByRole('button',{name:'恢复入账并打印',exact:true});
  async function select(p){await p.goto(url);await p.getByRole('button',{name:'选择原挂单'}).click();}
  async function ready(p){await p.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='恢复入账并打印')?.disabled);}
  await t.test('new current ID sends one request, preserves held-order bytes and immutable snapshot',async()=>{
   const context=await browser.newContext();const p=await page(context,current);const raw=JSON.stringify([current]);await p.addInitScript(value=>localStorage.setItem('cashier:holdOrders:ST883DC00C',value),raw);const sent=[];
   await p.route('**/api/cashier/recovery/**',route=>{if(route.request().method()==='POST'){sent.push(route.request().postDataJSON());return route.fulfill({json:{state:'COMMITTED_WAITING_PRINT',orderNo:'ISOLATED-ONE-ORDER'}});}return route.fulfill({json:{state:'READY'}});});await select(p);await ready(p);await recover(p).dblclick();await p.getByRole('status').filter({hasText:'已入账'}).waitFor();assert.equal(sent.length,1);assert.equal(sent[0].holdId,current.id);assert.equal(await p.evaluate(()=>localStorage.getItem('cashier:holdOrders:ST883DC00C')),raw);const backup=JSON.parse(await p.evaluate(()=>localStorage.getItem('cashier:diamondRecovery:originalBackup:v1')));assert.equal(backup.snapshot,JSON.stringify(current));await context.close();
  });
  await t.test('changed current cart cannot query readiness or submit',async()=>{
   const context=await browser.newContext(),changed=structuredClone(current);changed.cart[0].qty++;const p=await page(context,changed);let calls=0;await p.route('**/api/cashier/recovery/**',route=>{calls++;return route.abort();});await select(p);await p.getByRole('status').filter({hasText:'原单校验未通过'}).waitFor();assert(await recover(p).isDisabled());assert.equal(calls,0);await context.close();
  });
  await t.test('uncertain current submission keeps original hold disabled across the same browser storage',async()=>{
   const context=await browser.newContext();const p=await page(context,current);let posts=0;await p.route('**/api/cashier/recovery/**',route=>{if(route.request().method()==='POST'){posts++;return route.abort();}return route.fulfill({json:{state:'READY'}});});await select(p);await ready(p);await recover(p).click();await p.getByRole('status').filter({hasText:'结果待核实'}).waitFor();assert.equal(posts,1);await p.close();
   const q=await page(context,original);await q.route('**/api/cashier/recovery/**',route=>{if(route.request().method()==='POST')posts++;return route.fulfill({json:{state:'READY'}});});await select(q);await q.getByRole('status').filter({hasText:'结果待核实'}).waitFor();assert(await recover(q).isDisabled());assert.equal(posts,1);await context.close();
  });
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
