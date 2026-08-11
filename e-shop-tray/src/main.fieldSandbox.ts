import {
  ESHOP_TRAY_ALLOWED_ORIGINS,
  ESHOP_TRAY_FIELD_SANDBOX_ORIGIN,
} from './localApi'

// This entry point is selected only by electron-builder.field-sandbox.yml.
// The formal V0.1 entry point remains dist/main.js with its original allowlist.
ESHOP_TRAY_ALLOWED_ORIGINS.add(ESHOP_TRAY_FIELD_SANDBOX_ORIGIN)
require('./main')
