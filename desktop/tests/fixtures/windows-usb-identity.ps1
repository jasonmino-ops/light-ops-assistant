# Pure-memory ports for the production resolver. No real registry/PnP/print calls.
$script:Primary = 'USB\VID_0483&PID_5743\SYNTHETIC-DEVICE'
$script:Other = 'USB\VID_0525&PID_A4A8\OTHER-DEVICE'
$script:Child = 'USBPRINT\PRINTERPOS-80\SYNTHETIC&USB003'
$script:Results = New-Object 'Collections.Generic.List[object]'
function New-IdentityFixture {
  return [pscustomobject]@{
    LegacyExists=$false; LegacyValue=$script:Primary; LegacyPathError=$false; LegacyReadError=$false
    EnumerationError=$false; Native=@([pscustomobject]@{InstanceId=$script:Child;Status='OK'})
    Parameters=@{$script:Child='USB003'}; Parents=@{$script:Child=@([pscustomobject]@{Data=$script:Primary})}
    Physical=@{$script:Primary=@([pscustomobject]@{InstanceId=$script:Primary;Status='OK'})}
    Trace=(New-Object 'Collections.Generic.List[string]')
  }
}
function Test-Path {
  param([string]$LiteralPath, [object]$ErrorAction)
  $script:Fixture.Trace.Add('legacy-key')
  if ($script:Fixture.LegacyPathError) { throw 'FAKE_LEGACY_PATH_DENIED' }
  return $script:Fixture.LegacyExists
}
function Get-ItemProperty {
  param([string]$LiteralPath, [string]$Name, [object]$ErrorAction)
  if ($Name -ceq 'Device Id') {
    $script:Fixture.Trace.Add('legacy-value')
    if ($script:Fixture.LegacyReadError) { throw 'FAKE_LEGACY_READ_FAILED' }
    return [pscustomobject]@{'Device Id'=$script:Fixture.LegacyValue}
  }
  $prefix='HKLM:\SYSTEM\CurrentControlSet\Enum\';$suffix='\Device Parameters'
  if ($Name -cne 'PortName' -or -not $LiteralPath.StartsWith($prefix) -or -not $LiteralPath.EndsWith($suffix)) {
    throw 'FAKE_UNEXPECTED_READ'
  }
  $id=$LiteralPath.Substring($prefix.Length,$LiteralPath.Length-$prefix.Length-$suffix.Length)
  $script:Fixture.Trace.Add('native-port')
  if (-not $script:Fixture.Parameters.ContainsKey($id)) { throw 'FAKE_NATIVE_READ_FAILED' }
  return [pscustomobject]@{PortName=$script:Fixture.Parameters[$id]}
}
function Get-PnpDevice {
  param([switch]$PresentOnly, [string]$InstanceId, [object]$ErrorAction)
  if (-not $PresentOnly) { throw 'FAKE_PRESENT_ONLY_REQUIRED' }
  if ($InstanceId) {
    $script:Fixture.Trace.Add('physical-presence')
    if (-not $script:Fixture.Physical.ContainsKey($InstanceId)) { return @() }
    return $script:Fixture.Physical[$InstanceId]
  }
  $script:Fixture.Trace.Add('native-enumeration')
  if ($script:Fixture.EnumerationError) { throw 'FAKE_NATIVE_ENUMERATION_FAILED' }
  return $script:Fixture.Native
}
function Get-PnpDeviceProperty {
  param([string]$InstanceId, [string]$KeyName, [object]$ErrorAction)
  if ($KeyName -cne 'DEVPKEY_Device_Parent') { throw 'FAKE_UNEXPECTED_PARENT_READ' }
  $script:Fixture.Trace.Add('direct-parent')
  if (-not $script:Fixture.Parents.ContainsKey($InstanceId)) { throw 'FAKE_PARENT_READ_FAILED' }
  return $script:Fixture.Parents[$InstanceId]
}
function Test-IdentityCase {
  param([string]$Name,[scriptblock]$Prepare,[string]$ExpectedError='', [string]$Port='USB003', [string]$ExpectedDevice=$script:Primary)
  $script:Fixture=New-IdentityFixture
  & $Prepare $script:Fixture
  $failure=$null;$actual=$null
  try { $actual=Resolve-UsbPortDevice $Port } catch { $failure=$_.Exception.Message }
  $ok=if($ExpectedError){$failure -ceq $ExpectedError}else{(-not $failure) -and $actual -ceq $ExpectedDevice}
  $script:Results.Add([pscustomobject]@{name=$Name;passed=$ok;expectedError=$ExpectedError;actualError=$failure;device=$actual})
}
Test-IdentityCase 'valid legacy only' {param($f) $f.LegacyExists=$true;$f.Native=@()}
Test-IdentityCase 'legacy and native agree' {param($f) $f.LegacyExists=$true}
Test-IdentityCase 'native direct parent without legacy key' {param($f)}
Test-IdentityCase 'denied legacy key is not absence' {param($f) $f.LegacyPathError=$true} 'FAKE_LEGACY_PATH_DENIED'
Test-IdentityCase 'unreadable legacy value is not absence' {param($f) $f.LegacyExists=$true;$f.LegacyReadError=$true} 'FAKE_LEGACY_READ_FAILED'
Test-IdentityCase 'empty legacy value is not fallback' {param($f) $f.LegacyExists=$true;$f.LegacyValue=''} 'USB_PORT_IDENTITY_INVALID'
Test-IdentityCase 'multi string legacy value is invalid' {param($f) $f.LegacyExists=$true;$f.LegacyValue=@($script:Primary,$script:Other)} 'USB_PORT_IDENTITY_INVALID'
Test-IdentityCase 'malformed legacy identity is invalid' {param($f) $f.LegacyExists=$true;$f.LegacyValue=$script:Child} 'USB_PORT_IDENTITY_INVALID'
Test-IdentityCase 'contradictory legacy identity cannot win or fallback' {param($f) $f.LegacyExists=$true;$f.LegacyValue=$script:Other} 'USB_PORT_IDENTITY_CONFLICT'
Test-IdentityCase 'stale legacy cannot hide physical parent now at another port' {param($f) $f.LegacyExists=$true;$f.Parameters[$script:Child]='USB004'} 'USB_PORT_IDENTITY_CONFLICT'
Test-IdentityCase 'physical parent on two native ports is ambiguous' {param($f) $id='USBPRINT\SECOND\SYNTHETIC';$f.Native+=([pscustomobject]@{InstanceId=$id;Status='OK'});$f.Parameters[$id]='USB004';$f.Parents[$id]=@([pscustomobject]@{Data=$script:Primary})} 'USB_PORT_IDENTITY_CONFLICT'
Test-IdentityCase 'no legacy or native evidence' {param($f) $f.Native=@()} 'USB_PORT_IDENTITY_UNAVAILABLE'
Test-IdentityCase 'failed enumeration cannot look unique' {param($f) $f.EnumerationError=$true} 'FAKE_NATIVE_ENUMERATION_FAILED'
Test-IdentityCase 'native read failure cannot look unique' {param($f) $f.Parameters=@{}} 'FAKE_NATIVE_READ_FAILED'
Test-IdentityCase 'unreadable unrelated native record also rejects' {param($f) $f.Native+=([pscustomobject]@{InstanceId='USBPRINT\OTHER\UNREADABLE';Status='OK'})} 'FAKE_NATIVE_READ_FAILED'
Test-IdentityCase 'invalid native port' {param($f) $f.Parameters[$script:Child]=''} 'USB_NATIVE_PORT_INVALID'
Test-IdentityCase 'native mapping of another port cannot be followed' {param($f) $f.Parameters[$script:Child]='USB004'} 'USB_PORT_IDENTITY_UNAVAILABLE'
Test-IdentityCase 'duplicate bindings even for same parent' {param($f) $f.Native+=([pscustomobject]@{InstanceId=$script:Child;Status='OK'})} 'USB_NATIVE_PORT_NOT_UNIQUE'
Test-IdentityCase 'unhealthy matching USBPRINT child' {param($f) $f.Native[0].Status='Error'} 'USB_DEVICE_NOT_READY'
Test-IdentityCase 'missing direct parent' {param($f) $f.Parents=@{}} 'FAKE_PARENT_READ_FAILED'
Test-IdentityCase 'multiple parent properties' {param($f) $f.Parents[$script:Child]=@([pscustomobject]@{Data=$script:Primary},[pscustomobject]@{Data=$script:Other})} 'USB_NATIVE_PARENT_INVALID'
Test-IdentityCase 'multi string parent is invalid' {param($f) $f.Parents[$script:Child]=@([pscustomobject]@{Data=@($script:Primary)})} 'USB_NATIVE_PARENT_INVALID'
Test-IdentityCase 'intermediate ancestry is unsupported' {param($f) $f.Parents[$script:Child]=@([pscustomobject]@{Data='USB\ROOT_HUB30\HUB'})} 'USB_NATIVE_PARENT_INVALID'
Test-IdentityCase 'unplugged physical parent' {param($f) $f.Physical=@{}} 'USB_DEVICE_NOT_READY'
Test-IdentityCase 'wrong returned physical identity' {param($f) $f.Physical[$script:Primary]=@([pscustomobject]@{InstanceId=$script:Other;Status='OK'})} 'USB_DEVICE_NOT_READY'
Test-IdentityCase 'unhealthy physical parent' {param($f) $f.Physical[$script:Primary][0].Status='Error'} 'USB_DEVICE_NOT_READY'
Test-IdentityCase 'duplicate physical identities' {param($f) $f.Physical[$script:Primary]+=([pscustomobject]@{InstanceId=$script:Primary;Status='OK'})} 'USB_DEVICE_NOT_READY'
Test-IdentityCase 'bounded native inventory' {param($f) $f.Native=@(1..17|ForEach-Object {[pscustomobject]@{InstanceId=$script:Child;Status='OK'}})} 'USB_NATIVE_INVENTORY_LIMIT'
Test-IdentityCase 'native traversal rejected' {param($f) $f.Native[0].InstanceId='USBPRINT\..\BAD'} 'USB_NATIVE_IDENTITY_INVALID'
Test-IdentityCase 'invalid requested port' {param($f)} 'USB_PORT_INVALID' 'USB003,USB004'
Test-IdentityCase 'legacy identity still needs current physical presence' {param($f) $f.LegacyExists=$true;$f.Native=@();$f.Physical=@{}} 'USB_DEVICE_NOT_READY'
Test-IdentityCase 'legacy cannot mask failed native enumeration' {param($f) $f.LegacyExists=$true;$f.EnumerationError=$true} 'FAKE_NATIVE_ENUMERATION_FAILED'
Test-IdentityCase 'physical identity can be explicitly rebound at another port' {param($f) $f.Parameters[$script:Child]='USB004'} '' 'USB004'
Test-IdentityCase 'new device at old port resolves its actual identity' {param($f) $f.Parents[$script:Child]=@([pscustomobject]@{Data=$script:Other});$f.Physical=@{$script:Other=@([pscustomobject]@{InstanceId=$script:Other;Status='OK'})}} '' 'USB003' $script:Other
$failed=@($script:Results|Where-Object {-not $_.passed})
[Console]::WriteLine(([pscustomobject]@{suite='WINDOWS_USB_IDENTITY_PURE';powershell=$PSVersionTable.PSVersion.ToString();passed=$script:Results.Count-$failed.Count;failed=$failed.Count;cases=$script:Results;realRegistryOrPnpRead=$false;printing=$false}|ConvertTo-Json -Depth 6 -Compress))
if($failed.Count){exit 1}
