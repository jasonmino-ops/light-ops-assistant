'use strict';
// Server-only, case-specific dispatcher. No activation endpoint, retries or auth issuance.
const assert = require('node:assert/strict');
const {createHash,createHmac,timingSafeEqual} = require('node:crypto');
const {NextRequest} = require('next/server');
const {loader} = require('./packaged-core.cjs');
const {readonlyDatabase,verifyGovernance}=require('./guards.cjs');
const {readDayTotals,createAdmissionVerifier} = require('./packaged-admission.cjs');
const core = require('./frozen/recovery-candidate.cjs');
const clock = require('./frozen/accounting-clock.cjs');
const packageManifest = require('./package-manifest.json');
const holds = require('./frozen/held-orders.json');
const manifest = core.seal(holds[0]);
const sha = x => createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const PACKAGE_SHA = sha(packageManifest);
const SCOPE = {tenantId:manifest.tenantId,storeId:manifest.storeId};
const GATE_ID = 'diamond:13543:gate:v1';
const FENCE_ID = 'diamond:13543:accepted:v1';
const STOP_ID = 'diamond:13543:unknown:v1';
const VERIFY_ID = 'diamond:13543:reconciled:v1';
const WITNESS_ID = 'diamond:13543:paper:v1';
const CURRENT_HOLD_ID = '076c9f3c-2d62-45f1-a7f4-f1dc6deec429';
const HOLD_IDS = [manifest.holdId,clock.ORIGINAL_FIRST_HOLD_ID,'900fe73a-fd96-4610-8e05-6c8cda3a2d17'];
HOLD_IDS.push('642ac3b8-3234-4cd9-86b8-dae9d0338ea4');
HOLD_IDS.push(CURRENT_HOLD_ID);
const dataFor = (id,action,payload,userId=manifest.approvedActorId) => ({id,...SCOPE,userId,actionType:action,targetType:'DIAMOND_RECOVERY_CASE',targetId:manifest.holdId,requestId:core.KEY,status:'SUCCESS',payloadSnapshot:payload});
function validRef(value) { assert(typeof value==='string'&&value.length>=8&&!/UNKNOWN|PENDING|TBD/i.test(value),'STOP_REFERENCE_MISSING'); }
function validateInput(input) {
 assert(input&&typeof input==='object'&&!Array.isArray(input),'STOP_BAD_INPUT');
 assert(input.holdId===manifest.holdId||input.holdId===CURRENT_HOLD_ID,'STOP_WRONG_HOLD');
 assert.equal(input.cartSha256,manifest.cartSha256,'STOP_CART_CHANGED');
 assert(['recover','confirmPaper','reportPaperFailure'].includes(input.action),'STOP_BAD_ACTION');
 assert.equal(Object.keys(input).sort().join(','), input.action==='confirmPaper'?'action,cartSha256,holdId,paperComplete,receiverAcknowledged,receiverName':'action,cartSha256,holdId','STOP_EXTRA_INPUT');
 if(input.action==='confirmPaper'){assert.equal(input.paperComplete,true);assert.equal(input.receiverAcknowledged,true);assert(typeof input.receiverName==='string'&&input.receiverName.trim().length>0&&input.receiverName.length<=120&&!/UNKNOWN|PENDING|TBD/i.test(input.receiverName),'STOP_RECEIVER_NAME');}
}
function verifyGate(row,env,now) {
 assert(row&&row.tenantId===SCOPE.tenantId&&row.storeId===SCOPE.storeId&&row.id===GATE_ID,'STOP_GATE_DISABLED');
 const sealed=row.payloadSnapshot; assert(sealed&&typeof sealed.payload==='string'&&sealed.payload.length<12*1024*1024,'STOP_GATE_FORMAT');
 assert(typeof env.AUTH_SECRET==='string'&&env.AUTH_SECRET.length>=24&&env.AUTH_SECRET!=='dev-secret-change-in-production','STOP_AUTH_SECRET');
 const signature=createHmac('sha256',env.AUTH_SECRET).update('diamond-recovery-gate:v1\n'+sealed.payload).digest('hex');
 assert(typeof sealed.signature==='string'&&/^[a-f0-9]{64}$/.test(sealed.signature)&&timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(sealed.signature,'hex')),'STOP_GATE_SIGNATURE');
 const g=JSON.parse(sealed.payload);
 assert.equal(g.status,'FOUNDER_APPROVED'); assert.equal(g.task,core.TASK);assert.equal(g.packageSha256,PACKAGE_SHA);
 assert.equal(g.releaseSha,env.VERCEL_GIT_COMMIT_SHA);assert(/^[a-f0-9]{40}$/.test(g.releaseSha));
 assert.equal(g.deploymentId,env.VERCEL_DEPLOYMENT_ID);validRef(g.deploymentId);
 assert.equal(g.databaseUrlSha256,sha(env.DATABASE_URL||''),'STOP_DATABASE_BINDING');
 assert.equal(g.authBoundary,env.DESKTOP_OPERATOR_BOUNDARY_ENABLED??null,'STOP_AUTH_BOUNDARY');
 assert.equal(env.NODE_ENV,'production'); assert.equal(env.VERCEL_ENV,'production');
 assert.equal(g.backupSha256,'f441511946d35aad6320f0528ba744e5193fe88c2609e89229ee14120e46ddd2');
 assert.equal(g.cartSha256,manifest.cartSha256);assert.equal(g.idempotencyKey,core.KEY);assert.equal(g.actorUserId,manifest.approvedActorId);
 validRef(g.founderDecisionReference);validRef(g.candidateReviewReference);validRef(g.lineageAndScopeEvidenceReference);
 const issued=Date.parse(g.issuedAtUtc), expires=Date.parse(g.expiresAtUtc);
 const operationalCutoff=Date.parse(clock.PRINT_EXPIRES_AT)-30*60000;
 assert(expires<=operationalCutoff&&Date.parse(g.dossier?.fieldPlan?.windowEndUtc)<=operationalCutoff,'STOP_OPERATIONAL_CUTOFF');
 assert(issued<=now&&now<expires&&expires-issued<=4*3600000,'STOP_GATE_EXPIRED');
 assert(now+clock.PRINT_BUDGET_MS<Date.parse(clock.PRINT_EXPIRES_AT),'STOP_ORIGINAL_PRINT_TTL');
 assert(g.documents&&g.dossier&&g.freshField,'STOP_ADMISSION_EVIDENCE_MISSING');
 const governance=verifyGovernance(g,packageManifest,PACKAGE_SHA);
 const verifier=createAdmissionVerifier(g.documents);
 const dossierSha=sha(JSON.stringify(g.dossier));
 assert.equal(g.dossierSha256,dossierSha);
 const approval={...g.approval,handoverDossierSha256:dossierSha};
 const link=verifier.verifyEvidence(g.dossier,{now,runtime:true,approval,dossierSha256:dossierSha,freshEvidence:g.freshField});
 assert.equal(g.triggerDeviceId,'desktop-cmvyx1jes000208l14t5vf9ur');assert(/^[a-f0-9]{64}$/.test(g.deviceTokenHash),'STOP_DEVICE_TOKEN_BINDING');
 assert.equal(g.receiverName,link.receiverName);assert.equal(g.executorIdentifier,link.executorIdentifier);
 assert(Array.isArray(g.allowedTriggerUserIds)&&g.allowedTriggerUserIds.length>0);g.allowedTriggerUserIds.forEach(validRef);
 assert.equal(g.noPermissionChange,true);assert.equal(g.existingRlsBypassAcknowledged,true);
 assert.equal(g.cashCollectedDate,'2026-11-20');assert.equal(g.businessDate,'2026-11-20');assert.equal(g.recoveryDayNewCashCents,0);
 return {signedRow:row,gate:g,link:{...link,...governance,handoverDossierSha256:dossierSha,gateSha256:sha(sealed.payload),packageSha256:PACKAGE_SHA,releaseSha:g.releaseSha,deploymentId:g.deploymentId},verifier};
}
function createController(db,{env=process.env,now=()=>Date.now()}={}) {
 async function authenticate(req) {
  assert(typeof env.AUTH_SECRET==='string'&&env.AUTH_SECRET.length>=24&&env.AUTH_SECRET!=='dev-secret-change-in-production','STOP_AUTH_CONFIGURATION');
  assert.equal(env.AUTH_SECRET,process.env.AUTH_SECRET,'STOP_AUTH_RUNTIME_MISMATCH');
  assert.equal(req.headers.get('x-lightops-client'),'desktop-pos','STOP_DESKTOP_ONLY');
  // Actual existing terminal credential is required even when ACCOUNT is selected.
  const m=loader(readonlyDatabase(db)), auth=m.load('lib/desktop-pos-auth.ts');
  const device=await auth.authorizeDesktopPosDevice(req,{...SCOPE,storeCode:manifest.storeCode});
  assert(device.ok,'STOP_DEVICE_AUTH');assert.equal(device.payload.deviceId,'desktop-cmvyx1jes000208l14t5vf9ur');
  assert.equal(device.authorization.operatorUserId,manifest.approvedActorId,'STOP_EXECUTOR_CHANGED');
  const account=await auth.authorizeDesktopPosAccount(req,{...SCOPE,storeCode:manifest.storeCode});
  // An invalid selected account cannot silently become a device trigger.
  if(req.headers.get('x-pos-operator-source')==='ACCOUNT') assert(account,'STOP_ACCOUNT_AUTH');
  return {triggerUserId:account?.operatorUserId??device.authorization.operatorUserId,deviceId:device.payload.deviceId,executorUserId:device.authorization.operatorUserId,source:account?'ACCOUNT':'DEVICE',tokenHash:auth.hashPosDeviceToken(req.headers.get('x-pos-device-token'))};
 }
 const read=id=>db.operationLog.findUnique({where:{id}});
 async function admit(identity) {
  const checked=verifyGate(await read(GATE_ID),env,now());
  assert(checked.gate.allowedTriggerUserIds.includes(identity.triggerUserId),'STOP_TRIGGER_NOT_ALLOWED');assert.equal(checked.gate.deviceTokenHash,identity.tokenHash,'STOP_TERMINAL_TOKEN_CHANGED');
  return checked;
 }
 async function freeze(reason,userId=manifest.approvedActorId) {
  try {await db.operationLog.create({data:{...dataFor(STOP_ID,core.TASK+':UNKNOWN',{state:'UNKNOWN',reason,observedAt:new Date(now()).toISOString(),noResubmit:true,operatorReportIsNotHardwareProof:true},userId),status:'FAILED'}});} catch { /* Existing stop or DB uncertainty: never retry a write. */ }
 }
 async function outcome(identity) {
  const [fence,stop]=await Promise.all([read(FENCE_ID),read(STOP_ID)]);
  if(stop) return {state:'UNKNOWN',reason:'STOP_REQUIRES_TECHNICAL_REVIEW'};
  const found=await core.inspectOutcome(db,manifest);
  if(found.disposition!=='COMMITTED_DO_NOT_RESUBMIT') {
   if(fence) return {state:now()-fence.createdAt.getTime()<90000?'PROCESSING':'UNKNOWN',reason:'DO_NOT_RESUBMIT'};
   // A historical key, audit, print or matching payment is a stop, never READY.
   const known=await db.cashierSaleIdempotency.count({where:{...SCOPE,idempotencyKey:{in:[core.KEY,'cf59aa5d-1423-45d9-82dd-ef7ba9c7e723','34d77b09-7dbe-42cf-a2ca-0de0ab2f9c10','1e0ed2af-0049-4d3a-b7df-b036e47a7e6f']}}});
   if(known) return {state:'UNKNOWN',reason:'PRIOR_REQUEST_REQUIRES_REVIEW'};
   try {const checked=await admit(identity);await preflight(checked);return {state:'READY'};} catch {return {state:'BLOCKED',reason:'WAITING_FOR_TECHNICAL_ADMISSION'};}
  }
  // A committed original must be linked to THIS durable attempt, never adopted silently.
  if(!fence) return {state:'UNKNOWN',reason:'UNLINKED_COMMIT'};
  const job=await db.eshopTrayPrintJob.findUnique({where:{id:found.printJobId}});
  const base={orderNo:found.orderNo,printJobId:found.printJobId,amountCents:13543,lineCount:54,sellingUnits:92,businessDate:'2026-11-20',newCashCents:0,receiverName:fence.payloadSnapshot.receiverName};
  if(!job||job.maxAttempts!==1||job.schemaVersion!==3||!job.expiresAt||(now()>job.expiresAt.getTime()&&job.status!=='SUCCEEDED')||['FAILED','EXPIRED'].includes(job.status)||(['CLAIMED','EXECUTING'].includes(job.status)&&(!job.leaseExpiresAt||job.leaseExpiresAt.getTime()<=now()))||['CROSSING_UNKNOWN','UNKNOWN'].includes(job.resultStatus)||['CROSSING_UNKNOWN','UNKNOWN'].includes(job.effectBoundary)) return {...base,state:'UNKNOWN',reason:'PRINT_STOP_NO_RETRY'};
  if(job.status==='SUCCEEDED'&&(!job.completedAt||job.resultStatus!=='CROSSED'||job.effectBoundary!=='CROSSED')) return {...base,state:'UNKNOWN',reason:'PRINT_TERMINAL_UNPROVED'};
  const verified=await read(VERIFY_ID);
  if(!verified) return {...base,state:now()-fence.createdAt.getTime()<90000?'PROCESSING':'UNKNOWN',reason:'RECONCILIATION_NOT_PROVED'};
  if(verified.payloadSnapshot?.gateSha256!==fence.payloadSnapshot?.gateSha256||verified.payloadSnapshot?.printJobId!==job.id||verified.payloadSnapshot?.orderNo!==found.orderNo||verified.payloadSnapshot?.yesterdaySaleDeltaCents!==13543||verified.payloadSnapshot?.yesterdayCashSaleDeltaCents!==13543||verified.payloadSnapshot?.recoveryDaySaleDeltaCents!==0||verified.payloadSnapshot?.recoveryDayCashSaleDeltaCents!==0) return {...base,state:'UNKNOWN'};
  const witness=await read(WITNESS_ID);
  if(witness) {
   if(witness.payloadSnapshot?.orderNo!==found.orderNo||witness.payloadSnapshot?.printJobId!==job.id) return {...base,state:'UNKNOWN'};
   return {...base,state:'PAPER_CONFIRMED'};
  }
  if(job.status==='SUCCEEDED'&&job.completedAt&&job.resultStatus==='CROSSED'&&job.effectBoundary==='CROSSED') return {...base,state:'PAPER_CONFIRMABLE'};
  return {...base,state:'COMMITTED_WAITING_PRINT'};
 }
 async function preflight(checked) {
  await checked.verifier.verifyCurrentBaseline(db,checked.link.baselineExpected);
  const role=await db.$queryRaw`SELECT current_user AS name,r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user`;
  assert.equal(role[0]?.name,'postgres');assert.equal(role[0].rolsuper,false);assert.equal(role[0].rolbypassrls,true);
  const device=await db.desktopDevice.findFirst({where:{...SCOPE,id:'cmvyx1jes000208l14t5vf9ur',status:'ACTIVE'}});assert(device,'STOP_DESKTOP_DISABLED');
  const cp=await db.v3PrintControlPlane.findUnique({where:{storeId:SCOPE.storeId}});
  assert(cp&&cp.mode==='V3_ACTIVE'&&cp.ownerDeviceId===device.id&&cp.ownerEpoch===2&&cp.leaseExpiresAt?.getTime()>now(),'STOP_PRINT_OWNER');
  assert.equal(await db.eshopTrayPrintJob.count({where:{...SCOPE,createdAt:{gte:new Date('2026-11-19T17:00:00Z')},status:{not:'SUCCEEDED'}}}),0,'STOP_UNCERTAIN_PRINT');
  const date=new Date(now()+7*3600000).toISOString().slice(0,10);const start=Date.parse(date+'T00:00:00+07:00');
  assert.notEqual(date,'2026-11-20','STOP_RECOVERY_DAY_COLLIDES');
  const fromUtc=new Date(start).toISOString(),toUtc=new Date(start+86400000).toISOString();
  return {date,fromUtc,toUtc,totals:await readDayTotals(db,fromUtc,toUtc)};
 }
 function assertWitnessIdentity(fence,identity){assert(fence&&fence.payloadSnapshot.allowedTriggerUserIds.includes(identity.triggerUserId),'STOP_WITNESS_IDENTITY');assert.equal(identity.tokenHash,fence.payloadSnapshot.tokenHash,'STOP_ORIGINAL_WITNESS_CREDENTIAL');}
 async function execute(req,input) {
  validateInput(input);const identity=await authenticate(req);
  if(input.action==='reportPaperFailure'){const fence=await read(FENCE_ID);assertWitnessIdentity(fence,identity);await freeze('OPERATOR_REPORTED_INCOMPLETE_MISSING_OR_DUPLICATE_PAPER',identity.triggerUserId);return {state:'UNKNOWN',reason:'PAPER_FAILURE_RECORDED_NO_REPRINT'};}
  if(input.action==='confirmPaper') {
   const status=await outcome(identity);assert(['PAPER_CONFIRMABLE','PAPER_CONFIRMED'].includes(status.state),'STOP_PAPER_NOT_CONFIRMABLE');
   const fence=await read(FENCE_ID);assert(fence?.payloadSnapshot?.receiverName,'STOP_RECEIVER_MISSING');
   assertWitnessIdentity(fence,identity);assert.equal(input.receiverName,fence.payloadSnapshot.receiverName,'STOP_WRONG_RECEIVER');
   if(status.state==='PAPER_CONFIRMED') return status;
   try {await db.operationLog.create({data:dataFor(WITNESS_ID,core.TASK+':PAPER_WITNESS',{orderNo:status.orderNo,printJobId:status.printJobId,receiverName:fence.payloadSnapshot.receiverName,triggerUserId:identity.triggerUserId,confirmedAt:new Date(now()).toISOString(),operatorAttestedOneCompleteOriginalFrontCopy:true,receiverAcknowledged:true,physicalVerificationBySystem:false,countersignature:'PENDING_SEPARATE_HANDOVER_SUPPLEMENT'},identity.triggerUserId)});} catch(e) {if(e.code!=='P2002')throw e;}
   return outcome(identity);
  }
  if(await read(STOP_ID)) return {state:'UNKNOWN',reason:'STOP_REQUIRES_TECHNICAL_REVIEW'};
  if(await read(FENCE_ID)) return outcome(identity);
  let checked,recoveryDayBefore;try{checked=await admit(identity);recoveryDayBefore=await preflight(checked);}catch{
   // This request has not reached the durable INSERT or business route. Only
   // proved absence permits a known-not-accepted response. Any uncertain read stops.
   if(await read(FENCE_ID)||await read(STOP_ID))return outcome(identity);
   return {state:'BLOCKED_NOT_ACCEPTED',accepted:false,reason:'TECHNICAL_ADMISSION_REQUIRED'};
  }
  // A distinct durable PK is committed BEFORE the sole financial invocation.
  // Losing this response, crash, rollback, failed print: no path ever deletes it.
  try {await db.operationLog.create({data:dataFor(FENCE_ID,core.TASK+':ACCEPTED',{...checked.link,...identity,recoveryDayBefore,receiverName:checked.gate.receiverName,allowedTriggerUserIds:checked.gate.allowedTriggerUserIds,startedAt:new Date(now()).toISOString(),state:'ACCEPTED_NO_RETRY',originalHoldIds:HOLD_IDS,selectedHoldId:input.holdId},identity.triggerUserId)});} catch(e) {
   if(e.code==='P2002')return outcome(identity);
   // An uncertain INSERT may already have committed. Never enter the core.
   await freeze('ACCEPTANCE_RESULT_UNKNOWN');return {state:'UNKNOWN',reason:'UNKNOWN_ACCEPTANCE_STOP_NO_RETRY'};
  }
  try {
   const assertWindow=()=>{verifyGate(checked.signedRow,env,now());};
   // Re-read the actual signed permit immediately before executing, not a client flag.
   const fresh=await admit(identity);assert.equal(fresh.link.gateSha256,checked.link.gateSha256,'STOP_GATE_CHANGED');
   let enqueue;
   const facade=core.createRecoveryDatabase(db,manifest,{recoveryEvidence:{...checked.link,...identity,recoveryDayBefore},assertExecutionWindow:assertWindow,enqueuePrint:(...args)=>enqueue(...args)});
   const modules=loader(facade);enqueue=modules.load('lib/es-tray-relay/cashier-network-producer.ts').enqueueCashierNetworkJobs;
   // The original device executor is selected server-side after both trigger and
   // exact device authority passed. No account cookie or manufactured token.
   const headers=new Headers({'content-type':'application/json','idempotency-key':core.KEY,'x-lightops-client':'desktop-pos','x-pos-operator-source':'DEVICE','x-pos-device-id':identity.deviceId,'x-pos-device-token':req.headers.get('x-pos-device-token')});
   const request=new NextRequest(new URL('/api/cashier/sales',req.url),{method:'POST',headers,body:JSON.stringify(manifest.payload)});
   const response=await core.runSealedRequest(modules.load('app/api/cashier/sales/route.ts').POST,request,manifest);
   if(response.status!==201) {await freeze('ORIGINAL_CORE_RETURNED_NON_SUCCESS');return {state:'UNKNOWN',reason:'STOP_NO_RETRY'};}
   const proved=await core.inspectOutcome(db,manifest);if(proved.disposition!=='COMMITTED_DO_NOT_RESUBMIT'){await freeze('COMMIT_NOT_PROVED');return {state:'UNKNOWN'};}
   const expected=checked.link.baselineExpected;
   await checked.verifier.verifyCurrentBaseline(db,{saleCents:expected.saleCents+13543,cashSaleCents:expected.cashSaleCents+13543,orderCount:expected.orderCount+1});
   const recoveryDayAfter=await readDayTotals(db,recoveryDayBefore.fromUtc,recoveryDayBefore.toUtc);
   assert.deepEqual(recoveryDayAfter,recoveryDayBefore.totals,'STOP_RECOVERY_DAY_TOTAL_CHANGED');
   await db.operationLog.create({data:dataFor(VERIFY_ID,core.TASK+':RECONCILED',{orderNo:proved.orderNo,printJobId:proved.printJobId,gateSha256:checked.link.gateSha256,verifiedAt:new Date(now()).toISOString(),yesterdayBefore:expected,yesterdaySaleDeltaCents:13543,yesterdayCashSaleDeltaCents:13543,recoveryDayBefore,recoveryDayAfter,recoveryDaySaleDeltaCents:0,recoveryDayCashSaleDeltaCents:0,newPhysicalCashCents:0,manualInventoryUnchanged:true})});
   return outcome(identity);
  } catch {await freeze('EXECUTION_OR_RESULT_UNKNOWN');return {state:'UNKNOWN',reason:'STOP_NO_RETRY'};}
 }
 return {authenticate,status:outcome,execute};
}
module.exports={createController,verifyGate,validateInput,PACKAGE_SHA,GATE_ID,FENCE_ID,STOP_ID,WITNESS_ID,VERIFY_ID,manifest};
