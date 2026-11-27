/** Shared read-only proof used by discovery and by the fresh pre-effect worker.
 * A port selects a mapping; the persisted physical USB instance remains identity.
 * Native USBPRINT layouts must never turn missing/ambiguous evidence into READY.
 */
export const WINDOWS_USB_IDENTITY_SCRIPT = String.raw`
function Resolve-UsbPortDevice([string]$portName) {
  if ($portName -cnotmatch '\AUSB[0-9]{3,5}\z') { throw 'USB_PORT_INVALID' }
  $physicalPattern = '\AUSB\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}(?:&MI_[0-9A-F]{2})?\\[A-Z0-9&_.-]{1,100}\z'
  $legacy = $null
  $portKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Print\Monitors\USB Monitor\Ports\' + $portName
  if (Test-Path -LiteralPath $portKey -ErrorAction Stop) {
    $mapping = @(Get-ItemProperty -LiteralPath $portKey -Name 'Device Id' -ErrorAction Stop)
    if ($mapping.Count -ne 1 -or $mapping[0].'Device Id' -isnot [string] -or
        $mapping[0].'Device Id' -inotmatch $physicalPattern) { throw 'USB_PORT_IDENTITY_INVALID' }
    $legacy = $mapping[0].'Device Id'.ToUpperInvariant()
  }

  $native = @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object { $_.InstanceId -imatch '\AUSBPRINT\\' })
  if ($native.Count -gt 16) { throw 'USB_NATIVE_INVENTORY_LIMIT' }
  $parents = @()
  $bindings = @()
  foreach ($node in $native) {
    $instance = $node.InstanceId
    if ($instance -isnot [string] -or
        $instance -inotmatch '\AUSBPRINT\\[A-Z0-9&_.-]{1,160}\\[A-Z0-9&_.-]{1,160}\z' -or
        $instance.Split('\') -contains '..') { throw 'USB_NATIVE_IDENTITY_INVALID' }
    $parameters = @(Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Enum\' +
      $instance + '\Device Parameters') -Name 'PortName' -ErrorAction Stop)
    if ($parameters.Count -ne 1 -or $parameters[0].PortName -isnot [string] -or
        $parameters[0].PortName -cnotmatch '\AUSB[0-9]{3,5}\z') { throw 'USB_NATIVE_PORT_INVALID' }
    $parent = @(Get-PnpDeviceProperty -InstanceId $instance -KeyName 'DEVPKEY_Device_Parent' -ErrorAction Stop)
    if ($parent.Count -ne 1 -or $parent[0].Data -isnot [string] -or
        $parent[0].Data -inotmatch $physicalPattern) { throw 'USB_NATIVE_PARENT_INVALID' }
    $physical = $parent[0].Data.ToUpperInvariant()
    $bindings += [pscustomobject]@{ PortName=$parameters[0].PortName; DeviceId=$physical }
    if ($parameters[0].PortName -cne $portName) { continue }
    if ($node.Status -cne 'OK') { throw 'USB_DEVICE_NOT_READY' }
    $parents += $physical
  }
  if ($parents.Count -gt 1) { throw 'USB_NATIVE_PORT_NOT_UNIQUE' }
  if ($legacy -and $parents.Count -eq 1 -and $parents[0] -cne $legacy) { throw 'USB_PORT_IDENTITY_CONFLICT' }
  $deviceId = $legacy
  if (-not $deviceId -and $parents.Count -eq 1) { $deviceId = $parents[0] }
  if (-not $deviceId) { throw 'USB_PORT_IDENTITY_UNAVAILABLE' }
  if (@($bindings | Where-Object { $_.DeviceId -ceq $deviceId -and $_.PortName -cne $portName }).Count) {
    throw 'USB_PORT_IDENTITY_CONFLICT'
  }
  $device = @(Get-PnpDevice -PresentOnly -InstanceId $deviceId -ErrorAction Stop)
  if ($device.Count -ne 1 -or $device[0].InstanceId -ine $deviceId -or $device[0].Status -cne 'OK') {
    throw 'USB_DEVICE_NOT_READY'
  }
  return $deviceId
}
`
