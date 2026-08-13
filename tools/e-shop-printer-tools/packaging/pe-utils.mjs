import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";

function peOffsets(buffer) {
  if (buffer.length < 512 || buffer.toString("ascii", 0, 2) !== "MZ") throw new Error("INVALID_DOS_HEADER");
  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") throw new Error("INVALID_PE_SIGNATURE");
  const coffOffset = peOffset + 4;
  const optionalOffset = coffOffset + 20;
  const optionalMagic = buffer.readUInt16LE(optionalOffset);
  if (optionalMagic !== 0x20b) throw new Error(`EXPECTED_PE32_PLUS: 0x${optionalMagic.toString(16)}`);
  return {
    peOffset,
    coffOffset,
    optionalOffset,
    checksumOffset: optionalOffset + 64,
    subsystemOffset: optionalOffset + 68,
    certificateDirectoryOffset: optionalOffset + 112 + (4 * 8),
  };
}

export function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function stripPeAuthenticode(filePath) {
  let buffer = readFileSync(filePath);
  const { certificateDirectoryOffset } = peOffsets(buffer);
  const certificateOffset = buffer.readUInt32LE(certificateDirectoryOffset);
  const certificateSize = buffer.readUInt32LE(certificateDirectoryOffset + 4);
  buffer.writeUInt32LE(0, certificateDirectoryOffset);
  buffer.writeUInt32LE(0, certificateDirectoryOffset + 4);
  if (certificateOffset > 0 && certificateSize > 0 && certificateOffset + certificateSize === buffer.length) {
    buffer = buffer.subarray(0, certificateOffset);
  }
  writeFileSync(filePath, buffer);
  return { removedCertificateOffset: certificateOffset, removedCertificateSize: certificateSize };
}

export function setWindowsGuiSubsystem(filePath) {
  const buffer = readFileSync(filePath);
  const { checksumOffset, subsystemOffset } = peOffsets(buffer);
  buffer.writeUInt16LE(2, subsystemOffset); // IMAGE_SUBSYSTEM_WINDOWS_GUI
  buffer.writeUInt32LE(0, checksumOffset);
  writeFileSync(filePath, buffer);
}

export function inspectPeArtifact(filePath, expectedCommit) {
  const buffer = readFileSync(filePath);
  const { coffOffset, optionalOffset, subsystemOffset, certificateDirectoryOffset } = peOffsets(buffer);
  const machine = buffer.readUInt16LE(coffOffset);
  const subsystem = buffer.readUInt16LE(subsystemOffset);
  const certificateOffset = buffer.readUInt32LE(certificateDirectoryOffset);
  const certificateSize = buffer.readUInt32LE(certificateDirectoryOffset + 4);
  const seaAscii = buffer.indexOf(Buffer.from("NODE_SEA_BLOB", "ascii"));
  const seaUtf16 = buffer.indexOf(Buffer.from("NODE_SEA_BLOB", "utf16le"));
  const commitEmbedded = expectedCommit ? buffer.indexOf(Buffer.from(expectedCommit, "ascii")) >= 0 : null;
  const productNameEmbedded = buffer.indexOf(Buffer.from("E-Shop Printer Tools", "utf8")) >= 0;
  return {
    filename: filePath.split(/[\\/]/).pop(),
    sizeBytes: statSync(filePath).size,
    sha256: sha256File(filePath),
    format: "PE32+",
    machine: `0x${machine.toString(16).padStart(4, "0")}`,
    architecture: machine === 0x8664 ? "x86-64" : "UNKNOWN",
    optionalHeaderMagic: `0x${buffer.readUInt16LE(optionalOffset).toString(16)}`,
    subsystem,
    subsystemName: subsystem === 2 ? "WINDOWS_GUI" : subsystem === 3 ? "WINDOWS_CONSOLE" : "OTHER",
    certificateTableOffset: certificateOffset,
    certificateTableSize: certificateSize,
    codeSigned: certificateOffset !== 0 && certificateSize !== 0,
    seaResourceMarkerFound: seaAscii >= 0 || seaUtf16 >= 0,
    buildCommitEmbedded: commitEmbedded,
    productNameEmbedded,
  };
}
