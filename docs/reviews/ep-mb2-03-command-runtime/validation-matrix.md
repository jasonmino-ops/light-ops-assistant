# Validation Matrix

> [!IMPORTANT] ECCP Printing Capability V1.1 Reference（2026-08-11）
> `receipt print` 在本 Matrix 中仅是 generic Command Runtime validation / dispatch fixture，不是 Printing Capability 分类定义。当前权威分类见 Canonical Vault `ECCP Printing Capability Contract V1.1 FINAL FROZEN`；Repository 入口：`docs/governance/printing/PRINTING_CAPABILITY_V1_1_INDEX.md`。当前动作：**UPDATE REFERENCE ONLY**。

| Scenario | Input | Expected State | Error Code | Enters Dispatch |
| --- | --- | --- | --- | --- |
| Valid command | receipt print, assigned printer, ready provider | SUCCEEDED | none | yes |
| Missing required envelope field | empty command ID | REJECTED | INVALID_COMMAND | no |
| Invalid command type | unsupported command type | REJECTED | INVALID_COMMAND | no |
| Invalid payload | non-object payload | REJECTED | INVALID_PAYLOAD | no |
| Expired deadline | deadline before current time | REJECTED | INVALID_COMMAND | no |
| Capability mismatch | required capability not command requirement | REJECTED | CAPABILITY_UNSUPPORTED | no |
| Target not found | missing device ID | REJECTED | TARGET_NOT_FOUND | no |
| Device unavailable | device unassigned or stale | REJECTED | DEVICE_UNAVAILABLE | no |
| Device unsupported capability | device lacks required capability | REJECTED | CAPABILITY_UNSUPPORTED | no |
| Provider not found | no active provider session | REJECTED | PROVIDER_NOT_FOUND | no |
| Provider unavailable | provider disconnected/not ready | REJECTED | PROVIDER_UNAVAILABLE | no |
| Provider unsupported capability | active provider lacks required capability | REJECTED | CAPABILITY_UNSUPPORTED | no |
| Executor missing | no executor port configured | REJECTED | DISPATCH_REJECTED | no real execution |
| Dispatch rejected | fake executor rejects | REJECTED | DISPATCH_REJECTED | yes |
| Execution failure | fake executor fails | FAILED | EXECUTION_FAILED | yes |
| Execution timeout | timeout or fake timeout | TIMED_OUT | EXECUTION_TIMEOUT | yes |
| Cancel | caller cancels before fake completes | CANCELLED | COMMAND_CANCELLED | yes, fake only |
| Duplicate idempotency | same idempotency key after terminal result | prior terminal state | prior result | no new dispatch |
