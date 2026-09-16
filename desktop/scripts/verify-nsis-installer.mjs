import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const NSIS_SIGNATURE = Buffer.from('efbeadde4e756c6c736f6674496e7374', 'hex')
const MAX_NSIS_BYTES = 512 * 1024 * 1024
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function fail(code) {
  throw new Error(code)
}

export function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function peOverlayOffset(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 512 || bytes.length > MAX_NSIS_BYTES || bytes.readUInt16LE(0) !== 0x5a4d) {
    fail('DESKTOP_INSTALLER_INVALID_PE')
  }

  const pe = bytes.readUInt32LE(60)
  if (pe < 64 || pe + 24 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550) {
    fail('DESKTOP_INSTALLER_INVALID_PE')
  }

  const sections = bytes.readUInt16LE(pe + 6)
  const optionalSize = bytes.readUInt16LE(pe + 20)
  const optional = pe + 24
  const table = optional + optionalSize
  if (optionalSize < 136 || table > bytes.length || ![0x10b, 0x20b].includes(bytes.readUInt16LE(optional))) {
    fail('DESKTOP_INSTALLER_INVALID_PE')
  }
  if (sections < 1 || sections > 96 || table + sections * 40 > bytes.length) {
    fail('DESKTOP_INSTALLER_INVALID_PE')
  }

  const headersSize = bytes.readUInt32LE(optional + 60)
  if (headersSize < table + sections * 40 || headersSize > bytes.length) {
    fail('DESKTOP_INSTALLER_INVALID_PE')
  }

  let end = headersSize
  const spans = []
  for (let index = 0; index < sections; index += 1) {
    const entry = table + index * 40
    const size = bytes.readUInt32LE(entry + 16)
    const offset = bytes.readUInt32LE(entry + 20)
    if (size && (offset < headersSize || offset + size > bytes.length)) {
      fail('DESKTOP_INSTALLER_INVALID_PE')
    }
    if (size) {
      end = Math.max(end, offset + size)
      spans.push([offset, offset + size])
    }
  }

  spans.sort((left, right) => left[0] - right[0])
  if (!spans.length || spans.some((span, index) => index > 0 && span[0] < spans[index - 1][1])) {
    fail('DESKTOP_INSTALLER_INVALID_PE')
  }
  return end
}

function inspectUnsignedX86Pe(bytes) {
  const offset = peOverlayOffset(bytes)
  const pe = bytes.readUInt32LE(60)
  const optional = pe + 24
  if (bytes.readUInt16LE(pe + 4) !== 0x14c || (bytes.readUInt16LE(pe + 22) & 0x2000)) {
    fail('DESKTOP_INSTALLER_INVALID_PE_ARCH')
  }

  const security = optional + (bytes.readUInt16LE(optional) === 0x20b ? 112 : 96) + 32
  if (
    security + 8 > optional + bytes.readUInt16LE(pe + 20)
    || bytes.readUInt32LE(security)
    || bytes.readUInt32LE(security + 4)
  ) {
    fail('DESKTOP_INSTALLER_UNEXPECTED_SIGNATURE')
  }
  return offset
}

export function verifyNsisBinary(bytes, expectedUninstaller = false) {
  const offset = inspectUnsignedX86Pe(bytes)
  const pe = bytes.readUInt32LE(60)
  if (
    bytes.readUInt16LE(pe + 24) !== 0x10b
    || offset < 512
    || offset % 512
    || offset + 32 > bytes.length
    || !bytes.subarray(offset + 4, offset + 20).equals(NSIS_SIGNATURE)
  ) {
    fail('DESKTOP_INSTALLER_INVALID_NSIS')
  }

  for (let earlier = 512; earlier < offset; earlier += 512) {
    if (bytes.subarray(earlier + 4, earlier + 20).equals(NSIS_SIGNATURE)) {
      fail('DESKTOP_INSTALLER_INVALID_NSIS')
    }
  }

  const flags = bytes.readUInt32LE(offset)
  const headerLength = bytes.readUInt32LE(offset + 20)
  if (
    flags !== (expectedUninstaller ? 1 : 0)
    || bytes.readUInt32LE(offset + 24) !== bytes.length - offset
    || headerLength < 68
    || headerLength > 16 * 1024 * 1024
  ) {
    fail('DESKTOP_INSTALLER_INVALID_NSIS')
  }

  const actualCrc32 = crc32(bytes.subarray(512, bytes.length - 4))
  if (bytes.readUInt32LE(bytes.length - 4) !== actualCrc32) {
    fail('DESKTOP_INSTALLER_NSIS_CRC_MISMATCH')
  }

  return {
    bytes: bytes.length,
    crc32: actualCrc32.toString(16).padStart(8, '0'),
    flags,
    headerLength,
    offset,
  }
}

function* nsisBlocks(bytes, info) {
  let position = info.offset + 28
  let count = 0
  let expanded = 0

  while (position < bytes.length - 4) {
    if (count >= 1024 || position + 4 > bytes.length - 4) {
      fail('DESKTOP_INSTALLER_INVALID_NSIS_BLOCK')
    }

    const field = bytes.readUInt32LE(position)
    const length = field & 0x7fffffff
    position += 4
    if (!length || position + length > bytes.length - 4) {
      fail('DESKTOP_INSTALLER_INVALID_NSIS_BLOCK')
    }

    let block = bytes.subarray(position, position + length)
    position += length
    if (field >>> 31) {
      const result = inflateRawSync(block, { info: true, maxOutputLength: MAX_NSIS_BYTES })
      if (result.engine.bytesWritten !== length) {
        fail('DESKTOP_INSTALLER_INVALID_NSIS_BLOCK')
      }
      block = result.buffer
    }

    expanded += block.length
    if (expanded > MAX_NSIS_BYTES || (count === 0 && block.length !== info.headerLength)) {
      fail('DESKTOP_INSTALLER_INVALID_NSIS_BLOCK')
    }
    count += 1
    yield block
  }

  if (!count || position !== bytes.length - 4) {
    fail('DESKTOP_INSTALLER_INVALID_NSIS_BLOCK')
  }
}

export function inspectNsisInstaller(bytes) {
  const installer = verifyNsisBinary(bytes)
  const uninstallers = []

  for (const block of nsisBlocks(bytes, installer)) {
    if (block.length < 512 || block.readUInt16LE(0) !== 0x5a4d) continue
    const offset = peOverlayOffset(block)
    if (offset + 20 > block.length || !block.subarray(offset + 4, offset + 20).equals(NSIS_SIGNATURE)) continue

    const validation = verifyNsisBinary(block, true)
    for (const _block of nsisBlocks(block, validation)) {
      // Iteration validates the entire embedded uninstaller stream.
    }
    uninstallers.push(validation)
  }

  if (uninstallers.length !== 1) {
    fail('DESKTOP_INSTALLER_EMBEDDED_UNINSTALLER_MISMATCH')
  }

  return { installer, uninstaller: uninstallers[0] }
}

function parseArgs(args) {
  if (args.length !== 1 && args.length !== 3) {
    fail('usage: node scripts/verify-nsis-installer.mjs <installer.exe> [--sha-manifest SHA256SUMS.txt]')
  }
  if (args.length === 3 && args[1] !== '--sha-manifest') {
    fail('DESKTOP_INSTALLER_UNSUPPORTED_ARGUMENT')
  }
  return {
    installerPath: resolve(args[0]),
    shaManifestPath: args.length === 3 ? resolve(args[2]) : null,
  }
}

async function readRegularFile(path, label) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) {
    fail(`DESKTOP_INSTALLER_${label}_MUST_BE_REGULAR_FILE`)
  }
  return readFile(path)
}

async function verifyManifest(path, installerPath, installerSha256) {
  const text = (await readRegularFile(path, 'SHA_MANIFEST')).toString('utf8')
  const targetName = basename(installerPath)
  const matches = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const match = line.match(/^([a-fA-F0-9]{64}) {2}([^/\\]+)$/)
    if (!match) fail('DESKTOP_INSTALLER_INVALID_SHA_MANIFEST')
    if (match[2] === targetName) matches.push(match[1].toLowerCase())
  }
  if (matches.length !== 1 || !SHA256_PATTERN.test(matches[0]) || matches[0] !== installerSha256) {
    fail('DESKTOP_INSTALLER_SHA_MANIFEST_MISMATCH')
  }
  return { file: basename(path), installerEntry: targetName, result: 'PASS' }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const installerBytes = await readRegularFile(options.installerPath, 'INPUT')
  const sha256 = createHash('sha256').update(installerBytes).digest('hex')
  const nsis = inspectNsisInstaller(installerBytes)
  const manifest = options.shaManifestPath
    ? await verifyManifest(options.shaManifestPath, options.installerPath, sha256)
    : null

  process.stdout.write(`${JSON.stringify({
    installer: basename(options.installerPath),
    sha256,
    outerInstaller: nsis.installer,
    embeddedUninstaller: nsis.uninstaller,
    manifest,
    result: 'PASS',
  }, null, 2)}\n`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  })
}
