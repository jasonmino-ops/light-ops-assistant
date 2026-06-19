# Cashier Desktop POS V1 Readiness

本文件为电脑端 POS V1 总冻结前检查与真实门店试跑依据，不替代原始开发记录、冻结记录和测试指南。

## 1. 产品定位

当前 V1 定位为：**店小二电脑端 POS Lite**。

面向柬埔寨本地小店，优先解决：

- 电脑收银
- 顾客显示屏
- CASH / KHQR 收款
- 断网 CASH 收银
- 销售记录
- 基础经营查看

AI、会员、营销、数字员工 / Mino Runtime 作为后续增值模块，不作为 POS V1 首要卖点。

## 2. 取证来源

本轮已读取真实 Obsidian 开发记录：

- `/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/05-开发记录/商户端收口记录-2026-06.md`

已取证项目文档：

- `docs/freezes/CASHIER_PWA_KIOSK_01A_FREEZE.md`
- `docs/freezes/CASHIER_OFFLINE_01_FREEZE.md`
- `docs/freezes/CASHIER_OFFLINE_02_FREEZE.md`
- `docs/freezes/CASHIER_OFFLINE_03D_FREEZE.md`
- `docs/freezes/CASHIER_OFFLINE_03E_1_FREEZE.md`
- `docs/freezes/CASHIER_WEB_POSSESSION_SYNC_01A_FREEZE.md`
- `docs/freezes/DESKTOP_RECORDS_ENTRY_01B_FREEZE.md`
- `docs/freezes/DESKTOP_DISPLAY_CURRENT_FAST_PATH_01A_FREEZE.md`
- `docs/architecture/CASHIER_OFFLINE_MODE_DESIGN.md`
- `docs/architecture/CASHIER_OFFLINE_03_SYNC_DESIGN.md`
- `docs/architecture/CASHIER_OFFLINE_03E_RECORDS_DASHBOARD_PLAN.md`
- `docs/architecture/CASHIER_OFFLINE_03F_DASHBOARD_PLAN.md`
- `docs/ops/CASHIER_DESKTOP_KIOSK_GUIDE.md`
- `docs/ops/CASHIER_KHQR_CUSTOMER_DISPLAY_01A_TEST_GUIDE.md`
- `docs/ops/CASHIER_WEB_POSSESSION_SYNC_01A_TEST_GUIDE.md`
- `docs/ops/DESKTOP_DISPLAY_FULLSCREEN_01A_TEST_GUIDE.md`
- `docs/ops/DESKTOP_DISPLAY_HOT_ITEMS_CAROUSEL_01A_TEST_GUIDE.md`
- `docs/ops/DESKTOP_DISPLAY_IDLE_LAYOUT_01B_TEST_GUIDE.md`
- `docs/ops/DESKTOP_DISPLAY_PERFORMANCE_UX_01C_TEST_GUIDE.md`
- `docs/ops/DESKTOP_DISPLAY_FLICKER_FIX_01A_TEST_GUIDE.md`
- `docs/ops/DESKTOP_DISPLAY_STATE_LAYOUT_01A_TEST_GUIDE.md`
- `docs/ops/DESKTOP_DISPLAY_CURRENT_FAST_PATH_01A_TEST_GUIDE.md`
- `docs/ops/DESKTOP_RECORDS_ENTRY_01A_TEST_GUIDE.md`
- `docs/ops/DESKTOP_RECORDS_ENTRY_01B_FIX_TEST_GUIDE.md`

未找到独立 freeze 文件但已从 Obsidian / docs/ops / docs/architecture 取证的阶段：

- Cashier-Offline-03B
- Cashier-Offline-03C
- Cashier-Offline-03F-1
- Cashier-KHQR-CustomerDisplay-01A
- Desktop-Display-Fullscreen-01A
- Desktop-Display-HotItems-Carousel-01A
- Desktop-Display-IdleLayout-01B
- Desktop-Display-Performance-UX-01C
- Desktop-Display-FlickerFix-01A
- Desktop-Display-StateLayout-01A

## 3. 当前冻结点

| 模块 | 状态 | 关键 commit | 证据 |
| --- | --- | --- | --- |
| PWA / kiosk | 已冻结 | `b481269` | `CASHIER_PWA_KIOSK_01A_FREEZE.md` |
| Offline-01 商品缓存 | 已冻结 | `9e77435` | `CASHIER_OFFLINE_01_FREEZE.md` |
| Offline-02 离线 CASH 本地保存 | 已冻结 | `5b4bddf` | `CASHIER_OFFLINE_02_FREEZE.md` |
| Offline-03B 数据库结构 | 已完成 | `40e6bc3` | Obsidian 生产 migration 执行记录 |
| Offline-03C 同步 API | 已完成 | `12dd289` | Obsidian 开发记录 / API 测试指南 |
| Offline-03D 手动同步 | 已冻结 | `61a2146` | `CASHIER_OFFLINE_03D_FREEZE.md` |
| Offline-03E-1 records 标签 | 已冻结 | `997491d` | `CASHIER_OFFLINE_03E_1_FREEZE.md` |
| Offline-03F-1 dashboard 提示 | 已完成 | 需人工确认 | Obsidian 开发记录 / dashboard 测试指南 |
| KHQR 顾客屏展示 | 已完成 | 需人工确认 | Obsidian 开发记录 / `CASHIER_KHQR_CUSTOMER_DISPLAY_01A_TEST_GUIDE.md` |
| PosSession 双屏同步 | 已冻结 | `a1c2244` | `CASHIER_WEB_POSSESSION_SYNC_01A_FREEZE.md` |
| Desktop records 入口 | 已冻结 | `cd27d84` | `DESKTOP_RECORDS_ENTRY_01B_FREEZE.md` |
| 顾客屏全屏 | 已完成 | 需人工确认 | Obsidian 开发记录 / fullscreen 测试指南 |
| 热销轮播 | 已完成 | 需人工确认 | Obsidian 开发记录 / carousel 测试指南 |
| 顾客屏布局与闪屏修复 | 已完成 | 多阶段，需以最新 commit 为准 | Obsidian 开发记录 / ops 测试指南 |
| CurrentFastPath | 已冻结 | `0c75efb` | `DESKTOP_DISPLAY_CURRENT_FAST_PATH_01A_FREEZE.md` |

## 4. 已完成能力清单

### A. 员工端收银

- `/desktop/pos` 电脑端入口。
- 商品选择。
- 数量修改。
- CASH 收银。
- KHQR 收银。
- 完成销售。
- PWA / kiosk 安装与桌面启动。
- 进入 / 退出全屏能力。
- PWA 启动后可恢复最近门店收银台。

### B. 顾客显示屏

- `/desktop/display` 顾客显示屏。
- 商品 / 金额同步。
- KHQR 二维码展示。
- 空闲态欢迎页。
- 热销商品展示与自动轮播。
- 进入 / 退出全屏。
- 状态驱动布局。
- 当前使用 PosSession + polling。
- 首件商品进入订单态当前约 1.3 秒。
- 当前已知不是本地原生 POS 级实时；若追求更低延迟，需要单独评估 SSE / 本地双屏 / 桌面客户端方案。

### C. 离线收银

- IndexedDB 商品缓存。
- 离线状态提示。
- 离线 CASH 订单本地保存。
- 离线订单待同步数量。
- 恢复网络后手动同步。
- 服务端 `offline-sync` 幂等。
- `/records` 离线补同步标签。
- dashboard 离线补同步轻提示。

### D. 销售记录

- 电脑端 `/desktop/pos` 左侧销售记录入口。
- `storeCode` 隔离。
- desktop records 宽屏布局。
- CASH / KHQR / 离线补同步展示。
- 返回收银台入口。

### E. Dashboard

- 基础经营概览。
- 离线补同步轻提示。
- 当前未重写主统计口径。

## 5. 真实门店试跑设备方案

### 方案一：两台一体机电脑背靠背

推荐作为当前 V1 试跑方案。

- 员工机打开 `/desktop/pos`。
- 顾客机打开 `/desktop/display`。
- 两台设备通过云端 PosSession 同步。
- 优点：符合真实门店“员工屏 + 顾客屏”体验，硬件隔离清晰。
- 注意：两台设备必须使用同一个 `storeCode`。

### 方案二：一台一体机 + 第二显示器

- 同一主机两个浏览器窗口或 PWA。
- 员工屏放 `/desktop/pos`。
- 顾客屏放 `/desktop/display`。
- 当前网页方案仍通过云端 PosSession。
- 后续桌面客户端可升级为本地双屏状态。

## 6. 安装和启动 SOP

### 员工端

示例 URL：

```text
/desktop/pos?storeCode=ST169E7000&lang=zh
```

检查：

- 门店编号为 `ST169E7000`。
- 页面不是 Telegram 绑定页。
- 左侧入口包含销售记录。
- 商品列表可加载。

### 顾客屏

示例 URL：

```text
/desktop/display?storeCode=ST169E7000
```

检查：

- 门店名称正确。
- storeCode 与员工端一致。
- 空闲态可显示欢迎页 / 热销商品。
- 右上角可进入全屏。

### 全屏

- 员工端：使用现有全屏按钮或浏览器全屏。
- 顾客屏：点击“进入全屏”。
- 退出方式：
  - Mac：`Control + Command + F` 或 `Esc`
  - Windows Chrome / Edge：`F11` 或 `Esc`

### 门店隔离

必须确认：

- 员工端 URL storeCode 与顾客屏 URL storeCode 一致。
- 销售记录 URL 带 `storeCode=ST169E7000&from=desktop`。
- records 只显示当前门店记录，不显示其他商户记录。

### 销售记录

从 `/desktop/pos` 左侧点击“销售记录”。

要求：

- 进入 `/records`。
- URL 带当前 `storeCode`。
- 可点击“返回收银台”回到 `/desktop/pos`。

## 7. 必测路径

### 路径 1：在线 CASH 收银

1. 打开员工端。
2. 选择商品。
3. 顾客屏显示商品和金额。
4. 选择 CASH。
5. 完成销售。
6. 顾客屏回空闲态。
7. records 出现 CASH 记录。

### 路径 2：在线 KHQR 收银

1. 选择商品。
2. 选择 KHQR。
3. 顾客屏显示二维码和金额。
4. 顾客扫码或模拟扫码。
5. 员工人工确认收款。
6. 完成销售。
7. records 出现 KHQR 记录。

### 路径 3：顾客屏同步

1. 加商品。
2. 改数量。
3. 删除商品。
4. 清空购物车。
5. KHQR / CASH 切换。
6. 完成销售。
7. 确认顾客屏无旧单、旧商品或旧二维码残留。

### 路径 4：离线 CASH 收银

1. 联网打开 `/cashier` 或电脑收银入口，确认商品缓存正常。
2. 断网。
3. 执行 CASH 离线收银。
4. IndexedDB 保存离线订单。
5. 待同步数量增加。
6. 恢复网络。
7. 手动同步离线订单。
8. records 显示离线补同步记录。

### 路径 5：销售记录

1. 点击电脑端“销售记录”。
2. 确认 `storeCode` 隔离。
3. 确认当前门店记录。
4. 确认 CASH / KHQR / 离线补同步显示。
5. 点击“返回收银台”。

### 路径 6：Dashboard

1. 打开 dashboard。
2. 查看今日销售。
3. 查看离线补同步提示。
4. 确认页面无白屏、无明显错误。

## 8. 验收标准

建议进行 30 分钟真实收银试跑：

- 连续 20 单在线 CASH / KHQR 不出错。
- 断网 CASH 3 单可保存。
- 恢复网络后 3 单可同步。
- records 对账正确。
- 顾客屏不串店、不残留旧单。
- 双屏全屏模式可稳定使用。
- 店员无需理解 Telegram / PosSession / storeCode 技术细节即可完成基本收银。

## 9. 已知边界

当前 V1 不包含：

- 自动到账确认。
- KHQR 回调自动完成。
- 完整退款。
- 会员储值迁移作为 POS V1 首要卖点。
- 本地 USB 打印。
- 日结 / 交班。
- SSE / WebSocket 实时推送。
- Windows exe 安装包。
- 本地桌面客户端。
- 本地双屏状态共享。
- 自动开机启动。
- AI 营销自动化。
- 完整会员营销。

当前顾客屏同步仍是：

- PosSession + polling。
- 已优化到可试跑。
- 若追求主流 POS 级实时同屏，需后续单独做 SSE / 本地双屏 / 桌面客户端方案。

## 10. 风险点

- 网络不稳定导致顾客屏延迟。
- 两台设备 storeCode 不一致导致不同步。
- 浏览器缓存 / PWA 旧版本导致旧页面行为残留。
- 离线订单未同步被忽略。
- IndexedDB 被清理导致本地离线订单丢失。
- 员工误以为离线也能 KHQR。
- 员工误操作完成销售。
- 顾客屏不是本地双屏，仍依赖云端同步。

## 11. 回滚点

| 回滚点 | commit | 说明 |
| --- | --- | --- |
| PWA / kiosk | `b481269` | `/cashier` 桌面安装、全屏、storeCode 恢复 |
| Offline-01 | `9e77435` | 商品缓存与在线/离线状态提示 |
| Offline-02 | `5b4bddf` | 离线 CASH 本地保存 |
| Offline-03B | `40e6bc3` | 离线同步数据库结构，已执行 production migration |
| Offline-03C | `12dd289` | 服务端 offline-sync API |
| Offline-03D | `61a2146` | 客户端手动同步 |
| Offline-03E-1 | `997491d` | records 离线补同步标签 |
| PosSession 同步 | `a1c2244` | `/cashier` 到 `/desktop/display` 双屏同步 |
| Desktop records | `cd27d84` | desktop records storeCode 隔离与宽屏 |
| CurrentFastPath | `0c75efb` | 顾客屏首件商品 active fast path |

无法从独立 freeze 文件确认的 commit，已按 Obsidian 记录取证；后续总冻结前建议人工二次核对 Git 历史。

## 12. 后续优先级

建议顺序：

1. 同步失败订单提示 / 重试面板。
2. 已同步本地订单清理。
3. 小票打印。
4. 日结 / 交班。
5. 电脑端退款查看 / 申请，不直接做完整退款。
6. SSE 实时同屏设计文档。
7. 本地双屏 / 桌面客户端技术路线。
8. 会员储值迁移作为 POS 增值能力接入试跑。
9. AI 商品录入 / 营销增值。

## 13. 总冻结前结论

Cashier Desktop POS V1 已具备真实小店试跑条件，但仍应以“POS Lite 试跑”定位推进，不应承诺本地原生 POS 级实时同步、自动到账、打印、日结、完整退款等能力。

试跑通过后，可再形成 `Cashier-Desktop-POS-V1-Freeze` 总冻结记录。
