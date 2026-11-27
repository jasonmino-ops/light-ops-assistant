import { it as test } from 'vitest'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {deflateRawSync} from 'node:zlib'
// @ts-expect-error Runtime ESM verifier has no generated declaration file.
import {inspectDesktopProfile} from '../scripts/desktop-nsis-profile.mjs'
// @ts-expect-error Runtime ESM verifier has no generated declaration file.
import {crc32,inspectCandidateInstaller as oldInspector} from '../../e-shop-tray/scripts/build-network-addon.mjs'
const sha=(b: Buffer)=>createHash('sha256').update(b).digest('hex')
function container(flags: number, payloads: Buffer[] = [], badCompressed=false) {
  const pe=Buffer.alloc(1024);pe.write('MZ');pe.writeUInt32LE(128,60);pe.write('PE\0\0',128)
  pe.writeUInt16LE(0x14c,132);pe.writeUInt16LE(1,134);pe.writeUInt16LE(224,148);pe.writeUInt16LE(0x102,150)
  pe.writeUInt16LE(0x10b,152);pe.writeUInt32LE(512,212);pe.writeUInt32LE(512,392);pe.writeUInt32LE(512,396)
  const header=Buffer.alloc(28);header.writeUInt32LE(flags);Buffer.from('efbeadde4e756c6c736f6674496e7374','hex').copy(header,4);header.writeUInt32LE(68,20)
  const fields=[Buffer.alloc(68),...payloads].map((v,i)=>{
    let b=v,compressed=false
    if(badCompressed&&i===0){b=Buffer.concat([deflateRawSync(v),Buffer.from([0])]);compressed=true}
    const n=Buffer.alloc(4);n.writeUInt32LE((b.length+(compressed?0x80000000:0))>>>0);return Buffer.concat([n,b])
  })
  const data=Buffer.concat([header,...fields,Buffer.alloc(4)]);data.writeUInt32LE(data.length,24);const result=Buffer.concat([pe,data]);result.writeUInt32LE(crc32(result.subarray(512,-4)),result.length-4)
  return result
}
const archive=Buffer.from('377abcaf271c00000000','hex')
const uninstaller=container(1)
const addon=container(0,[uninstaller,archive]),approved=sha(addon)
const desktop=(blocks=[addon,uninstaller,archive],bad=false)=>container(0,blocks,bad)
test('correct Desktop profile accepts exactly one approved nested installer and uninstaller',()=>{
  const r=inspectDesktopProfile(desktop(),approved);assert.equal(r.preflightAddonSha256,approved);assert.equal(r.uninstaller.flags,1);assert.equal(r.applicationArchives.length,1)
})
test('original Add-on-only inspector reproduces the false rejection',()=>assert.throws(()=>oldInspector(desktop()),/ADDON_INVALID_NSIS/))
test('unknown nested installer is rejected',()=>assert.throws(()=>inspectDesktopProfile(desktop(),'0'.repeat(64)),/UNKNOWN_NESTED_INSTALLER/))
test('duplicate exact preflight installer is rejected',()=>assert.throws(()=>inspectDesktopProfile(desktop([addon,addon,uninstaller,archive]),approved),/PREFLIGHT_COUNT/))
test('missing preflight is rejected',()=>assert.throws(()=>inspectDesktopProfile(desktop([uninstaller,archive]),approved),/PREFLIGHT_COUNT/))
test('missing uninstaller is rejected',()=>assert.throws(()=>inspectDesktopProfile(desktop([addon,archive]),approved),/UNINSTALLER_COUNT/))
test('duplicate uninstaller is rejected',()=>assert.throws(()=>inspectDesktopProfile(desktop([addon,uninstaller,uninstaller,archive]),approved),/UNINSTALLER_COUNT/))
test('extra application archive is rejected',()=>assert.throws(()=>inspectDesktopProfile(desktop([addon,uninstaller,archive,archive]),approved),/APPLICATION_ARCHIVE_COUNT/))
test('missing application archive is rejected',()=>assert.throws(()=>inspectDesktopProfile(desktop([addon,uninstaller]),approved),/APPLICATION_ARCHIVE_COUNT/))
test('unsupported inner flags are rejected',()=>assert.throws(()=>inspectDesktopProfile(desktop([addon,container(2),archive]),approved),/UNSUPPORTED_FLAGS/))
test('outer CRC corruption is rejected',()=>{
  const b=desktop();b[b.length-5]^=1;assert.throws(()=>inspectDesktopProfile(b,approved),/CRC_MISMATCH/)
})
test('inner uninstaller CRC corruption is rejected even with valid outer CRC',()=>{
  const b=Buffer.from(uninstaller);b[b.length-5]^=1;assert.throws(()=>inspectDesktopProfile(desktop([addon,b,archive]),approved),/CRC_MISMATCH/)
})
test('unsigned PE guard rejects an Authenticode directory',()=>{
  const b=Buffer.from(uninstaller);b.writeUInt32LE(512,280)
  assert.throws(()=>inspectDesktopProfile(desktop([addon,b,archive]),approved),/UNEXPECTED_SIGNATURE/)
})
test('compressed input must be exhausted',()=>assert.throws(()=>inspectDesktopProfile(desktop(undefined,true),approved),/COMPRESSED_INPUT_REMAINDER/))
test('block count limit is retained',()=>assert.throws(()=>inspectDesktopProfile(desktop([...Array(1025)].map(()=>Buffer.from([1]))),approved),/BLOCK_LIMIT/))

test('complete NSIS signatures with truncated headers are rejected with valid outer CRC',()=>{
  for (let size=20;size<28;size++) {
    const truncated=uninstaller.subarray(0,1024+size)
    assert.throws(()=>inspectDesktopProfile(desktop([addon,uninstaller,archive,truncated]),approved),/ADDON_INVALID_NSIS/)
  }
})

test('caller must provide the exact candidate hash, without defaults or arbitrary formats',()=>{for(const h of [undefined,'','x'.repeat(64),'a'.repeat(63),'A'.repeat(64)])assert.throws(()=>inspectDesktopProfile(desktop(),h),/EXACT_ADDON_HASH_REQUIRED/)})
