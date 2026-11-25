'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { verifyRecord, verifyProduct, canonicalOrigin, candidateShape, TASK, RECORD, TREE, BASE } = require('../verify-inventory-control-admission.cjs')
const root = resolve(__dirname,'../../..')
const read = name => readFileSync(resolve(root,name))
const original = JSON.parse(read(RECORD))
const copy = () => structuredClone(original)
const sha = b => createHash('sha256').update(b).digest('hex')
const evidence = `docs/change-gates/evidence/${TASK}/`
test('exact 11-path request, signed receipt, seven-assertion disposition and product bytes verify', () => {
  const details=verifyRecord(original,read)
  assert.equal(details.request.paths.length,11)
  verifyProduct('/private/tmp/es-inventory-control-production-candidate',original,details)
})
test('expired/future grant and Production authorization are rejected', () => {
  const r=copy(); r.productionAuthorized=true; assert.throws(()=>verifyRecord(r,read))
  assert.throws(()=>verifyRecord(original,read,Date.parse(original.expiresAt)))
  assert.throws(()=>verifyRecord(original,read,Date.parse(original.issuedAt)-1))
})
test('candidate tree or expected Production base drift is rejected', () => {
  for(const key of ['candidateTree','productionBase']) {const r=copy();r[key]='0'.repeat(40);assert.throws(()=>verifyRecord(r,read))}
})
test('extra paths or changed approved content cannot reuse the request', () => {
  const target=evidence+'sealed-request.json'
  const changed=JSON.parse(read(target));changed.paths.push({path:'app/api/sales/route.ts',sha256:'0'.repeat(64),beforeSha256:null})
  const bytes=Buffer.from(JSON.stringify(changed));const r=copy();r.evidenceSha256[target]=sha(bytes)
  assert.throws(()=>verifyRecord(r,p=>p===target?bytes:read(p)))
})
test('frozen successor cannot change content, widen path set or grant Production', () => {
  const target=original.frozenPath
  for(const change of [f=>{f.productionAuthorized=true},f=>{f.paths['app/api/sales/route.ts']={before:null,after:'0'.repeat(64)}},f=>{f.paths['app/native-inventory/page.tsx'].after='0'.repeat(64)}]) {
    const f=JSON.parse(read(target));change(f);const bytes=Buffer.from(JSON.stringify(f));const r=copy();r.frozenSha256=sha(bytes)
    assert.throws(()=>verifyRecord(r,p=>p===target?bytes:read(p)))
  }
})
test('Scope cannot add wildcard/other migration or change the protected hash', () => {
  const target=original.scopePath,s=JSON.parse(read(target));s.authorizedPaths.push('prisma/migrations/**')
  const bytes=Buffer.from(JSON.stringify(s));const r=copy();r.scopeSha256=sha(bytes)
  assert.throws(()=>verifyRecord(r,p=>p===target?bytes:read(p)))
})
test('a changed/new failure cannot inherit the non-regression disposition', () => {
  const target=evidence+'core-disposition.json'
  for(const change of [d=>{d.raw_status='PASS'},d=>{d.failures.push(d.failures[0])},d=>{d.comparison[0].normalized_output_equal=false},d=>{d.failures[0].actual='new risk'}]) {
    const d=JSON.parse(read(target));change(d);const bytes=Buffer.from(JSON.stringify(d));const r=copy();r.evidenceSha256[target]=sha(bytes)
    assert.throws(()=>verifyRecord(r,p=>p===target?bytes:read(p)))
  }
})
test('forged repository and wrong/multiple parent chains are rejected', () => {
  assert(canonicalOrigin('git@github.com:jasonmino-ops/light-ops-assistant.git'))
  assert(canonicalOrigin('https://github.com/jasonmino-ops/light-ops-assistant.git'))
  assert(canonicalOrigin('https://github.com/jasonmino-ops/light-ops-assistant'))
  for(const url of ['file:///tmp/fake','https://github.com/attacker/light-ops-assistant.git','https://github.com.jasonmino-ops.invalid/light-ops-assistant.git']) assert.equal(canonicalOrigin(url),false)
  candidateShape(TREE,[BASE])
  for(const parents of [[],['0'.repeat(40)],[BASE,'0'.repeat(40)]]) assert.throws(()=>candidateShape(TREE,parents))
})
test('formal CLI cannot succeed without an explicit precommit/postcommit target', () => {
  const cli=resolve(root,'scripts/governance/verify-inventory-control-admission.cjs')
  for(const args of [[],['--precommit','--candidate',BASE]]) {
    const result=spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8'})
    assert.equal(result.status,1)
    assert.match(result.stderr,/Choose exactly --precommit or --candidate/)
  }
  const wrong=spawnSync(process.execPath,[cli,'--root','/private/tmp/es-inventory-control-production-candidate','--candidate','0'.repeat(40)],{encoding:'utf8'})
  assert.equal(wrong.status,1)
  assert.match(wrong.stderr,/exact Candidate checkout/)
})
