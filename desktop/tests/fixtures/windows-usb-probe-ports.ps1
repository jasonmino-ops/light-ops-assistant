# Extends windows-usb-identity.ps1's memory-backed read ports. Probe mode only.
$script:Fixture=New-IdentityFixture
$script:Queues=@([pscustomobject]@{Name='Synthetic FRONT';PortName='USB003';Local=$true;Network=$false;Shared=$false;Default=$false;WorkOffline=$false;PrinterStatus=3;DetectedErrorState=0})
function Get-Service { param([string]$Name) if($Name -cne 'Spooler'){throw 'FAKE_SERVICE_UNEXPECTED'};return [pscustomobject]@{Status='Running'} }
function Get-CimInstance { param([string]$ClassName) if($ClassName -cne 'Win32_Printer'){throw 'FAKE_CIM_UNEXPECTED'};return $script:Queues }
function Get-Printer { param([string]$Name) if($Name -cne 'Synthetic FRONT'){throw 'FAKE_QUEUE_UNEXPECTED'};return [pscustomobject]@{PrinterStatus=0} }
function Get-PrintJob { param([string]$PrinterName) if($PrinterName -cne 'Synthetic FRONT'){throw 'FAKE_QUEUE_UNEXPECTED'};return @() }
