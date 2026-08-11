param(
  [Parameter(Mandatory = $true)]
  [string]$PrinterName,
  [Parameter(Mandatory = $false)]
  [string]$DocumentName = "E-Shop Tray"
)

$ErrorActionPreference = "Stop"

$nativeSource = @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class EShopRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DOC_INFO_1
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinter(string printerName, out IntPtr printerHandle, IntPtr defaults);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int StartDocPrinter(IntPtr printerHandle, int level, ref DOC_INFO_1 docInfo);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr printerHandle, IntPtr bytes, int count, out int written);

    private static void ThrowLastError(string operation)
    {
        throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }

    public static int Send(string printerName, string documentName, byte[] payload)
    {
        if (payload == null || payload.Length == 0) throw new ArgumentException("EMPTY_COMMAND_STREAM");

        IntPtr printer = IntPtr.Zero;
        IntPtr unmanaged = IntPtr.Zero;
        bool documentStarted = false;
        bool pageStarted = false;
        try
        {
            if (!OpenPrinter(printerName, out printer, IntPtr.Zero)) ThrowLastError("OpenPrinter");
            var info = new DOC_INFO_1
            {
                pDocName = documentName,
                pOutputFile = null,
                pDataType = "RAW"
            };
            if (StartDocPrinter(printer, 1, ref info) == 0) ThrowLastError("StartDocPrinter");
            documentStarted = true;
            if (!StartPagePrinter(printer)) ThrowLastError("StartPagePrinter");
            pageStarted = true;

            unmanaged = Marshal.AllocCoTaskMem(payload.Length);
            Marshal.Copy(payload, 0, unmanaged, payload.Length);
            int written;
            if (!WritePrinter(printer, unmanaged, payload.Length, out written)) ThrowLastError("WritePrinter");
            if (written != payload.Length) throw new InvalidOperationException("PARTIAL_WRITE");
            return written;
        }
        finally
        {
            if (unmanaged != IntPtr.Zero) Marshal.FreeCoTaskMem(unmanaged);
            if (pageStarted) EndPagePrinter(printer);
            if (documentStarted) EndDocPrinter(printer);
            if (printer != IntPtr.Zero) ClosePrinter(printer);
        }
    }
}
"@

Add-Type -TypeDefinition $nativeSource -Language CSharp | Out-Null

try {
  $encoded = [Console]::In.ReadToEnd().Trim()
  if ([string]::IsNullOrWhiteSpace($encoded)) { throw "EMPTY_COMMAND_STREAM" }
  $payload = [Convert]::FromBase64String($encoded)
  $written = [EShopRawPrinter]::Send($PrinterName, $DocumentName, $payload)
  [Console]::Out.WriteLine((@{ ok = $true; bytesWritten = $written } | ConvertTo-Json -Compress))
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
