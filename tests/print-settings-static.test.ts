import assert from 'node:assert/strict'
import fs from 'node:fs'

const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
const migration = fs.readFileSync('prisma/migrations/20260726060000_add_store_print_kitchen_ticket/migration.sql', 'utf8')
const storeSettings = fs.readFileSync('app/api/store/settings/route.ts', 'utf8')
const cashierStore = fs.readFileSync('app/api/cashier/store/route.ts', 'utf8')
const cashier = fs.readFileSync('app/cashier/page.tsx', 'utf8')
const dashboard = fs.readFileSync('app/dashboard/page.tsx', 'utf8')
const customerReceipt = fs.readFileSync('app/components/DesktopReceipt.tsx', 'utf8')
const kitchenTicket = fs.readFileSync('app/components/KitchenTicket.tsx', 'utf8')

assert.match(schema, /printKitchenTicket\s+Boolean\s+@default\(false\)/, 'Store kitchen printing must default to disabled')
assert.match(migration, /ADD COLUMN "printKitchenTicket" BOOLEAN NOT NULL DEFAULT false/, 'migration must preserve disabled defaults for existing stores')
assert.match(storeSettings, /printKitchenTicket: true/, 'store settings must return the kitchen print setting')
assert.match(storeSettings, /data\.printKitchenTicket = body\.printKitchenTicket/, 'store settings must persist the toggle')
assert.match(cashierStore, /printKitchenTicket: true/, 'cashier bootstrap must receive the store setting')
assert.match(cashier, /const \[isKitchenTicketEnabled, setIsKitchenTicketEnabled\] = useState\(false\)/, 'cashier must use a safe disabled default')
assert.match(cashier, /setIsKitchenTicketEnabled\(d\.printKitchenTicket === true\)/, 'cashier must use the persisted store setting')
assert.match(cashier, /kitchenTicket: receipt && isKitchenTicketEnabled/, 'customer receipts must remain independent from the kitchen toggle')
assert.match(dashboard, /printSettingsTitle/, 'dashboard store settings must expose a print settings section')
assert.match(dashboard, /const STORE_CONFIG_OPEN_SESSION_KEY = 'dashboard:store-config-open'/, 'dashboard must scope the open state to the current browser session')
assert.match(dashboard, /useLayoutEffect\(\(\) => \{[\s\S]*sessionStorage\.getItem\(STORE_CONFIG_OPEN_SESSION_KEY\)[\s\S]*setShowStoreConfig\(true\)/, 'dashboard must restore the open state before browser paint')
assert.match(dashboard, /function toggleStoreConfig\(\) \{[\s\S]*sessionStorage\.setItem\(STORE_CONFIG_OPEN_SESSION_KEY, next \? '1' : '0'\)[\s\S]*return next/, 'dashboard must persist intentional open and close actions')
assert.match(dashboard, /onClick=\{toggleStoreConfig\}/, 'the existing store settings entry must use the stable toggle lifecycle')
assert.match(dashboard, /showStoreConfig && \([\s\S]*<PrintSettingsCard t=\{t\} \/>[\s\S]*<StoreConfigPanel t=\{t\} \/>/, 'print settings must remain under the existing parent and ahead of asynchronously expanding store content')
assert.match(dashboard, /data-print-settings-card="true"/, 'the stable print settings region must be observable across async dashboard refreshes')

for (const [name, source] of [['customer receipt', customerReceipt], ['kitchen ticket', kitchenTicket]]) {
  assert.match(source, /@media print \{\s*html, body \{\s*width: 80mm;\s*height: auto !important;\s*min-height: 0 !important;\s*overflow: visible !important;/, `${name} must use content-driven print height`)
}
