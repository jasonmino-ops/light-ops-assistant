# EP-MB2-02 Command Eligibility

Command Eligibility lives in:

```text
desktop/src/main/hrt/deviceCommandGate.ts
```

## Responsibility

Eligibility answers whether a command is allowed to proceed for a device.

It does not:

- dispatch;
- retry;
- queue;
- time out;
- execute;
- manage lifecycle.

## Checks

- device exists;
- ownership is valid and not stale;
- assignment is active;
- device kind matches command;
- required capability exists.

## Command Requirements

- `PRINT_RECEIPT`: `PRINTER` + `printer.receipt`
- `OPEN_ATTACHED_CASH_DRAWER`: `PRINTER` + `printer.cash_drawer_pulse`
- `SET_SCANNER_ENABLED`: `SCANNER` + `scanner.barcode_event`
- `DISPLAY_SNAPSHOT`: `CUSTOMER_DISPLAY` + `customer_display.snapshot`
- `CLEAR_DISPLAY`: `CUSTOMER_DISPLAY` + `customer_display.snapshot`

## Cash Drawer

Cash drawer is modeled only as a printer attached action.

It is not a fourth Device Runtime kind.
