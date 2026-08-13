import assert from "node:assert/strict";
import test from "node:test";
import {
  decideDriverProvisioning,
  parseWindowsPrinterDriversJson,
  parseWindowsUsbPrinterJson,
  printerFingerprint,
} from "../src/index.js";

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
  assert.deepEqual(parseWindowsUsbPrinterJson("null"), []);
  assert.throws(() => parseWindowsUsbPrinterJson(JSON.stringify({ Name: "No identity" })), /DEVICE_ID_REQUIRED/);
  assert.throws(() => parseWindowsUsbPrinterJson("not-json"), /INVALID_WINDOWS_USB_PRINTER_JSON/);
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
