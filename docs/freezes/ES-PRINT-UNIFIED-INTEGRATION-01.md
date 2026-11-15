# ES-PRINT-UNIFIED-INTEGRATION-01 · 统一冻结后继登记材料

状态 **SEALED_INACTIVE**。风险 L3。Founder 的当前授权限于隔离集成准备。

- 可信主线 `d931a77c63b9c080214ab56117123b0230c0c4e2`，Release 血统锚 `d441b55c8014642eb1b26b90d7bf5ce1b2df7941`。
- 统一产品 `a8c13b2da80ce3311945cb6ad3f4ab1672c7b044`，Git tree `85a84d6a888421bfadb5e7e6813edb3fd54961e2`，相对主线完整 diff SHA-256 `510665a0eaa23c56c523e107f0f2ea32df4270dd4529373ac58a9c6af599515f`。
- USB 原始候选 `c50bd967c59452b3ecae602f0624dccf10244127`，隔离导入的完整补丁相同。UI 父候选 `be7226932acfc7d0bd044f3c30e16b5af7bb9770`。
- 早先 Runtime 治理候选 `02cdc4071daf714d8ce4b1e0f6df44c0726a1151` 及 CI 候选 `c2cae0621588bba9d5f1be52eb3f1e68d3714119` 均为旁路证据，产品树未纳入其变更。
- 依 [Workflow V1 §6.2](../workflows/E_SHOP_FOUNDER_GATED_AGENT_DEVELOPMENT_WORKFLOW_V1.md)、[Workflow V2 §6](../workflows/E_SHOP_FOUNDER_GATED_AGENT_DEVELOPMENT_WORKFLOW_V2.md) 和 [V3 Design Freeze V1.4](../designs/ES-PRINT-LOCAL-FIRST-SHARED-CORE-01_DESIGN_FREEZE_V1.4.md) 分别核验授权、登记、实际准入。

## 两个明确的冻结后继

| 路径 | 锚提交 | 锚 SHA-256 | 候选 SHA-256 | 精确 diff SHA-256 |
|---|---|---|---|---|
| `desktop/src/main/printing/v3PrintingRuntime.ts` | `d931a77c63b9c080214ab56117123b0230c0c4e2` | `d16ae02e2b4724a6e926f9b150ffdee56bc3c8dcd31fa2d27901f8a0ab451ba4` | `85081c694cfa5cab0f1ad65905e20025e7a6efef637408c4226e482dc6f48cf1` | `ab8ed092978e1302b0c8b9a2d1a2817e1fbfaf49cae59e53ce02b47255df9ffe` |
| `desktop/src/main/main.ts` | `227146b9e215e1441082c04e8941de8611592226` | `ae6dc84429ccb32e79586c7d92dda451465af6bfac86ae4dd6e9f8e5cd4ea2a9` | `d107112f589beb9a08c426e5aeff48bb659670f604e93960ce24d50022d92664` | `238ab7ecdc1cc6550101b1a1498faea51f863143683224977711a652b03c3599` |

Startup 后继仅有一行向 V3 Runtime 传入设备绑定的 `storeCode`。V3 Runtime 统一后继绑定相对可信主线的完整差异，也保留上一轮从 UI 父候选开始的单文件证据。V2、Owner/Lease/Fence 的实现、Ledger/Outbox、EndpointMutex 和商业 TCP 传输边界保持原字节。

## CORE 精确路径清单

可信检查器 `tests/cashier-realtime-integration.test.ts` SHA-256 `ccad9c0a1c3fb485871966a4c5aa9fcd7acfe7fdc9f9e567b0ff19d686235b60`。目标为原 `assertBoundary` 第 285 行的精确路径失败。全部 25 条原始状态 BLOCKED。

| 路径 | SHA-256 |
|---|---|
| `app/management/PrintSettingsPanel.tsx` | `39c994fa4b34c177119ba8a0655be5079661435df26c7718a8ce5a488d63fd8f` |
| `app/management/page.tsx` | `b2738da6f7be6ee2824c4f09d813733941b6adba9e5966987bbee9253453f534` |
| `desktop/src/main/ipcRouter.ts` | `3ac30b6780acec0f3caed8074670385ada44a5355e578b3833fbf25ce81b6217` |
| `desktop/src/main/main.ts` | `d107112f589beb9a08c426e5aeff48bb659670f604e93960ce24d50022d92664` |
| `desktop/src/main/printing/localEndpointAuthority.ts` | `93390a502c7496311df1dc6f5d858b7f40b3bbee5c3bac9da97d32aa56e58fa3` |
| `desktop/src/main/printing/tcpDiagnosticTarget.ts` | `9d28eb6337c6d7127e7c716da268bcfb508938169c82d934d58182d83b730b5b` |
| `desktop/src/main/printing/tcpPrinterTest.ts` | `c7cc784dcbdc2ecaf4a0eb48db9ce3a699c872462531c6ef163c7385a0c36647` |
| `desktop/src/main/printing/v3PrintingRuntime.ts` | `85081c694cfa5cab0f1ad65905e20025e7a6efef637408c4226e482dc6f48cf1` |
| `desktop/src/main/printing/windowsUsbEndpoint.ts` | `f782cbb9715f7575f1126961c82352070365c0ab515792a4882a7e2632a59d10` |
| `desktop/src/main/printing/windowsUsbFrontTest.ts` | `dc9c286b062ba500712b41c7eb868b3812d81957e70ae3910a87478b23b60e2c` |
| `desktop/src/main/printing/windowsUsbPrintBoundary.ts` | `b665eec3df732eb060e6c2249e62cfff0a3776c00445f17d71e99f0973e1a13f` |
| `desktop/src/main/printing/windowsUsbQueueDiscovery.ts` | `29490d5dd180681506e10b98edb4ec07ba79f43d75b0b6c90bab481fccbc8088` |
| `desktop/src/main/printing/windowsUsbSpoolerScript.ts` | `e733da316956711ca295a9a970194553f3eec7dee76bd67836399982c54e653b` |
| `desktop/src/main/v3PrintSettingsIpc.ts` | `2bd513d2ef7933de9092f9ce9be5ddb1120f674e89b1eacc05856fee13d70ca6` |
| `desktop/src/preload/employeePreload.ts` | `4ce4f61e3154f197368fb1c9d6538477b048415a2e093a7e9a4faec28165dd1f` |
| `desktop/src/shared/ipcChannels.ts` | `b3ab1a421e9f559f7102ef72439fa3c9a79ee7e9cd2318ef96b48b1009cddf72` |
| `desktop/src/shared/v3PrintSettings.ts` | `960d056111efedf6bdb7d17ff1b964bafa8fec63155210ba7660902cd406d7ae` |
| `desktop/tests/ipc-whitelist.test.ts` | `597dc3c83652967989fab9bceb0c21a37d38a467e54d9669d9ea3b192d8b44e4` |
| `desktop/tests/tcp-printer-test.test.ts` | `634b726494185d6ce0afd62f9d5bc2ea59d63ca86fdd7a4fd61500596dd1999b` |
| `desktop/tests/v3-print-settings.test.ts` | `97fb7328e2090e08ba512903cff592e533ca4a47c183fbbdace805995d28f6f6` |
| `desktop/tests/windows-usb-front.test.ts` | `affae8277ed4abad2e01fe045e18e3fd477defd1b001a14d68ca538b4de0b21e` |
| `docs/desktop/windows-usb-front.md` | `03f744feab751ff39b74379bdac80a19428ec707f176f6e8d62d20c6bf5d2d7c` |
| `lib/i18n/en.ts` | `ef71da35015e5e62eac0a02c5a57192b524129da07142dad453af646d3a58d9e` |
| `lib/i18n/km.ts` | `4e1e565020b5b0656be27bf6b74fd857567ae28a7cf7ac783dbd6c2c99b5a70f` |
| `lib/i18n/zh.ts` | `8493e2fda988af4cf9df584ea88fd3775261f21bb4325ae966e339f45d56d395` |

## 合法实施顺序

1. 登记本文件需获得针对精确治理提交与 diff 的主线授权，且先处理旧 USB 的有效血统。旧读取器要求旧激活提交成为产品合并的直接第一父，且第二父须为 c50bd967。任何主线前移都会使该旧授权无法在新的合并上适用。若旧授权仍有效，保留当前主线直至 Founder 明确终止该次适用性或自然到期，再核验实际状态。历史记录保持原字节。
2. 可执行登记需另以本记录的完整哈希、审核者、有效期和新可信治理图为绑定。在独立治理候选中实现该任务专用入口，保持旧 USB 读取器及既有分支断言。先验证可信注册提交与治理可执行差异，再要求预演合并精确第一父为获准治理头、第二父为本产品 SHA。单独封存预演的合并 tree，核对其治理路径与获准治理头逐字一致。相对第一父的产品差异须恰为本清单，逐项 SHA-256 匹配。合并 tree 与产品 tree 独立绑定。可信主线或候选变化、任一文件字节变化、缺审查、到期、dirty 工作树、隐藏 index 或额外父提交时回到原检查。工作分支或调用参数不可作为授权源。
3. CORE 只识别上面这一个精确断言签名并继续执行全部其他断言。release-foundation 只识别 main startup gate 的既有锚和精确单文件后继，继续检查所有其他组，V3 Runtime 冻结签认独立记录。两个 checker 的未来执行差异须先封存、负例测试和独立审查。原始 gate 和授权后结果分别留档。
4. release-foundation 的 Prisma、Payment、Scanner、cashier/customer/mobile business 仍为独立历史阻塞。16 条历史字节在产品和可信主线完全一致，其中 8 条仅在旧 USB 精确血统下有 ACTIVE 记录，6 条 CLOSED，1 条 DRAFT/PENDING，1 条无有效授权。统一候选不承继这些处置。顾客订单恢复与既有中文文案断言也独立保留。Windows CI 修复由其责任任务处理。
5. 本记录无激活代码。未来取得合法准入后仍须执行正式 CORE、release-foundation、STRICT Lineage、Scope Guard、V2 冻结检查，以及隔离 Windows x64 实体 FIELD。登记、激活、产品合并、试点安装和发布各自受对应授权约束。
