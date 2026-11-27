// Desktop composition profile: preserve original strict checks, recognize one
// byte-pinned preflight installer in addition to the Desktop uninstaller.
import { inflateRawSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { verifyNsisBinary, inspectCandidateInstaller as inspectAddon } from '../../e-shop-tray/scripts/build-network-addon.mjs'
const SIGNATURE = Buffer.from('efbeadde4e756c6c736f6674496e7374', 'hex')
const MAX = 512 * 1024 * 1024
const fail = code => { throw new Error(`DESKTOP_PROFILE_${code}`) }
const sha = b => createHash('sha256').update(b).digest('hex')
function overlay(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 512 || bytes.length > MAX || bytes.readUInt16LE(0) !== 0x5a4d) fail('INVALID_PE')
  const pe = bytes.readUInt32LE(60)
  if (pe < 64 || pe + 24 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550) fail('INVALID_PE')
  const sections = bytes.readUInt16LE(pe + 6), optionalSize = bytes.readUInt16LE(pe + 20), optional = pe + 24
  const table = optional + optionalSize
  if (optionalSize < 136 || table > bytes.length || ![0x10b, 0x20b].includes(bytes.readUInt16LE(optional))) fail('INVALID_PE')
  if (sections < 1 || sections > 96 || table + sections * 40 > bytes.length) fail('INVALID_PE')
  const headersSize = bytes.readUInt32LE(optional + 60)
  if (headersSize < table + sections * 40 || headersSize > bytes.length) fail('INVALID_PE')
  let end = headersSize
  const spans = []
  for (let index = 0; index < sections; index++) {
    const entry = table + index * 40, size = bytes.readUInt32LE(entry + 16), offset = bytes.readUInt32LE(entry + 20)
    if (size && (offset < headersSize || offset + size > bytes.length)) fail('INVALID_PE')
    if (size) { end = Math.max(end, offset + size); spans.push([offset, offset + size]) }
  }
  spans.sort((left, right) => left[0] - right[0])
  if (!spans.length || spans.some((span, index) => index > 0 && span[0] < spans[index - 1][1])) fail('INVALID_PE')
  return end
}

function* blocks(bytes, info) {
  let p = info.offset + 28, count = 0, expanded = 0
  while (p < bytes.length - 4) {
    if (count >= 1024 || p + 4 > bytes.length - 4) fail('BLOCK_LIMIT')
    const field = bytes.readUInt32LE(p), length = field & 0x7fffffff
    p += 4
    if (!length || p + length > bytes.length - 4) fail('INVALID_BLOCK')
    let b = bytes.subarray(p, p + length); p += length
    if (field >>> 31) {
      const result = inflateRawSync(b, { info: true, maxOutputLength: MAX })
      if (result.engine.bytesWritten !== length) fail('COMPRESSED_INPUT_REMAINDER')
      b = result.buffer
    }
    expanded += b.length
    if (expanded > MAX || (count === 0 && b.length !== info.headerLength)) fail('EXPANSION_LIMIT')
    count++; yield b
  }
  if (!count || p !== bytes.length - 4) fail('STREAM_REMAINDER')
}
// Mandatory exact hash supplied by the verified candidate binding.
export function inspectDesktopProfile(bytes, expectedAddonHash) {
  if (typeof expectedAddonHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedAddonHash)) fail('EXACT_ADDON_HASH_REQUIRED')
  const installer = verifyNsisBinary(bytes), archives = [], uninstallers = [], addons = []
  for (const b of blocks(bytes, installer)) {
    if (b.subarray(0, 6).equals(Buffer.from('377abcaf271c', 'hex'))) archives.push(b)
    if (b.length < 512 || b.readUInt16LE(0) !== 0x5a4d) continue
    const off = overlay(b)
    if (off + 20 > b.length || !b.subarray(off + 4, off + 20).equals(SIGNATURE)) continue
    const flags = b.readUInt32LE(off)
    if (flags === 1) {
      const validation = verifyNsisBinary(b, true)
      for (const _ of blocks(b, validation)) { /* Exhaust and validate stream. */ }
      uninstallers.push({ buffer: b, validation })
    } else if (flags === 0) {
      if (sha(b) !== expectedAddonHash) fail('UNKNOWN_NESTED_INSTALLER')
      const validation = inspectAddon(b)
      if (validation.applicationArchives.length !== 1) fail('ADDON_ARCHIVE_COUNT')
      addons.push({ sha256: sha(b), validation })
    } else fail('UNSUPPORTED_FLAGS')
  }
  if (uninstallers.length !== 1) fail('UNINSTALLER_COUNT')
  if (addons.length !== 1) fail('PREFLIGHT_COUNT')
  if (archives.length !== 1) fail('APPLICATION_ARCHIVE_COUNT')
  return { installer, uninstaller: uninstallers[0].validation,
    uninstallerBuffer: uninstallers[0].buffer, applicationArchives: archives,
    preflightAddonSha256: addons[0].sha256, preflightAddonValidated: true }
}
