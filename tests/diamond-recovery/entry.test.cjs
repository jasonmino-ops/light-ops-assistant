'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {verifyGate,validateInput,PACKAGE_SHA}=require('../../lib/diamond-recovery/controller.cjs');
const {BASE_ENV,token,input,gateFixture,gateRow}=require('./helpers.cjs');
const env={...BASE_ENV,DATABASE_URL:'postgresql://postgres@127.0.0.1:56431/native_inventory_test_oneclick'};
const now=Date.parse('2026-11-21T10:00:00Z');
function valid(){return gateFixture(env,token(),now);}
function bindFounderDossier(g){const {hash}=require('./helpers.cjs');const d=JSON.parse(Buffer.from(g.documents[g.governance.founder.sha256].data,'base64'));Object.assign(d,{dossierSha256:g.dossierSha256,executorIdentifier:g.executorIdentifier,receiverName:g.receiverName,fieldWindowStartUtc:g.dossier.fieldPlan.windowStartUtc,fieldWindowEndUtc:g.dossier.fieldPlan.windowEndUtc});const raw=JSON.stringify(d),h=hash(raw);g.documents[h]={encoding:'base64',data:Buffer.from(raw).toString('base64')};g.governance.founder={sha256:h};}
test('server package regenerates byte-identically and has no local-workspace runtime dependency',()=>{
 const dir=path.resolve(__dirname,'../../lib/diamond-recovery');const names=['packaged-core.cjs','packaged-admission.cjs','package-manifest.json'];const before=names.map(n=>fs.readFileSync(path.join(dir,n),'utf8'));
 cp.execFileSync(process.execPath,['scripts/diamond-recovery/package-core.cjs'],{cwd:path.resolve(__dirname,'../..')});names.forEach((n,i)=>assert.equal(fs.readFileSync(path.join(dir,n),'utf8'),before[i]));
 assert(!before[0].includes('/Users/')&&!before[0].includes('/private/tmp/')&&!before[0].includes('transpileModule')&&!before[0].includes('dotenv'));
 const p=JSON.parse(before[2]);assert.equal(Object.keys(p.sourceHashes).length,21);assert.equal(p.parent17BundleSha256,'14a4f36f7847b73b37bbaf46b7fb6e5d8fce0d920f122766205b7d6d66234a4e');
});
test('source/cart backups intact and original 17 results reused',()=>{
 const {hash}=require('./helpers.cjs');const root=path.resolve(__dirname,'../..');assert.equal(hash(fs.readFileSync(root+'/lib/diamond-recovery/frozen/held-orders.json').toString()),'f441511946d35aad6320f0528ba744e5193fe88c2609e89229ee14120e46ddd2');
 const results=JSON.parse(fs.readFileSync(root+'/docs/incidents/es-diamond-whole-order-recovery-01/tests.json'));assert.equal(results.results.length,17);assert(results.results.every(x=>x.status==='PASS'));
});
test('exact original hold only; caller cannot supply price/date/approval/actor or force recovery',()=>{
 validateInput(input());validateInput({...input(),action:'confirmPaper',paperComplete:true,receiverAcknowledged:true,receiverName:'阿明'});for(const change of [{holdId:'other'},{cartSha256:'0'.repeat(64)},{price:135.43},{businessDate:'2026-11-21'},{FOUNDER_APPROVED:true},{actorUserId:'other'},{action:'retry'}]) assert.throws(()=>validateInput({...input(),...change}));
});
test('complete signed server permit and embedded immutable admission evidence pass',()=>{const g=valid();const out=verifyGate(gateRow(g),env,now);assert.equal(out.link.receiverName,'ISOLATED receiver');assert.equal(out.link.packageSha256,PACKAGE_SHA);});
for(const [name,mutate] of [
 ['missing signed original',g=>{g.dossier.handover.immutableOriginal.sha256='0'.repeat(64)}],
 ['missing countersign responsible',g=>{g.dossier.countersignPlan.responsibleName=null}],
 ['missing field paper readiness',g=>{g.dossier.fieldPlan.paperReadyDeclared=false}],
 ['tampered document bytes',g=>{Object.values(g.documents)[0].data=Buffer.from('tampered').toString('base64')}],
 ['wrong release',g=>{g.releaseSha='2'.repeat(40)}],
 ['wrong package',g=>{g.packageSha256='0'.repeat(64)}],
 ['wrong runtime DB',g=>{g.databaseUrlSha256='0'.repeat(64)}],
 ['no Founder decision',g=>{g.founderDecisionReference='PENDING'}],
 ['stale field',g=>{g.freshField.observedAtUtc=new Date(now-121000).toISOString()}],
 ['prefilled physical print',g=>{g.dossier.physicalPrintResult='printed'}],
 ['expired Gate',g=>{g.expiresAtUtc=new Date(now-1).toISOString()}],
]) test('reject '+name,()=>{const g=valid();mutate(g);g.dossierSha256=require('./helpers.cjs').hash(g.dossier);g.freshField.dossierSha256=g.dossierSha256;bindFounderDossier(g);assert.throws(()=>verifyGate(gateRow(g),env,now));});
test('reject missing/forged signature and TTL expiry',()=>{const g=valid();assert.throws(()=>verifyGate(null,env,now));const row=gateRow(g);row.payloadSnapshot.signature='0'.repeat(64);assert.throws(()=>verifyGate(row,env,now));assert.throws(()=>verifyGate(gateRow(g),env,Date.parse('2026-11-21T16:13:00Z')));});
test('packaged auth issuance disabled; module scopes never share db or accounting clock',async()=>{
 const {loader}=require('../../lib/diamond-recovery/packaged-core.cjs');const a={id:'a'},b={id:'b'};const la=loader(a),lb=loader(b);
 assert.notEqual(la.load('lib/desktop-pos-auth.ts'),lb.load('lib/desktop-pos-auth.ts'));assert.throws(()=>la.load('lib/session.ts').signSession({}));assert.throws(()=>la.load('lib/desktop-pos-auth.ts').signPosDeviceToken({}));assert.throws(()=>la.load('lib/desktop-pos-auth.ts').issuePosDeviceSession({}));
 assert.equal(new Date().getFullYear(),2026);
});
for(const which of ['founder','review','lineage','scope','sourceParity'])test('reject signed but non-passing '+which+' document, not merely its pointer',()=>{
 const {hash}=require('./helpers.cjs');const g=valid();const ref=g.governance[which];const d=JSON.parse(Buffer.from(g.documents[ref.sha256].data,'base64'));if(which==='founder')d.disposition='BLOCKED';else d.result='BLOCKED';const raw=JSON.stringify(d);const h=hash(raw);g.documents[h]={encoding:'base64',data:Buffer.from(raw).toString('base64')};g.governance[which]={sha256:h};assert.throws(()=>verifyGate(gateRow(g),env,now));
});
test('auth input enforces read-only capabilities; packaged exports and external modules cannot mint cookies/tokens',async()=>{
 const {readonlyDatabase}=require('../../lib/diamond-recovery/guards.cjs');const ro=readonlyDatabase({user:{findFirst:async()=>({id:'read'}),create:()=>{throw Error('should not run');}},$transaction:()=>{throw Error('should not run');}});assert.equal((await ro.user.findFirst()).id,'read');assert.throws(()=>ro.user.create());assert.throws(()=>ro.$transaction());
 const p=require('../../lib/diamond-recovery/package-manifest.json');assert.deepEqual(p.authExports['lib/session.ts'],['verifySession']);assert(!p.authExports['lib/desktop-pos-auth.ts'].includes('issuePosDeviceSession'));assert.equal(p.clockDomains['app/api/cashier/sales/route.ts'].clock,'APPROVED_NOV20_BUSINESS_ANCHOR');assert(Object.entries(p.clockDomains).filter(([k])=>k!=='app/api/cashier/sales/route.ts').every(([,v])=>v.clock==='REAL_EXECUTION_TIME'));
});
test('read-only source parity checks all 21 real current-tree dependencies against frozen source commit',()=>{
 const raw=cp.execFileSync(process.execPath,['scripts/diamond-recovery/package-core.cjs','--check-tree','.'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'});const d=JSON.parse(raw);assert.equal(d.result,'PASS');assert.equal(Object.keys(d.sourceHashes).length,21);assert.equal(d.frozenSourceCommit,'b0aa38a1d1bf4d1aa0f375f1c42da6e4436dc481');
});

for(const [key,value]of [['sharedAuthSecretTrustRiskAcknowledged',false],['existingBypassRlsRiskAcknowledged',false],['executorIdentifier','OTHER-EXECUTOR'],['receiverName','OTHER-RECEIVER'],['fieldWindowEndUtc','2026-11-21T15:00:00Z']])test('Founder decision must acknowledge/bind '+key,()=>{const {hash}=require('./helpers.cjs');const g=valid();const d=JSON.parse(Buffer.from(g.documents[g.governance.founder.sha256].data,'base64'));d[key]=value;const raw=JSON.stringify(d),h=hash(raw);g.documents[h]={encoding:'base64',data:Buffer.from(raw).toString('base64')};g.governance.founder={sha256:h};assert.throws(()=>verifyGate(gateRow(g),env,now));});
test('operational permission window stops thirty minutes before original immutable print TTL',()=>{const late=Date.parse('2026-11-21T15:35:00Z');const g=gateFixture(env,token(),late);assert.throws(()=>verifyGate(gateRow(g),env,late),/STOP_OPERATIONAL_CUTOFF/);});
