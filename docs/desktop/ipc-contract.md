# E-Shop Desktop — IPC Contract（Milestone A，冻结候选）

唯一事实来源：`desktop/src/shared/ipcChannels.ts`。
Preload 为 sandboxed 自包含文件，通道字符串一致性由 `desktop/tests/static-security.test.ts` 静态校验。

## 通道全集（白名单，共 4 条）

| 通道 | 方向 | 发送方 | 接收方 | Payload | 校验 |
|---|---|---|---|---|---|
| `eshop:cart:publish` | send | 员工窗口 preload | Main | `CartSnapshotMessage`（未受信任） | Main 端 `validateCartSnapshotMessage` 全字段运行时校验 + `isNewerSnapshot` 防倒序 |
| `eshop:display:ready` | send | 顾客窗口 preload | Main | 无 | 仅身份校验；触发最新快照重推 |
| `eshop:runtime:health` | invoke | 员工窗口 preload（预留） | Main | 无 → `RuntimeHealthSnapshot`（只读） | 仅员工角色可调用 |
| `eshop:cart:apply` | Main → Renderer | Main | 顾客窗口 preload | 已校验的 `CartSnapshotMessage` | 顾客 preload 结构复查后回放 BroadcastChannel |

## 发送者身份校验

- WindowManager 维护 `webContents.id → 'employee' | 'customer'` 注册表；每条 IPC 消息按角色查 `SENDABLE_BY_ROLE / INVOKABLE_BY_ROLE` 白名单。
- 仅接受主 frame（`event.senderFrame === event.sender.mainFrame`），拒绝 iframe 伪造。
- 未授权访问记录 `ipc.unauthorized` 日志并静默丢弃。

## CartSnapshotMessage

与 Web 冻结契约 `lib/customer-display-realtime-channel.ts` 的 `CustomerDisplayRealtimeMessage` 字段对齐：
`type('CART_SNAPSHOT'|'CLEAR') / storeCode / sentAt(ISO) / sequence(单调递增) / items[{productId,name,spec,imageUrl?,price,qty,lineAmount}] / totalAmount / itemCount / currencyCode / status / paymentMethod / paymentStatus`。
指令要求的 `sessionId`、`unitPrice`、`lineTotal`、`subtotal`、`discount`、`total`、`updatedAt` 分别对应现有契约的 `storeCode+storeCode 会话语义`、`price`、`lineAmount`、`totalAmount`、`totalAmount`、`sentAt`（Web 契约冻结，Desktop 不另造字段）。

校验规则（Main 端权威）：type 枚举、storeCode 1–64 字符、sentAt 可解析、sequence 有限非负、items ≤500 且逐项字段校验、金额有限数、status/paymentMethod/paymentStatus 枚举。额外字段（如 `relayedByDesktop`）允许输入但在输出中剥离。

## 顺序与恢复语义

- 防倒序：`sequence` 更大接受；相同 `sequence` 时 `sentAt` 更新才接受（与 Web guard 规则一致）。
- Main 缓存最新已校验快照；顾客窗口 `display-ready` / `did-finish-load`（+500ms/+2500ms 容错重推）时重放；页面自身 guard 负责去重，不会回退。
- 防回环：顾客 preload 回放消息带 `relayedByDesktop: true`；员工 preload 忽略带该标记的消息。
- 云端兜底：`/desktop/display` 现有 800ms PosSession 轮询保持不变，Electron 通道失效时显示自动回落到云端数据。

## 禁止事项（安全限制）

无任意 channel、无参数透传、无 JS 执行、无 shell 命令、无文件路径读取；顾客窗口不能发送购物车数据、不能 invoke 任何通道，无法反向控制 POS；IPC 不介入、不绕过 POS Device Authorization（授权流程完全在页面与云端之间）。
