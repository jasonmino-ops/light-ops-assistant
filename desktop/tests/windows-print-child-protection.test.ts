import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ports = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: ports.spawn }))
import { sealPrintChildHandoff, unsealPrintChildHandoff } from '../src/main/windowsPrintChildProtection'

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(() => { Object.defineProperty(process, 'platform', { ...platform, value: 'win32' }); ports.spawn.mockReset() })
afterEach(() => { Object.defineProperty(process, 'platform', platform); vi.useRealTimers() })
function helper(mode = 'ok') {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) })
  let request = ''
  child.stdin.on('data', chunk => { request += chunk.toString() })
  child.stdin.on('finish', () => { queueMicrotask(() => {
    if (mode === 'timeout') return
    if (mode === 'exit') { child.emit('close', 1); return }
    if (mode === 'oversize') { child.stdout.write('A'.repeat(65537)); return }
    if (mode === 'non-ascii') { child.stdout.write(Buffer.from([0xc1, 0x41, 0x3d, 0x3d])); child.emit('close', 0); return }
    const data = JSON.parse(request), bytes = Buffer.from(data.payload, 'base64')
    const output = data.operation === 'protect' ? Buffer.concat([Buffer.from('FAKE-PORT:'), bytes]) : bytes.subarray('FAKE-PORT:'.length)
    child.stdout.write(output.toString('base64')); child.emit('close', 0)
  }) })
  ports.spawn.mockReturnValue(child)
  return { child, request: () => JSON.parse(request) }
}

describe('bounded current-user Print Child protection port', () => {
  it('keeps plaintext on pipes and uses only the fixed CurrentUser command', async () => {
    const protect = helper(), text = 'synthetic payload only'
    const envelope = await sealPrintChildHandoff(text)
    const call = ports.spawn.mock.calls[0]
    expect(call[0]).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(call[1].slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand'])
    const script = Buffer.from(call[1][3], 'base64').toString('utf16le')
    expect(script).toContain('DataProtectionScope]::CurrentUser'); expect(script).not.toContain('LocalMachine')
    expect(script).not.toMatch(/WriteAllText|Set-Content|Out-File|Invoke-Expression|ExecutionPolicy/)
    expect(call[1].join(' ')).not.toContain(text); expect(call[2]).toMatchObject({ shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    expect(protect.request()).toMatchObject({ operation: 'protect', payload: Buffer.from(text).toString('base64') })
    helper(); expect(await unsealPrintChildHandoff(envelope)).toBe(text)
  })

  it.each(['', 'old-safeStorage-base64', 'ESHOP-PRINT-CHILD-DPAPI-2:!!!!', 'ESHOP-PRINT-CHILD-DPAPI-2:'+'A'.repeat(32769)])('rejects malformed or old envelopes before spawning', async value => {
    await expect(unsealPrintChildHandoff(value)).rejects.toThrow('PRINT_CHILD_HANDOFF_INVALID')
    expect(ports.spawn).not.toHaveBeenCalled()
  })

  it.each(['exit', 'oversize', 'non-ascii'])('fails closed for a %s helper response', async mode => {
    const f = helper(mode)
    await expect(sealPrintChildHandoff('synthetic')).rejects.toThrow(/PRINT_CHILD_DPAPI_/)
    if (mode === 'oversize') expect(f.child.kill).toHaveBeenCalledOnce()
  })

  it('bounds and cancels only its own side-effect-free helper', async () => {
    vi.useFakeTimers(); const f = helper('timeout')
    const result = expect(sealPrintChildHandoff('synthetic')).rejects.toThrow('PRINT_CHILD_DPAPI_TIMEOUT')
    await vi.advanceTimersByTimeAsync(5001); await result
    expect(f.child.kill).toHaveBeenCalledOnce()
  })

  it('refuses non-Windows and oversized plaintext', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' })
    await expect(sealPrintChildHandoff('synthetic')).rejects.toThrow('PRINT_CHILD_WINDOWS_REQUIRED')
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
    await expect(sealPrintChildHandoff('x'.repeat(32769))).rejects.toThrow('PRINT_CHILD_HANDOFF_INVALID')
    expect(ports.spawn).not.toHaveBeenCalled()
  })
})
