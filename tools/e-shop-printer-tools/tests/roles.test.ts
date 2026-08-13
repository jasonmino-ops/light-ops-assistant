import assert from "node:assert/strict";
import test from "node:test";
import { parsePrinterRole, queueNameForRole } from "../src/index.js";

test("accepts only the two frozen printer roles", () => {
  assert.equal(parsePrinterRole("FRONT"), "FRONT");
  assert.equal(parsePrinterRole("KITCHEN"), "KITCHEN");
  assert.equal(queueNameForRole("FRONT"), "前台");
  assert.equal(queueNameForRole("KITCHEN"), "厨房");
  assert.throws(() => parsePrinterRole("BAR"), /INVALID_PRINTER_ROLE/);
  assert.throws(() => parsePrinterRole("front"), /INVALID_PRINTER_ROLE/);
});
