import { execFile } from 'node:child_process'
import { win32 } from 'node:path'
import { promisify } from 'node:util'
import { parseWindowsUsbEndpoint, windowsUsbEndpointKey, type WindowsUsbEndpoint } from './windowsUsbEndpoint'
import { WindowsUsbPrintBoundary } from './windowsUsbPrintBoundary'

const USB_INVENTORY = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ((Get-Service -Name Spooler).Status -ne 'Running') { exit 1 }
$queues = @(Get-CimInstance Win32_Printer | Where-Object { $_.PortName -cmatch '\AUSB[0-9]{3,5}\z' })
if ($queues.Count -gt 16) { exit 1 }
$result = @(
  foreach ($queue in $queues) {
    try {
      $portKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Print\Monitors\USB Monitor\Ports\' + $queue.PortName
      $id = (Get-ItemProperty -LiteralPath $portKey -Name 'Device Id').'Device Id'
      if ($id) {
        @{ kind = 'windows-usb'; queueName = $queue.Name; portName = $queue.PortName; deviceInstanceId = $id.ToUpperInvariant() }
      }
    } catch { continue }
  }
)
$json = ConvertTo-Json -InputObject $result -Compress
[Console]::WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
`

export async function discoverWindowsUsbQueues(): Promise<WindowsUsbEndpoint[]> {
  const root = process.env.SystemRoot
  if (process.platform !== 'win32' || root?.toLowerCase() !== 'c:\\windows') throw new Error('USB_QUEUE_DISCOVERY_FAILED')
  const system = win32.join(root, 'System32')
  const powershell = win32.join(system, 'WindowsPowerShell', 'v1.0')
  const { stdout } = await promisify(execFile)(win32.join(powershell, 'powershell.exe'), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(USB_INVENTORY, 'utf16le').toString('base64'),
  ], {
    cwd: system, windowsHide: true, timeout: 5_000, maxBuffer: 32_768,
    env: { SystemRoot: root, WINDIR: root, PATH: system, PSModulePath: win32.join(powershell, 'Modules'),
      TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: process.env.USERPROFILE, LOCALAPPDATA: process.env.LOCALAPPDATA },
  })
  const inventory: unknown = JSON.parse(Buffer.from(stdout.trim(), 'base64').toString('utf8'))
  if (!Array.isArray(inventory) || inventory.length > 16) throw new Error('USB_QUEUE_DISCOVERY_FAILED')
  const usb = new WindowsUsbPrintBoundary()
  const eligible: WindowsUsbEndpoint[] = []
  for (let offset = 0; offset < inventory.length; offset += 4) {
    const group = await Promise.all(inventory.slice(offset, offset + 4).map(async (value) => {
      const endpoint = parseWindowsUsbEndpoint(value)
      return endpoint && await usb.isReady(windowsUsbEndpointKey(endpoint)) ? endpoint : null
    }))
    for (const endpoint of group) if (endpoint) eligible.push(endpoint)
  }
  return eligible
}
