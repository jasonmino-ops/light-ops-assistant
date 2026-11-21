'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {chromium}=require('@playwright/test');
const webpackModule=require('next/dist/compiled/webpack/webpack');webpackModule.init();
const webpack=webpackModule.webpack;
const root=path.resolve(__dirname,'../..');
const hold=require('../../lib/diamond-recovery/frozen/held-orders.json')[0];
let browser,server,temp;
test('case-only browser entry: original retention, once-only POST, reload and paper confirmation',async t=>{
 temp=fs.mkdtempSync(path.join(os.tmpdir(),'diamond-ui-'));
 try {
  const config = {
    mode: 'development', context: root, target: 'web',
    entry: path.join(__dirname, 'ui-harness.tsx'),
    output: { path: temp, filename: 'harness.js' }, devtool: false,
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': root } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: [path.join(__dirname, 'tsx-loader.cjs')] }] },
  };
  await new Promise((resolve, reject) => webpack(config).run((err, stats) => {
    if (err || stats.hasErrors()) reject(err || Error(stats.toString({ all: false, errors: true })));
    else resolve();
  }));
  const bundle=fs.readFileSync(temp+'/harness.js');server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/harness.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(req.url==='/harness.js'?bundle:'<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/harness.js"></script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/desktop/pos';
  browser=await chromium.launch({headless:true});
  async function pageFor({order=hold,idle=true}={}){
   const page=await browser.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>console.error('BROWSER_ERROR',e.message));await page.addInitScript(({order,idle})=>{window.recoveryHold=order;window.recoveryIdle=idle;window.print=()=>{throw Error('UNEXPECTED_PHYSICAL_PRINT')};localStorage.setItem('cashier:deviceId','desktop-cmvyx1jes000208l14t5vf9ur');if(!localStorage.getItem('cashier:holdOrders:ST883DC00C'))localStorage.setItem('cashier:holdOrders:ST883DC00C',JSON.stringify([order]));},{order,idle});return page;
  }
  const button=p=>p.getByRole('button',{name:'恢复入账并打印',exact:true});
  await t.test('selection then one action; repeated synchronous clicks send one financial POST; original raw hold unchanged',async()=>{
   const p=await pageFor();let posts=0;await p.route('**/api/cashier/recovery/diamond-13543',async route=>{if(route.request().method()==='POST'){posts++;await new Promise(r=>setTimeout(r,100));await route.fulfill({json:{state:'COMMITTED_WAITING_PRINT',orderNo:'ISOLATED-ORDER',receiverName:'ISOLATED receiver'}});}else await route.fulfill({json:{state:posts?'COMMITTED_WAITING_PRINT':'READY',orderNo:posts?'ISOLATED-ORDER':undefined}});});await p.goto(url);await p.getByRole('button',{name:'选择原挂单'}).click();await button(p).waitFor();await p.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='恢复入账并打印').disabled);
   const raw=await p.evaluate(()=>localStorage.getItem('cashier:holdOrders:ST883DC00C'));await button(p).evaluate(b=>{b.click();b.click();});await p.getByRole('status').filter({hasText:'已入账'}).waitFor();assert.equal(posts,1);assert.equal(await p.evaluate(()=>localStorage.getItem('cashier:holdOrders:ST883DC00C')),raw);assert(await button(p).isDisabled());await p.close();
  });
  await t.test('lost response freezes; GET READY and page reload cannot re-enable financial POST',async()=>{
   const p=await pageFor();let posts=0;await p.route('**/api/cashier/recovery/diamond-13543',async route=>{if(route.request().method()==='POST'){posts++;await route.abort();}else await route.fulfill({json:{state:'READY'}});});await p.goto(url);await p.getByRole('button',{name:'选择原挂单'}).click();await p.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='恢复入账并打印').disabled);await button(p).click();await p.getByRole('status').filter({hasText:'结果待核实'}).waitFor();await p.getByRole('button',{name:'查询恢复结果'}).click();assert(await button(p).isDisabled());const backup=await p.evaluate(()=>localStorage.getItem('cashier:diamondRecovery:originalBackup:v1'));await p.reload();await p.getByRole('button',{name:'选择原挂单'}).click();await p.getByRole('status').filter({hasText:'结果待核实'}).waitFor();assert(await button(p).isDisabled());assert.equal(posts,1);assert.equal(await p.evaluate(()=>localStorage.getItem('cashier:diamondRecovery:originalBackup:v1')),backup);await p.close();
  });
  await t.test('one known paper witness has separate audit-only action; finance is never repeated',async()=>{
   const p=await pageFor();const actions=[];await p.route('**/api/cashier/recovery/diamond-13543',async route=>{if(route.request().method()==='POST'){const body=route.request().postDataJSON();actions.push(body.action);await route.fulfill({json:{state:body.action==='recover'?'PAPER_CONFIRMABLE':'PAPER_CONFIRMED',orderNo:'ISOLATED-ORDER',receiverName:'ISOLATED receiver'}});}else await route.fulfill({json:{state:'READY'}});});await p.goto(url);await p.getByRole('button',{name:'选择原挂单'}).click();await p.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='恢复入账并打印').disabled);await button(p).click();await p.getByRole('button',{name:'确认已完整出纸一份'}).click();await p.getByRole('status').filter({hasText:'已确认实体出纸'}).waitFor();assert.deepEqual(actions,['recover','confirmPaper']);assert(await button(p).isDisabled());await p.close();
  });
  await t.test('changed cart disables recovery and does not send request',async()=>{
   const changed=structuredClone(hold);changed.cart[0].qty++;const p=await pageFor({order:changed});let calls=0;await p.route('**/api/cashier/recovery/**',async route=>{calls++;await route.abort();});await p.goto(url);await p.getByRole('button',{name:'选择原挂单'}).click();await p.getByRole('status').filter({hasText:'原单校验未通过'}).waitFor();assert(await button(p).isDisabled());assert.equal(calls,0);await p.close();
  });
  await t.test('original alias retained without recovery action; active ordinary basket prevents execution',async()=>{
   const alias=structuredClone(hold);alias.id='fcf89f83-9e1f-4319-a028-df72a0967c38';const p=await pageFor({order:alias});await p.goto(url);await p.getByText('原单证据已保留，请选择原135.43美元挂单').waitFor();assert.equal(await p.locator('button').count(),0);await p.close();
   const q=await pageFor({idle:false});await q.route('**/api/cashier/recovery/**',route=>route.fulfill({json:{state:'READY'}}));await q.goto(url);await q.getByRole('button',{name:'选择原挂单'}).click();await q.getByRole('status').filter({hasText:'请先完成或挂起当前购物车'}).waitFor();assert(await button(q).isDisabled());await q.close();
  });
  await t.test('proved not-accepted response re-arms only local guard; UNKNOWN never does',async()=>{
   const p=await pageFor();let posts=0;await p.route('**/api/cashier/recovery/diamond-13543',async route=>{if(route.request().method()==='POST'){posts++;await route.fulfill({json:posts===1?{state:'BLOCKED_NOT_ACCEPTED',accepted:false}:{state:'COMMITTED_WAITING_PRINT',orderNo:'ISOLATED-ORDER'}});}else await route.fulfill({json:{state:'READY'}});});await p.goto(url);await p.getByRole('button',{name:'选择原挂单'}).click();await p.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='恢复入账并打印').disabled);await button(p).click();await p.getByRole('status').filter({hasText:'等待技术准入'}).waitFor();assert.equal(await p.evaluate(()=>localStorage.getItem('cashier:diamondRecovery:attempt:v1')),null);await p.getByRole('button',{name:'查询恢复结果'}).click();await p.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='恢复入账并打印').disabled);await button(p).click();await p.getByRole('status').filter({hasText:'已入账'}).waitFor();assert.equal(posts,2);await p.close();
  });
  await t.test('old timeout API is unnecessary; absent secure hashing blocks without writing an attempt',async()=>{
   const p=await pageFor();await p.addInitScript(()=>{AbortSignal.timeout=undefined;});await p.route('**/api/cashier/recovery/**',route=>route.fulfill({json:{state:'READY'}}));await p.goto(url);await p.getByRole('button',{name:'选择原挂单'}).click();await p.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='恢复入账并打印').disabled);await p.close();
   const q=await pageFor();await q.addInitScript(()=>Object.defineProperty(crypto,'subtle',{value:undefined}));let requests=0;await q.route('**/api/cashier/recovery/**',route=>{requests++;return route.abort();});await q.goto(url);await q.getByRole('button',{name:'选择原挂单'}).click();await q.getByRole('status').filter({hasText:'浏览器或本地存储未就绪'}).waitFor();assert.equal(requests,0);assert.equal(await q.evaluate(()=>localStorage.getItem('cashier:diamondRecovery:attempt:v1')),null);assert(await button(q).isDisabled());await q.close();
  });
  await t.test('bounded polling stops at two minutes without additional POST or automatic resume',async()=>{
   const p=await pageFor();await p.clock.install();let posts=0;let gets=0;await p.route('**/api/cashier/recovery/**',route=>{if(route.request().method()==='POST'){posts++;return route.fulfill({json:{state:'COMMITTED_WAITING_PRINT',orderNo:'ISOLATED-ORDER'}});}gets++;return route.fulfill({json:{state:posts?'COMMITTED_WAITING_PRINT':'READY'}});});await p.goto(url);await p.getByRole('button',{name:'选择原挂单'}).click();await p.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='恢复入账并打印').disabled);await button(p).click();await p.getByRole('status').filter({hasText:'已入账'}).waitFor();await p.clock.fastForward(121000);await p.getByRole('status').filter({hasText:'结果待核实'}).waitFor();const before=gets;await p.clock.fastForward(20000);assert.equal(gets,before);assert.equal(posts,1);await p.close();
  });
  await t.test('operator paper-problem action never invokes another recover or browser print',async()=>{
   const p=await pageFor();const actions=[];await p.route('**/api/cashier/recovery/**',route=>{if(route.request().method()==='POST'){const body=route.request().postDataJSON();actions.push(body.action);return route.fulfill({json:{state:body.action==='recover'?'COMMITTED_WAITING_PRINT':'UNKNOWN',orderNo:'ISOLATED-ORDER'}});}return route.fulfill({json:{state:'READY'}});});await p.goto(url);await p.getByRole('button',{name:'选择原挂单'}).click();await p.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='恢复入账并打印').disabled);await button(p).click();await p.getByRole('button',{name:'未完整出纸或异常，停止'}).click();await p.getByRole('status').filter({hasText:'结果待核实'}).waitFor();assert.deepEqual(actions,['recover','reportPaperFailure']);assert(await button(p).isDisabled());await p.close();
  });
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(temp)fs.rmSync(temp,{recursive:true,force:true});}
});
