'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const ORIGIN='https://elifekh.com';
function readonlyDatabase(db) {
 const reads=new Set(['findUnique','findUniqueOrThrow','findFirst','findFirstOrThrow','findMany','count','aggregate','groupBy']);
 return new Proxy(db,{get(target,key){const model=target[key];if(typeof model==='function')return ()=>{throw Error('AUTH_DATABASE_WRITE_FORBIDDEN');};if(!model||typeof model!=='object')return model;return new Proxy(model,{get(delegate,name){const value=delegate[name];if(typeof value!=='function')return value;if(!reads.has(name))return ()=>{throw Error('AUTH_DATABASE_WRITE_FORBIDDEN');};return value.bind(delegate);}});}});
}
function document(documents,ref) {
 assert(ref&&/^[a-f0-9]{64}$/.test(ref.sha256),'STOP_GOVERNANCE_REFERENCE');const item=documents?.[ref.sha256];assert(item?.encoding==='base64'&&typeof item.data==='string');const bytes=Buffer.from(item.data,'base64');assert(bytes.length<=4*1024*1024&&bytes.toString('base64')===item.data);assert.equal(sha(bytes.toString()),ref.sha256,'STOP_GOVERNANCE_DOCUMENT_HASH');return JSON.parse(bytes.toString());
}
function verifyGovernance(g,manifest,packageSha) {
 const evidence=g.governance;assert(evidence,'STOP_GOVERNANCE_REQUIRED');
 const founder=document(g.documents,evidence.founder),review=document(g.documents,evidence.review),lineage=document(g.documents,evidence.lineage),scope=document(g.documents,evidence.scope),source=document(g.documents,evidence.sourceParity);
 for(const d of [founder,review,lineage,scope,source]){assert.equal(d.task,'ES-DIAMOND-WHOLE-ORDER-RECOVERY-01');assert.equal(d.releaseSha,g.releaseSha);}
 assert.equal(founder.schema,'diamond-founder-decision/1');assert.equal(founder.disposition,'APPROVED');assert.equal(founder.decisionReference,g.founderDecisionReference);assert.equal(founder.deploymentId,g.deploymentId);assert.equal(founder.packageSha256,packageSha);assert.equal(founder.idempotencyKey,g.idempotencyKey);
 assert.equal(founder.sharedAuthSecretTrustRiskAcknowledged,true);assert.equal(founder.existingBypassRlsRiskAcknowledged,true);
 assert.equal(founder.dossierSha256,g.dossierSha256);assert.equal(founder.executorIdentifier,g.executorIdentifier);assert.equal(founder.receiverName,g.receiverName);assert.equal(founder.fieldWindowStartUtc,g.dossier.fieldPlan.windowStartUtc);assert.equal(founder.fieldWindowEndUtc,g.dossier.fieldPlan.windowEndUtc);
 assert.deepEqual(founder.actions,['ACTIVATE_THIS_EXACT_RECOVERY_GATE','ONE_WHOLE_CASH_BOOKKEEPING_RECOVERY','ONE_ORIGINAL_FRONT_PRINT','NO_NEW_CASH_OR_INVENTORY_DEDUCTION']);
 assert.equal(review.schema,'diamond-independent-review/1');assert.equal(review.result,'PASS');assert.equal(review.packageSha256,packageSha);assert.deepEqual(review.unresolvedSafetyFindings,[]);
 assert.equal(lineage.schema,'diamond-release-lineage/1');assert.equal(lineage.result,'PASS');assert.equal(lineage.mode,'STRICT');assert.equal(lineage.safeDevelopmentBase,true);assert.equal(lineage.sourceMappingComplete,true);assert(/^[a-f0-9]{40}$/.test(lineage.trustedMainSha));
 assert.equal(scope.schema,'diamond-scope/1');assert.equal(scope.result,'PASS');assert.equal(scope.authorizationStatus,'ACTIVE');assert.equal(scope.trustedMainSha,lineage.trustedMainSha);
 assert(Array.isArray(scope.authorizedPaths));
 for(const file of ['app/cashier/page.tsx','app/api/cashier/recovery/diamond-13543/route.ts'])assert(scope.authorizedPaths.includes(file));
 assert.equal(source.schema,'diamond-source-parity/1');assert.equal(source.result,'PASS');assert.equal(source.frozenSourceCommit,manifest.productionSha);assert.equal(g.frozenSourceCommit,manifest.productionSha);assert.equal(source.comparedPathsSha256,sha(manifest.sourceHashes));assert.deepEqual(source.sourceHashes,manifest.sourceHashes);
 assert.equal(g.canonicalOrigin,ORIGIN);
 return {governanceSha256:sha(evidence),sourceParitySha256:evidence.sourceParity.sha256};
}
module.exports={readonlyDatabase,verifyGovernance,ORIGIN};
