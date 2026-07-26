// Store-scoped persistence for the QZ Tray POC settings. Mirrors the
// per-store key pattern already used by lib/cashier-shift.ts and
// lib/cashier-hold-orders.ts, so one browser switching between stores
// never inherits another store's QZ enabled state or selected printer.

const QZ_ENABLED_PREFIX = 'cashier:qzPrintEnabled:'
const QZ_PRINTER_PREFIX = 'cashier:qzPrintPrinter:'

// Pre-scoping keys from the first QZ POC cut. Never read — a shared
// browser could otherwise leak one store's QZ config into another.
// Removed on load so they stop lingering in storage.
const LEGACY_QZ_ENABLED_KEY = 'cashier:qzPrintEnabled'
const LEGACY_QZ_PRINTER_KEY = 'cashier:qzPrintPrinter'

function qzEnabledKey(storeCode: string) {
  return `${QZ_ENABLED_PREFIX}${storeCode}`
}

function qzPrinterKey(storeCode: string) {
  return `${QZ_PRINTER_PREFIX}${storeCode}`
}

export function readQzPrintEnabled(storeCode: string): boolean {
  return localStorage.getItem(qzEnabledKey(storeCode)) === '1'
}

export function writeQzPrintEnabled(storeCode: string, enabled: boolean) {
  localStorage.setItem(qzEnabledKey(storeCode), enabled ? '1' : '0')
}

export function readQzSelectedPrinter(storeCode: string): string | null {
  return localStorage.getItem(qzPrinterKey(storeCode)) || null
}

export function writeQzSelectedPrinter(storeCode: string, printerName: string | null) {
  const key = qzPrinterKey(storeCode)
  if (printerName) localStorage.setItem(key, printerName)
  else localStorage.removeItem(key)
}

/** One-time cleanup of the pre-scoping global keys. Must never be read. */
export function clearLegacyGlobalQzConfig() {
  localStorage.removeItem(LEGACY_QZ_ENABLED_KEY)
  localStorage.removeItem(LEGACY_QZ_PRINTER_KEY)
}
