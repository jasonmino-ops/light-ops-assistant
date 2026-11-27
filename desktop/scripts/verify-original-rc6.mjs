// Verify the already-built original RC6. This command has no build, release,
// upload or approval action. The existing pre-build policy remains separate.
import { createHash } from 'node:crypto'
import { createReadStream, lstatSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonical, frozenSnapshot, git } from './rc6-foundation-policy.mjs'
import { createEmbeddedManifest } from './single-installer-contract.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const registration = '833aabe1528fcc768f9b0329246b677f055b42bb'
const projection = '58309af4a941fd5c74e52bb44bbc0337117c070a'
const prefix = 'docs/desktop/es-print-device-takeover-rc6-foundation'
const product = '0217be8cb6a9f60d01a3ba47f69492a6948c2f8d'
const build = '05e82b2078bf4f5273001923d54de0aef545ebbd'
const inputsSha = '6fff58f7548f352c2764471948e74789d2b502528967269c18b47079c9a84a12'
const archiveName = 'E-Shop-Desktop-Setup-0.3.0-rc.6-win-x64.exe'
const archiveSha = '6553563e1f8571a19bd0be805a8e1e56c37a9e86a7e44033cf38c14354393fc5'
const snapshot = 'e5ecd0bfd5c0addab68b6bdd35f3c35d71ca8bf97ea2ccfed8238ec33ddaaf6b'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

function check(ok, code) {
  if (!ok) throw new Error('ORIGINAL_RC6_' + code)
}
function blob(ref, file) {
  return git(root, ['--no-replace-objects', 'show', ref + ':' + file], true)
}
function regular(file) {
  check(lstatSync(file).isFile(), 'REGULAR_FILE_REQUIRED')
  return readFileSync(file)
}
export function verifySource() {
  for (const [from, to] of [[registration, 'refs/remotes/origin/main'], [projection, 'HEAD']]) {
    git(root, ['--no-replace-objects', 'merge-base', '--is-ancestor', from, to])
  }
  const record = JSON.parse(blob(registration, prefix + '.json'))
  const inputs = blob(registration, prefix + '-build-inputs.json')
  check(hash(canonical(record)) === 'a18f0603e0c08b66f6b2824619f6d1212503ac83227b3eec872451c3da0e2b19'
    && record.productCommit === product && hash(inputs) === inputsSha, 'ORIGINAL_REGISTRATION')
  // The only differences from the reviewed integration tree may be the
  // archive verifier and its CI/tests. Reject new, missing and unstaged inputs.
  const governancePaths = ['desktop/scripts/verify-original-rc6.mjs',
    'desktop/tests/original-rc6-archive.test.ts', 'desktop/tests/release-foundation.test.ts',
    '.github/workflows/desktop-windows-build.yml']
  const scope = ['.', ...governancePaths.map(file => ':(exclude,literal)' + file)]
  for (const refs of [[projection, 'HEAD'], [projection]]) {
    git(root, ['--no-replace-objects', 'diff', '--quiet', '--no-ext-diff', '--no-textconv', ...refs, '--', ...scope])
  }
  check(!git(root, ['ls-files', '--others', '--exclude-standard', '--', ...scope]).trim(), 'UNTRACKED_INPUT')
  const files = Object.entries(record.productSourceSha256)
  for (const [file, sha] of files) {
    check(hash(blob('HEAD', file)) === sha && hash(regular(join(root, file))) === sha, 'PRODUCT_BYTES: ' + file)
  }
  check(hash(canonical(frozenSnapshot(root))) === snapshot, 'FROZEN_SNAPSHOT')
  return { purpose: 'original RC6 source comparison', product, build, projection,
    sourceFiles: files.length, frozenSnapshotSha256: snapshot, installerVerified: false }
}

async function verifyArchive(directory) {
  const manifestBytes = regular(join(directory, 'BUILD-MANIFEST.json'))
  check(hash(manifestBytes) === 'c574c3a345bf394c628ac26eb28ec8226af5a4acf44d5331361c22404b1a347f', 'BUILD_MANIFEST')
  const manifest = JSON.parse(manifestBytes)
  const evidenceBytes = regular(join(directory, 'single-installer-evidence.json'))
  check(hash(evidenceBytes) === manifest.buildEvidenceSha256, 'PACKAGING_EVIDENCE')
  for (const [suffix, sha] of [['-build-inputs.json', inputsSha], ['-approval.json', manifest.founderReceiptSha256]]) {
    const local = regular(join(directory, 'es-print-device-takeover-rc6-foundation' + suffix))
    check(hash(local) === sha && local.equals(blob(registration, prefix + suffix)), 'INPUT_PROVENANCE')
  }
  const evidence = JSON.parse(evidenceBytes)
  const embedded = createEmbeddedManifest({ desktopSourceCommit: build, addon: evidence.addon })
  check(manifest.productCommit === product && manifest.buildCommit === build && manifest.installerSha256 === archiveSha
    && canonical(embedded) === canonical(evidence.embedded), 'EMBEDDED_CONTRACT')
  const file = join(directory, archiveName)
  const info = lstatSync(file)
  check(info.isFile() && info.size === manifest.installerBytes, 'INSTALLER_FILE')
  const digest = createHash('sha256')
  for await (const bytes of createReadStream(file)) digest.update(bytes)
  check(digest.digest('hex') === archiveSha, 'INSTALLER_DIGEST')
  return { ...verifySource(), purpose: 'existing original RC6 archive', installerVerified: true, installerSha256: archiveSha,
    buildClass: manifest.usage, commercialApproved: false }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, directory, ...extra] = process.argv.slice(2)
  try {
    check((mode === 'source' && !directory) || (mode === 'archive' && directory && !extra.length), 'USAGE')
    console.log(JSON.stringify(mode === 'source' ? verifySource() : await verifyArchive(resolve(directory))))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
