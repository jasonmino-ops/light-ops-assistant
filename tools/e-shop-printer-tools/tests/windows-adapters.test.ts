import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  decideDriverProvisioning,
  parseWindowsPrinterDriversJson,
  parseWindowsUsbPrinterJson,
  printerFingerprint,
  WINDOWS_USB_PRINTER_QUERY,
  WindowsUsbPrinterDiscoveryAdapter,
} from "../src/index.js";

const pos80Fixture = readFileSync(new URL("../fixtures/windows-pos80-usb.json", import.meta.url), "utf8");

test("generic Windows USB discovery preserves PnP identity and extracts VID/PID", () => {
  const printers = parseWindowsUsbPrinterJson(JSON.stringify({
    Manufacturer: "Fixture Manufacturer",
    Name: "Fixture USB Printer",
    DeviceID: "USBPRINT\\FIXTURE",
    PNPDeviceID: "USB\\VID_1234&PID_ABCD\\SYNTHETIC",
    HardwareID: ["USBPRINT\\FIXTURE", "USB\\VID_1234&PID_ABCD"],
    Status: "OK",
    ExistingQueues: [{ Name: "Old Queue", DriverName: "Fixture Driver", PortName: "USB001" }],
  }));
  assert.equal(printers.length, 1);
  assert.equal(printers[0].transport, "USB");
  assert.deepEqual(printers[0].capabilities, ["USB"]);
  assert.equal(printers[0].metadata.vendorId, "1234");
  assert.equal(printers[0].metadata.productId, "ABCD");
  assert.equal(printerFingerprint(printers[0]), "USB:USB\\VID_1234&PID_ABCD\\SYNTHETIC");
});

test("generic Windows USB discovery handles empty and rejects identity-free records", () => {
  assert.deepEqual(parseWindowsUsbPrinterJson(""), []);
  assert.deepEqual(parseWindowsUsbPrinterJson("   \r\n"), []);
  assert.deepEqual(parseWindowsUsbPrinterJson("[]"), []);
  assert.deepEqual(parseWindowsUsbPrinterJson("null"), []);
  assert.throws(() => parseWindowsUsbPrinterJson(JSON.stringify({ Name: "No identity" })), /DEVICE_ID_REQUIRED/);
  assert.throws(() => parseWindowsUsbPrinterJson("not-json"), /INVALID_WINDOWS_USB_PRINTER_JSON/);
});

test("POS-80 field fixture preserves Unicode, USB identity, USBPRINT identity, VID/PID, and serial", () => {
  const printers = parseWindowsUsbPrinterJson(pos80Fixture);
  assert.equal(printers.length, 1);
  assert.equal(printers[0].model, "Printer POS-80 / 芯烨小票打印机");
  assert.equal(printers[0].metadata.pnpDeviceId, "USB\\VID_0483&PID_5743\\1C7D57980000");
  assert.equal(printers[0].metadata.usbPrintIdentity, "USBPRINT\\PRINTERPOS-80\\1C7D57980000");
  assert.equal(printers[0].metadata.vendorId, "0483");
  assert.equal(printers[0].metadata.productId, "5743");
  assert.equal(printers[0].metadata.serialNumber, "1C7D57980000");
});

test("generic Windows USB parser normalizes one object and multiple records to arrays", () => {
  const one = JSON.parse(pos80Fixture);
  const second = {
    ...one,
    FriendlyName: "Generic Receipt Printer 二号",
    InstanceId: "USBPRINT\\GENERICRECEIPT\\SERIAL2",
    UsbInstanceId: "USB\\VID_1234&PID_5678\\SERIAL2",
    USBPRINTIdentity: "USBPRINT\\GENERICRECEIPT\\SERIAL2",
    SerialNumber: "SERIAL2",
  };
  assert.equal(parseWindowsUsbPrinterJson(JSON.stringify(one)).length, 1);
  assert.equal(parseWindowsUsbPrinterJson(JSON.stringify([one, second])).length, 2);
});

test("generic Windows USB parser rejects malformed JSON and deduplicates stable identities", () => {
  const one = JSON.parse(pos80Fixture);
  assert.throws(() => parseWindowsUsbPrinterJson('{"FriendlyName":'), /INVALID_WINDOWS_USB_PRINTER_JSON/);
  assert.equal(parseWindowsUsbPrinterJson(JSON.stringify([one, one])).length, 1);
});

test("Windows USB query has a UTF-8 JSON-only stdout contract and always serializes an array", () => {
  assert.match(WINDOWS_USB_PRINTER_QUERY, /Get-PnpDevice -PresentOnly/);
  assert.match(WINDOWS_USB_PRINTER_QUERY, /Console\]::OutputEncoding/);
  assert.match(WINDOWS_USB_PRINTER_QUERY, /ConvertTo-Json -InputObject @\(\$records\)/);
  assert.match(WINDOWS_USB_PRINTER_QUERY, /Console\]::Out\.Write\(\$json\)/);
  assert.match(WINDOWS_USB_PRINTER_QUERY, /Console\]::Error\.WriteLine/);
  assert.doesNotMatch(WINDOWS_USB_PRINTER_QUERY, /Get-CimInstance Win32_PnPEntity/);
});

test("Windows USB adapter accepts valid stdout despite stderr warning and propagates process failures", async () => {
  const warningRunner = {
    stderr: "fixture warning",
    async runPowerShell() { return pos80Fixture; },
  };
  assert.equal((await new WindowsUsbPrinterDiscoveryAdapter(warningRunner).discover()).length, 1);

  const nonZeroRunner = { async runPowerShell() { throw new Error("WINDOWS_USB_DISCOVERY_QUERY_FAILED exit code 1"); } };
  await assert.rejects(() => new WindowsUsbPrinterDiscoveryAdapter(nonZeroRunner).discover(), /exit code 1/);

  const timeoutRunner = { async runPowerShell() { throw Object.assign(new Error("WINDOWS_USB_DISCOVERY_TIMEOUT"), { code: "ETIMEDOUT" }); } };
  await assert.rejects(() => new WindowsUsbPrinterDiscoveryAdapter(timeoutRunner).discover(), /TIMEOUT/);
});

test("driver adapter reuses an exact installed driver idempotently", () => {
  const drivers = parseWindowsPrinterDriversJson(JSON.stringify([{
    Name: "Fixture Printer Driver",
    Manufacturer: "Fixture Manufacturer",
    MajorVersion: 3,
    DriverVersion: "1.2.3.4",
    InfPath: "C:\\Windows\\INF\\fixture.inf",
    Environment: "Windows x64",
  }]));
  const decision = decideDriverProvisioning("Fixture Printer Driver", drivers);
  assert.equal(decision.action, "REUSE_INSTALLED_DRIVER");
  assert.equal(decision.ready, true);
  assert.deepEqual(decision.blockers, []);
});

test("driver adapter blocks missing-driver automation until a safe path is verified", () => {
  const decision = decideDriverProvisioning("Unknown RP331A Driver", []);
  assert.equal(decision.action, "BLOCK_MISSING_DRIVER");
  assert.equal(decision.ready, false);
  assert.deepEqual(decision.blockers, ["SAFE_DRIVER_ONLY_AUTOMATION_NOT_VERIFIED"]);
});
