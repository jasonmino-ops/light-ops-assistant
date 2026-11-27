import { spawn } from 'node:child_process'
import { TextDecoder } from 'node:util'

// Cross-process handoff only. Each app retains its own safeStorage keys.
const PREFIX = 'ESHOP-PRINT-CHILD-DPAPI-2:'
const MAX_BYTES = 32_768
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const SCRIPT = `
$ErrorActionPreference='Stop'
try {
 Add-Type -AssemblyName System.Security
 $request=[Console]::In.ReadToEnd()|ConvertFrom-Json
 if((($request.PSObject.Properties.Name|Sort-Object)-join ',') -cne 'operation,payload'){throw 'InvalidRequest'}
 if($request.operation -cne 'protect' -and $request.operation -cne 'unprotect'){throw 'InvalidOperation'}
 $inputBytes=[Convert]::FromBase64String($request.payload)
 if($inputBytes.Length -lt 1 -or $inputBytes.Length -gt 32768){throw 'InvalidSize'}
 $entropy=[Text.Encoding]::UTF8.GetBytes('E-Shop:managed-print-child:handoff:v2')
 $scope=[Security.Cryptography.DataProtectionScope]::CurrentUser
 if($request.operation -ceq 'protect'){$result=[Security.Cryptography.ProtectedData]::Protect($inputBytes,$entropy,$scope)}
 else{$result=[Security.Cryptography.ProtectedData]::Unprotect($inputBytes,$entropy,$scope)}
 if($result.Length -lt 1 -or $result.Length -gt 32768){throw 'InvalidResultSize'}
 [Console]::Out.Write([Convert]::ToBase64String($result))
} catch {[Console]::Error.Write('PRINT_CHILD_DPAPI_FAILED');exit 1}
`
const ENCODED_SCRIPT = Buffer.from(SCRIPT, 'utf16le').toString('base64')

function decode(value: string): Buffer {
  if (!value || value.length > MAX_BYTES * 2 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('PRINT_CHILD_HANDOFF_INVALID')
  }
  const bytes = Buffer.from(value, 'base64')
  if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString('base64') !== value) throw new Error('PRINT_CHILD_HANDOFF_INVALID')
  return bytes
}

async function currentUserDpapi(operation: 'protect' | 'unprotect', input: Buffer): Promise<Buffer> {
  if (process.platform !== 'win32') throw new Error('PRINT_CHILD_WINDOWS_REQUIRED')
  if (!input.length || input.length > MAX_BYTES) throw new Error('PRINT_CHILD_HANDOFF_INVALID')
  return new Promise((resolve, reject) => {
    let settled = false
    const output: Buffer[] = []
    let size = 0
    // The command is fixed. Secret bytes travel through private stdio, never
    // argv, environment, shell interpolation, logs or a plaintext file.
    const child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_SCRIPT], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    })
    const fail = (code: string) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      child.kill() // Only this retained, side-effect-free DPAPI helper handle.
      reject(new Error(code))
    }
    const timer = setTimeout(() => fail('PRINT_CHILD_DPAPI_TIMEOUT'), 5_000)
    child.once('error', () => fail('PRINT_CHILD_DPAPI_UNAVAILABLE'))
    child.stdin.on('error', () => fail('PRINT_CHILD_DPAPI_FAILED'))
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BYTES * 2) { fail('PRINT_CHILD_DPAPI_INVALID_RESPONSE'); return }
      output.push(Buffer.from(chunk))
    })
    // Never retain or forward helper stderr, which is not an authority source.
    child.stderr.on('data', () => undefined)
    child.once('close', (exit) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (exit !== 0) { reject(new Error('PRINT_CHILD_DPAPI_FAILED')); return }
      try { resolve(decode(Buffer.concat(output).toString('utf8'))) }
      catch { reject(new Error('PRINT_CHILD_DPAPI_INVALID_RESPONSE')) }
    })
    child.stdin.end(JSON.stringify({ operation, payload: input.toString('base64') }), 'utf8')
  })
}

export async function sealPrintChildHandoff(plaintext: string): Promise<string> {
  const protectedBytes = await currentUserDpapi('protect', Buffer.from(plaintext, 'utf8'))
  const envelope = PREFIX + protectedBytes.toString('base64')
  if (Buffer.byteLength(envelope) > MAX_BYTES) throw new Error('PRINT_CHILD_HANDOFF_INVALID')
  return envelope
}

export async function unsealPrintChildHandoff(envelope: string): Promise<string> {
  if (Buffer.byteLength(envelope) > MAX_BYTES || !envelope.startsWith(PREFIX)) throw new Error('PRINT_CHILD_HANDOFF_INVALID')
  const plain = await currentUserDpapi('unprotect', decode(envelope.slice(PREFIX.length)))
  return new TextDecoder('utf-8', { fatal: true }).decode(plain)
}
