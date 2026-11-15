import { createHash } from 'node:crypto'

export const initialMain='782e81ed5055e002dc7e3e31c55596b41fd38d14'
export const initialControl='8b887af6194b3f5b04f29b13c580c16db0f3ef43'
export const admissionPath='docs/change-gates/ES-NATIVE-INVENTORY-DIAMOND-PHASE1-B-ADMISSION.json'
export const correctionPath='docs/change-gates/ES-NATIVE-INVENTORY-DIAMOND-PHASE1-B-CHECKOUT-ORIGIN.json'
const originalAdmissionSha='16a175d62d28b1d6012f72f1a447f65eda502895dc57834315eeab551485b9ab'
const candidate='cf3960dc953eb58c48dd50edefe605aa4327abd8'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const requireCondition = (ok, reason) => { if (!ok) throw new Error(reason) }

export function readOriginCorrection(git, main, control) {
  const txt = (...args) => git(...args).toString().trim()
  requireCondition(txt('show','-s','--format=%P',main)===initialMain &&
    txt('diff','--name-only','--no-renames',initialMain,main)===correctionPath,'ORIGIN_CORRECTION_MAIN_DELTA')
  const original = git('show',main+':'+admissionPath)
  const record = JSON.parse(original)
  const bytes = git('show',main+':'+correctionPath)
  const correction = JSON.parse(bytes)
  requireCondition(digest(original)===originalAdmissionSha && record.signingControlSha===initialControl &&
    correction.approvedBy==='Founder' && correction.kind==='CHECKOUT_ORIGIN_FORMAT_ONLY' &&
    correction.candidate===candidate && correction.store===record.store && correction.path===record.path &&
    correction.runtime===record.runtime && correction.initialMain===initialMain &&
    correction.admissionSha256===originalAdmissionSha && correction.initialControl===initialControl &&
    /^[a-f0-9]{40}$/.test(control ?? '') && correction.signingControlSha===control &&
    correction.expiresAt===record.expiresAt && Date.parse(correction.issuedAt)>=Date.parse(record.issuedAt) &&
    Date.parse(correction.issuedAt)<=Date.now() && Date.now()<Date.parse(correction.expiresAt) &&
    /^[0-9a-f]{64}$/.test(correction.independentReviewSha256),'ORIGIN_CORRECTION_AUTHORITY')
  const paths=[
    '.github/release-validator/diamond-corrected-verifier.mjs',
    '.github/release-validator/diamond-origin-correction.mjs',
    '.github/release-validator/diamond.mjs',
    '.github/workflows/selective-release-validator.yml',
  ]
  requireCondition(txt('show','-s','--format=%P',control)===initialControl &&
    txt('diff','--name-only','--no-renames',initialControl,control)===paths.join('\n'),
    'ORIGIN_CORRECTION_CONTROL_DELTA')
  const reviewed=correction.controlPathsSha256 ?? {}
  requireCondition(Object.keys(reviewed).length===paths.length && paths.every(path=>
    digest(git('show',control+':'+path))===reviewed[path]),'ORIGIN_CORRECTION_REVIEWED_BYTES')
  return {record,recordSha256:digest(bytes)}
}
