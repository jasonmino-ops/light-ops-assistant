import { execFile } from 'node:child_process'
import { isIPv4 } from 'node:net'
import { parsePrivateTcpEndpoint } from './localEndpointAuthority'

export type TcpDiagnosticTarget = {
  host: string
  port: number
  localAddress: string
  network: string
  mac: string
}
export type ProveTcpDiagnosticTarget = (target: { host: string; port: number }, timeoutMs?: number) => Promise<TcpDiagnosticTarget | null>

// Only a validated, canonical numeric IPv4 literal enters this fixed command.
function proofCommand(host: string): string {
  return `$ErrorActionPreference = 'Stop'
$target = '${host}'
function IpNumber([string]$ip) {
  $bytes = ([Net.IPAddress]::Parse($ip)).GetAddressBytes()
  [Array]::Reverse($bytes)
  return [BitConverter]::ToUInt32($bytes, 0)
}
function Subnet([string]$ip, [int]$bits) { return ((IpNumber $ip) -shr (32 - $bits)) }
function DirectPath {
  $selected = @(Find-NetRoute -RemoteIPAddress $target)
  $routes = @($selected | Where-Object { $_.DestinationPrefix })
  $sources = @($selected | Where-Object { $_.IPAddress })
  if ($routes.Count -ne 1 -or $sources.Count -ne 1) { throw 'ROUTE_UNAVAILABLE' }
  $route = $routes[0]
  $source = $sources[0]
  $parts = $route.DestinationPrefix.Split('/')
  $bits = [int]$parts[1]
  if ($route.NextHop -ne '0.0.0.0' -or $bits -lt 1 -or $bits -gt 30 -or
      $route.InterfaceIndex -ne $source.InterfaceIndex -or $source.PrefixLength -ne $bits -or
      $source.Type -ne 'Unicast' -or $source.AddressState -ne 'Preferred' -or $source.SkipAsSource -or
      (Subnet $target $bits) -ne (Subnet $source.IPAddress $bits) -or
      (Subnet $target $bits) -ne (Subnet $parts[0] $bits)) { throw 'DIRECT_ROUTE_REQUIRED' }
  $networkStart = [uint64](Subnet $target $bits) -shl (32 - $bits)
  $broadcast = $networkStart + (([uint64]1 -shl (32 - $bits)) - 1)
  $address = IpNumber $target
  if ($address -le $networkStart -or $address -ge $broadcast -or $target -eq $source.IPAddress) { throw 'UNICAST_REQUIRED' }
  $onLink = @(Get-NetRoute -AddressFamily IPv4 -PolicyStore ActiveStore -NextHop '0.0.0.0' | Where-Object {
    $prefix = $_.DestinationPrefix.Split('/')
    $length = [int]$prefix[1]
    $length -gt 0 -and (Subnet $target $length) -eq (Subnet $prefix[0] $length)
  })
  $sameSource = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $source.IPAddress -PolicyStore ActiveStore)
  if ($sameSource.Count -ne 1 -or $sameSource[0].InterfaceIndex -ne $source.InterfaceIndex -or
      $onLink.Count -ne 1 -or $onLink[0].InterfaceIndex -ne $route.InterfaceIndex -or
      $onLink[0].DestinationPrefix -ne $route.DestinationPrefix) { throw 'AMBIGUOUS_ROUTE' }
  $adapters = @(Get-NetAdapter -Physical | Where-Object { $_.ifIndex -eq $route.InterfaceIndex -and $_.Status -eq 'Up' })
  if ($adapters.Count -ne 1 -or !$adapters[0].InterfaceGuid) { throw 'PHYSICAL_ADAPTER_REQUIRED' }
  return [pscustomobject]@{
    localAddress = [string]$source.IPAddress
    network = "$($source.InterfaceIndex)|$($adapters[0].InterfaceGuid)|$($route.DestinationPrefix)"
  }
}
$before = DirectPath
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EshopDiagnosticArp { [DllImport("iphlpapi.dll", ExactSpelling=true)] public static extern UInt32 SendARP(UInt32 destination, UInt32 source, byte[] address, ref UInt32 length); }'
[byte[]]$bytes = New-Object byte[] 6
[uint32]$length = 6
$dst = [BitConverter]::ToUInt32(([Net.IPAddress]::Parse($target)).GetAddressBytes(), 0)
$src = [BitConverter]::ToUInt32(([Net.IPAddress]::Parse($before.localAddress)).GetAddressBytes(), 0)
if ([EshopDiagnosticArp]::SendARP($dst, $src, $bytes, [ref]$length) -ne 0 -or $length -ne 6) { throw 'ARP_UNAVAILABLE' }
$after = DirectPath
if ($before.localAddress -ne $after.localAddress -or $before.network -ne $after.network) { throw 'ROUTE_CHANGED' }
[Console]::WriteLine((@{localAddress=$after.localAddress; network=$after.network; mac=[BitConverter]::ToString($bytes)} | ConvertTo-Json -Compress))`
}

function runProof(command: string, timeout: number): Promise<string> {
  const root = process.env.SystemRoot
  if (root?.toLowerCase() !== 'c:\\windows') return Promise.reject(new Error('WINDOWS_ROOT_UNVERIFIED'))
  const system = `${root}\\System32`
  const powershell = `${system}\\WindowsPowerShell\\v1.0`
  return new Promise((resolve, reject) => {
    execFile(`${powershell}\\powershell.exe`, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
      { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 4096, cwd: system,
        env: { SystemRoot: root, WINDIR: root, PATH: system, PSModulePath: `${powershell}\\Modules`,
          TEMP: process.env.TEMP, TMP: process.env.TMP } },
      (error, stdout) => error ? reject(error) : resolve(stdout))
  })
}

export async function proveTcpDiagnosticTarget(
  target: { host: string; port: number }, timeoutMs = 5000,
  platform = process.platform, run = runProof,
): Promise<TcpDiagnosticTarget | null> {
  const endpoint = parsePrivateTcpEndpoint(target)
  if (platform !== 'win32' || !endpoint || timeoutMs < 1) return null
  try {
    const { localAddress, network, mac } = JSON.parse(await run(proofCommand(endpoint.host), timeoutMs))
    if (typeof localAddress !== 'string' || !isIPv4(localAddress) || localAddress === endpoint.host ||
        typeof network !== 'string' || !/^\d+\|\{?[0-9a-f-]{36}\}?\|[0-9.]+\/(?:[1-9]|[12]\d|30)$/i.test(network) ||
        typeof mac !== 'string' || !/^[0-9a-f]{2}(?:-[0-9a-f]{2}){5}$/i.test(mac) ||
        mac === '00-00-00-00-00-00' || (parseInt(mac.slice(0, 2), 16) & 1)) return null
    return { ...endpoint, localAddress, network: network.toLowerCase(), mac: mac.toLowerCase() }
  } catch {
    return null
  }
}

export function sameTcpDiagnosticTarget(a: TcpDiagnosticTarget, b: TcpDiagnosticTarget | null): boolean {
  return !!b && a.host === b.host && a.port === b.port && a.localAddress === b.localAddress &&
    a.network === b.network && a.mac === b.mac
}
