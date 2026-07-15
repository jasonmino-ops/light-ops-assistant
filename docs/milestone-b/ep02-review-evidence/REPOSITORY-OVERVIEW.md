# EP-MB2-02 Repository Overview

Repository:

```text
/Users/jason/light-ops-assistant
```

Branch:

```text
mb2/ep02-device-runtime
```

Formal base main HEAD:

```text
1a703947a37c8c63b44dbb0ceefdeca5af222ca0
```

Known base implementation commit:

```text
3ce3d295adc58e5d0a7219e2e007560541dd1fde
```

## Package Scope

EP-MB2-02 adds the Desktop Runtime Device Runtime layer under:

```text
desktop/src/main/hrt
```

It also adds executable conformance vectors under:

```text
packages/hrt-provider-simulator/fixtures/device-runtime-vectors.json
```

## Stable Areas Not Modified

The package does not modify:

- Legacy runtime;
- Cashier flows;
- POS flows;
- customer H5 ordering;
- Telegram auth;
- database schema;
- Prisma;
- migrations;
- real hardware integration.
