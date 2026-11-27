import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WINDOWS_USB_IDENTITY_SCRIPT } from '../src/main/printing/windowsUsbIdentityScript'
import { WINDOWS_USB_QUEUE_INVENTORY_SCRIPT } from '../src/main/printing/windowsUsbQueueDiscovery'
import { WINDOWS_USB_SPOOLER_SCRIPT } from '../src/main/printing/windowsUsbSpoolerScript'

describe('shared Windows USB identity proof', () => {
  it('uses the same fresh proof in inventory and the independent pre-effect worker', () => {
    for (const script of [WINDOWS_USB_QUEUE_INVENTORY_SCRIPT, WINDOWS_USB_SPOOLER_SCRIPT]) {
      expect(script.startsWith(WINDOWS_USB_IDENTITY_SCRIPT)).toBe(true)
      expect(script.match(/function Resolve-UsbPortDevice/g)).toHaveLength(1)
      expect(script).toContain('Resolve-UsbPortDevice ')
    }
    // Keep the native identity proof outside the spooler's one-shot write gate.
    expect(WINDOWS_USB_IDENTITY_SCRIPT).not.toMatch(/WritePrinter|StartDocPrinter|Set-ItemProperty|New-Item|Remove-Item/)
    expect(WINDOWS_USB_SPOOLER_SCRIPT.indexOf('Assert-UsbReady\n  [Console]')).toBeLessThan(
      WINDOWS_USB_SPOOLER_SCRIPT.indexOf("if ([Console]::ReadLine() -cne 'GO')"),
    )
  })

  it.runIf(process.platform === 'win32')('executes failure and compatibility semantics with memory-backed PS5 ports', () => {
    const fixture = readFileSync(join(__dirname, 'fixtures/windows-usb-identity.ps1'), 'utf8')
    const script = `$ErrorActionPreference='Stop'\n${WINDOWS_USB_IDENTITY_SCRIPT}\n${fixture}\n\n`
    const stdout = execFileSync(win32.join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], { input: script, encoding: 'utf8', timeout: 15_000 })
    const result = JSON.parse(stdout.trim())
    expect(result).toMatchObject({ passed: 34, failed: 0, realRegistryOrPnpRead: false, printing: false })
  })

  it.runIf(process.platform === 'win32')('runs unchanged inventory and probe consumers through memory-backed ports', () => {
    const definitions = readFileSync(join(__dirname, 'fixtures/windows-usb-identity.ps1'), 'utf8')
      .split("Test-IdentityCase 'valid legacy only'")[0]!
    const ports = readFileSync(join(__dirname, 'fixtures/windows-usb-probe-ports.ps1'), 'utf8')
    const exe = win32.join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe')
    // The short bootstrap avoids putting scripts/data on disk or in an oversized argv.
    const bootstrap = Buffer.from('& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))', 'utf16le').toString('base64')
    const run = (script: string) => execFileSync(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', bootstrap],
      { input: `$ErrorActionPreference='Stop'\n${definitions}\n${ports}\n${script}`, encoding: 'utf8', timeout: 15_000 }).trim()
    const endpoint = { kind: 'windows-usb', queueName: 'Synthetic FRONT', portName: 'USB003',
      deviceInstanceId: 'USB\\VID_0483&PID_5743\\SYNTHETIC-DEVICE' }
    const probe = (change = '', expectedDevice = endpoint.deviceInstanceId) => run(`${change}\n` +
      `[Console]::SetIn([IO.StringReader]::new('${JSON.stringify({ mode: 'probe', endpoint: { ...endpoint, deviceInstanceId: expectedDevice } })}'))\n` + WINDOWS_USB_SPOOLER_SCRIPT)
    expect(probe()).toBe('READY')
    for (const mutation of [
      "$script:Queues[0].PortName='USB001'", '$script:Queues += $script:Queues[0]',
      '$script:Queues[0].WorkOffline=$true', '$script:Queues[0].Shared=$true', '$script:Fixture.Physical=@{}',
      "$script:Fixture.LegacyExists=$true;$script:Fixture.Parameters[$script:Child]='USB004'",
    ]) expect(probe(mutation)).toBe('FAILED')
    expect(probe('', 'USB\\VID_0525&PID_A4A8\\OTHER-DEVICE')).toBe('FAILED')
    const inventory = JSON.parse(Buffer.from(run(WINDOWS_USB_QUEUE_INVENTORY_SCRIPT), 'base64').toString('utf8'))
    expect(inventory).toEqual([endpoint])
    const moved = JSON.parse(Buffer.from(run("$script:Queues[0].PortName='USB001'\n" + WINDOWS_USB_QUEUE_INVENTORY_SCRIPT), 'base64').toString('utf8'))
    expect(moved).toEqual([])
  }, 30_000)
})
