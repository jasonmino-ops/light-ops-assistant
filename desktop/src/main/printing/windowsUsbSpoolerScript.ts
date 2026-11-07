// The Windows child performs no printing until the parent grants the one-shot GO.
// The print data is sent over stdin and is never part of the command line.
export const WINDOWS_USB_SPOOLER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$handle = [IntPtr]::Zero
try {
  $request = [Console]::ReadLine() | ConvertFrom-Json
  $target = $request.endpoint
  if ($target.queueName -cne 'E-Shop Diamond FRONT USB' -or
      $target.portName -cnotmatch '^USB[0-9]{3,5}$' -or
      $target.deviceInstanceId -cnotmatch '^USB\\VID_0FE6&PID_811E\\[A-Z0-9&_.-]{1,100}$') {
    throw 'USB_ENDPOINT_INVALID'
  }

  function Assert-UsbReady {
    if ((Get-Service -Name Spooler).Status -ne 'Running') { throw 'SPOOLER_NOT_RUNNING' }
    $portKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Print\Monitors\USB Monitor\Ports\' + $target.portName
    $deviceId = (Get-ItemProperty -LiteralPath $portKey -Name 'Device Id').'Device Id'
    if ($deviceId -ine $target.deviceInstanceId) { throw 'USB_PORT_IDENTITY_MISMATCH' }
    $device = @(Get-PnpDevice -PresentOnly -InstanceId $target.deviceInstanceId)
    if ($device.Count -ne 1 -or $device[0].InstanceId -ine $target.deviceInstanceId -or $device[0].Status -ne 'OK') {
      throw 'USB_DEVICE_NOT_READY'
    }
    $queues = @(Get-CimInstance Win32_Printer | Where-Object {
      $_.PortName -split ',' -contains $target.portName
    })
    if ($queues.Count -ne 1) { throw 'USB_PORT_QUEUE_NOT_UNIQUE' }
    $queue = $queues[0]
    if ($queue.Name -ine $target.queueName -or $queue.PortName -ine $target.portName -or
        -not $queue.Local -or $queue.Network -or $queue.Shared -or $queue.Default -or $queue.WorkOffline -or
        $queue.PrinterStatus -ne 3 -or $queue.DetectedErrorState -notin @(0, 2)) {
      throw 'USB_QUEUE_NOT_READY'
    }
    $state = Get-Printer -Name $target.queueName
    if ([int]$state.PrinterStatus -ne 0 -or @(Get-PrintJob -PrinterName $target.queueName).Count -ne 0) {
      throw 'USB_QUEUE_NOT_IDLE'
    }
  }

  if ($request.mode -eq 'probe') {
    Assert-UsbReady
    [Console]::WriteLine('READY')
    exit 0
  }
  if ($request.mode -ne 'print') { throw 'USB_MODE_INVALID' }
  $bytes = [Convert]::FromBase64String($request.payload)
  if ($bytes.Length -lt 1 -or $bytes.Length -gt 3145728) { throw 'USB_PAYLOAD_INVALID' }

  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[assembly: DefaultDllImportSearchPaths(DllImportSearchPath.System32)]

public static class DiamondFrontSpooler {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DocumentInfo {
        public string Name;
        public string Output;
        public string Type;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, ExactSpelling = true)]
    public static extern bool Open(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", ExactSpelling = true)]
    public static extern bool Close(IntPtr handle);
    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint StartDoc(IntPtr handle, uint level, ref DocumentInfo info);
    [DllImport("winspool.drv", ExactSpelling = true)]
    private static extern bool StartPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", ExactSpelling = true)]
    private static extern bool WritePrinter(IntPtr handle, byte[] bytes, uint size, out uint written);
    [DllImport("winspool.drv", ExactSpelling = true)]
    private static extern bool EndPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", ExactSpelling = true)]
    private static extern bool EndDocPrinter(IntPtr handle);
    [DllImport("winspool.drv", ExactSpelling = true)]
    private static extern bool AbortPrinter(IntPtr handle);

    public static uint Submit(IntPtr handle, byte[] bytes) {
        var info = new DocumentInfo { Name = "E-Shop FRONT", Type = "RAW" };
        uint id = StartDoc(handle, 1, ref info);
        if (id == 0) return 0;
        bool committed = false;
        try {
            uint written;
            committed = StartPagePrinter(handle) &&
                WritePrinter(handle, bytes, (uint)bytes.Length, out written) &&
                written == bytes.Length && EndPagePrinter(handle) && EndDocPrinter(handle);
            return committed ? id : 0;
        } finally {
            if (!committed) AbortPrinter(handle);
        }
    }
}
'@
  if (-not [DiamondFrontSpooler]::Open($target.queueName, [ref]$handle, [IntPtr]::Zero)) {
    throw 'USB_SPOOLER_OPEN_FAILED'
  }
  Assert-UsbReady
  [Console]::WriteLine('READY')
  if ([Console]::ReadLine() -cne 'GO') { exit 1 }
  $job = [DiamondFrontSpooler]::Submit($handle, $bytes)
  if ($job -gt 0) { [Console]::WriteLine('SPOOLED:' + $job) }
  else { [Console]::WriteLine('UNKNOWN') }
} catch {
  [Console]::WriteLine('FAILED')
} finally {
  if ($handle -ne [IntPtr]::Zero) { [void][DiamondFrontSpooler]::Close($handle) }
}
`
