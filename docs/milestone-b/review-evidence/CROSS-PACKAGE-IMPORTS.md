# Cross Package Import Report

Cross package import count: 9

## Findings

```text
desktop/tests/hrt-logic-core.test.ts:11:} from "@eshop/hrt-contract";
desktop/tests/hrt-logic-core.test.ts:12:import { HrtLogicCore } from "../src/main/hrt";
desktop/tests/hrt-logic-core.test.ts:13:import { HrtProviderClient } from "../src/main/hrt/providerClient";
tests/hrt-contract.test.ts:27:} from "@eshop/hrt-contract";
tests/hrt-contract.test.ts:28:import { ProviderSimulator } from "../packages/hrt-provider-simulator/src";
desktop/src/main/hrt/providerClient.ts:6:} from "@eshop/hrt-contract";
packages/hrt-provider-simulator/src/index.ts:24:} from "@eshop/hrt-contract";
packages/hrt-contract/src/validators/frameValidator.ts:17:} from "../types";
desktop/src/main/hrt/deviceRegistry.ts:1:import { HrtCapability, HrtDeviceHealth, HrtDeviceRef } from "@eshop/hrt-contract";
desktop/src/main/hrt/hrtLogicCore.ts:9:} from "@eshop/hrt-contract";
desktop/src/main/hrt/commandRouter.ts:6:} from "@eshop/hrt-contract";
packages/hrt-contract/src/fixtures/frames.ts:14:} from "../types";
desktop/src/main/hrt/healthEngine.ts:1:import { HrtHealthSnapshotPayload } from "@eshop/hrt-contract";
```

## Direct Contract src Import Check

Result: PASS. No cross-package direct import of `packages/hrt-contract/src/*` remains.

```text
No matches
```
