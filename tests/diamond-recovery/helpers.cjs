'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {NextRequest}=require('next/server');
const packageManifest=require('../../lib/diamond-recovery/package-manifest.json');
const {manifest,PACKAGE_SHA,GATE_ID}=require('../../lib/diamond-recovery/controller.cjs');
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const SECRET='ISOLATED-ONECLICK-TEST-SECRET-NEVER-PRODUCTION';
const BASE_ENV={AUTH_SECRET:SECRET,NODE_ENV:'production',VERCEL_ENV:'production',DESKTOP_OPERATOR_BOUNDARY_ENABLED:'1',ESHOP_DISABLE_DEV_HEADERS:'1',VERCEL_GIT_COMMIT_SHA:'1'.repeat(40),VERCEL_DEPLOYMENT_ID:'dpl_ISOLATED_ONECLICK'};
const deviceId='desktop-cmvyx1jes000208l14t5vf9ur';
function sign(payload){const raw=Buffer.from(JSON.stringify(payload)).toString('base64url');return raw+'.'+crypto.createHmac('sha256',SECRET).update(raw).digest('base64url');}
function token(){return sign({v:'pos-device-v1',tenantId:manifest.tenantId,storeId:manifest.storeId,storeCode:manifest.storeCode,deviceId,issuedBy:manifest.approvedActorId,browserPosSessionId:'ISOLATED-ONECLICK-BROWSER',iat:Date.now()});}
const tokenHash=t=>crypto.createHmac('sha256',SECRET).update('browser-pos-device-token:v1:'+t).digest('hex');
function request(t,extra={}){return new NextRequest('http://127.0.0.1/api/cashier/recovery/diamond-13543',{method:'POST',headers:{'content-type':'application/json',origin:'https://elifekh.com','x-lightops-client':'desktop-pos','x-pos-operator-source':'DEVICE','x-pos-device-id':deviceId,'x-pos-device-token':t,...extra}});}
const input=()=>({action:'recover',holdId:manifest.holdId,cartSha256:manifest.cartSha256});
function gateFixture(env,t,now=Date.now()){
 const fixture=JSON.parse(fs.readFileSync(__dirname+'/admission-fixture.json'));const d=fixture.dossier;const docs={};
 const iso=ms=>new Date(now+ms).toISOString();const add=x=>{const raw=typeof x==='string'?x:JSON.stringify(x);const sha256=hash(raw);docs[sha256]={encoding:'base64',data:Buffer.from(raw).toString('base64')};return {path:'/ISOLATED/'+sha256,sha256};};
 const original=Buffer.from(fixture.documents[d.handover.immutableOriginal.sha256].data,'base64').toString();d.handover.immutableOriginal=add(original);
 const baseline=JSON.parse(Buffer.from(fixture.documents[d.handover.baseline.sha256].data,'base64'));baseline.observedAtUtc=iso(-1000);d.handover.baseline=add(baseline);
 const confirmation=JSON.parse(Buffer.from(fixture.documents[d.countersignPlan.confirmationEvidence.sha256].data,'base64'));
 for(const c of Object.values(confirmation.confirmations)) c.atUtc=iso(-1000);
 d.countersignPlan.confirmedAtUtc=iso(-1000);d.countersignPlan.windowStartUtc=iso(-1000);d.countersignPlan.windowEndUtc=iso(600000);
 d.fieldPlan.windowStartUtc=iso(-1000);d.fieldPlan.windowEndUtc=iso(600000);
 Object.assign(confirmation.confirmations.field_preparedness,{windowStartUtc:d.fieldPlan.windowStartUtc,windowEndUtc:d.fieldPlan.windowEndUtc});
 const ref=add(confirmation);d.countersignPlan.confirmationEvidence=ref;d.executor.assignmentEvidence=ref;d.fieldPlan.confirmationEvidence=ref;
 const channel=JSON.parse(Buffer.from(fixture.documents[d.executionChannelProof.sha256].data,'base64'));channel.observedAtUtc=iso(-1000);d.executionChannelProof=add(channel);
 const dossierSha256=hash(d);
 const approval={auditCorrelationId:d.countersignPlan.auditCorrelationId,originalSignedRecordSha256:d.handover.immutableOriginal.sha256,executorIdentifier:d.executor.identifier,executionChannelProofSha256:d.executionChannelProof.sha256,existingDeployedDatabaseRole:'postgres',existingRlsBypassAcknowledged:true,noPermissionChange:true};
 const freshField={dossierSha256,observedAtUtc:iso(-1000),observedBy:d.fieldPlan.coordinatorName,receiverName:d.fieldPlan.receiverName,cashierAndOfflinePaused:true,deploymentsAndMigrationsPaused:true,originalHoldNotResubmitted:true,usb002QueueEmpty:true,paperPresent:true,receiverPresent:true,executorIdentifier:d.executor.identifier,baselineSha256:d.handover.baseline.sha256};
 const doc=x=>add({task:manifest.task,releaseSha:env.VERCEL_GIT_COMMIT_SHA,...x});
 const governance={
 founder:doc({schema:'diamond-founder-decision/1',sharedAuthSecretTrustRiskAcknowledged:true,existingBypassRlsRiskAcknowledged:true,dossierSha256,executorIdentifier:d.executor.identifier,receiverName:d.fieldPlan.receiverName,fieldWindowStartUtc:d.fieldPlan.windowStartUtc,fieldWindowEndUtc:d.fieldPlan.windowEndUtc,disposition:'APPROVED',decisionReference:'ISOLATED-FOUNDER-FIXTURE',deploymentId:env.VERCEL_DEPLOYMENT_ID,packageSha256:PACKAGE_SHA,idempotencyKey:manifest.key,actions:['ACTIVATE_THIS_EXACT_RECOVERY_GATE','ONE_WHOLE_CASH_BOOKKEEPING_RECOVERY','ONE_ORIGINAL_FRONT_PRINT','NO_NEW_CASH_OR_INVENTORY_DEDUCTION']}),
 review:doc({schema:'diamond-independent-review/1',result:'PASS',packageSha256:PACKAGE_SHA,unresolvedSafetyFindings:[]}),
 lineage:doc({schema:'diamond-release-lineage/1',result:'PASS',mode:'STRICT',safeDevelopmentBase:true,sourceMappingComplete:true,trustedMainSha:'3'.repeat(40)}),
 scope:doc({schema:'diamond-scope/1',result:'PASS',authorizationStatus:'ACTIVE',trustedMainSha:'3'.repeat(40),authorizedPaths:['app/cashier/page.tsx','app/api/cashier/recovery/diamond-13543/route.ts']}),
 sourceParity:doc({schema:'diamond-source-parity/1',result:'PASS',frozenSourceCommit:packageManifest.productionSha,comparedPathsSha256:hash(packageManifest.sourceHashes),sourceHashes:packageManifest.sourceHashes}),
 };
 return {governance,frozenSourceCommit:packageManifest.productionSha,canonicalOrigin:'https://elifekh.com',status:'FOUNDER_APPROVED',task:manifest.task,packageSha256:PACKAGE_SHA,releaseSha:env.VERCEL_GIT_COMMIT_SHA,deploymentId:env.VERCEL_DEPLOYMENT_ID,databaseUrlSha256:hash(env.DATABASE_URL),authBoundary:env.DESKTOP_OPERATOR_BOUNDARY_ENABLED,backupSha256:'f441511946d35aad6320f0528ba744e5193fe88c2609e89229ee14120e46ddd2',cartSha256:manifest.cartSha256,idempotencyKey:manifest.key,actorUserId:manifest.approvedActorId,founderDecisionReference:'ISOLATED-FOUNDER-FIXTURE',candidateReviewReference:'ISOLATED-REVIEW-FIXTURE',lineageAndScopeEvidenceReference:'ISOLATED-GOVERNANCE-FIXTURE',issuedAtUtc:iso(-1000),expiresAtUtc:iso(600000),documents:docs,dossier:d,dossierSha256,freshField,approval,triggerDeviceId:deviceId,deviceTokenHash:tokenHash(t),receiverName:d.fieldPlan.receiverName,executorIdentifier:d.executor.identifier,allowedTriggerUserIds:[manifest.approvedActorId],noPermissionChange:true,existingRlsBypassAcknowledged:true,cashCollectedDate:'2026-11-20',businessDate:'2026-11-20',recoveryDayNewCashCents:0};
}
function gateRow(g){const payload=JSON.stringify(g);return {id:GATE_ID,tenantId:manifest.tenantId,storeId:manifest.storeId,userId:manifest.approvedActorId,actionType:manifest.task+':GATE',targetType:'DIAMOND_RECOVERY_CASE',targetId:manifest.holdId,status:'SUCCESS',payloadSnapshot:{payload,signature:crypto.createHmac('sha256',SECRET).update('diamond-recovery-gate:v1\n'+payload).digest('hex')}};}
module.exports={hash,SECRET,BASE_ENV,deviceId,sign,token,tokenHash,request,input,gateFixture,gateRow};
