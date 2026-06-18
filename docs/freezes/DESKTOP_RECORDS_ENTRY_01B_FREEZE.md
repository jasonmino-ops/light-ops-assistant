# Desktop-Records-Entry-01B 冻结记录

## 冻结结论

Desktop-Records-Entry-01B 已完成并冻结。

已修复电脑端销售记录入口按钮过小、`/records` desktop 模式仍为 Telegram 手机窄屏、以及 desktop records 被 Telegram session 默认门店覆盖导致串店的问题。

现在 `/records?from=desktop&storeCode=...` 会强制锁定 URL `storeCode` 对应门店，只读显示当前门店记录，并使用电脑宽屏布局。

## 冻结 commit

`cd27d84`

## 冻结内容

1. `/desktop/pos` 左侧“销售记录”按钮点击区域和字体放大。
2. `/records` desktop 模式强制以 URL `storeCode` 为准。
3. `/api/records` 在 `from=desktop&storeCode` 场景下不被 Telegram session 默认门店覆盖。
4. `/records` desktop 模式只显示当前 `storeCode` 对应门店记录。
5. `/records` desktop 模式切换为电脑宽屏布局。
6. `/records` desktop 模式支持返回收银台。
7. CASH / KHQR / 离线补同步记录展示正常。
8. 手机端 `/records` 原有登录态逻辑保持不变。
9. 新增 Desktop Records 01B 修复测试说明文档。
10. Obsidian 已同步开发记录。

## 未改内容

1. 未改数据库。
2. 未新增 migration。
3. 未改 records 核心统计口径。
4. 未改退款逻辑。
5. 未新增退款能力。
6. 未改 `/cashier` 主收银流程。
7. 未改 `/api/cashier/sales`。
8. 未改 KHQR 回调 / 查单。
9. 未改 offline-sync API。
10. 未改离线收银保存 / 同步逻辑。
11. 未改 dashboard。
12. 未改会员 / 优惠券 / 库存逻辑。

## 真实验收结果

1. `/desktop/pos?storeCode=ST169E7000&lang=zh` 正常打开。
2. 左侧“销售记录”按钮更大、更容易点击。
3. 点击后 URL 带 `storeCode=ST169E7000&from=desktop`。
4. 不跳 Telegram 绑定页。
5. records 只显示 Mino Pet Shop 记录。
6. records 是电脑宽屏布局。
7. 点击“返回收银台”回到 `/desktop/pos`。
8. CASH / KHQR / 离线补同步记录显示正常。
9. 手机端 `/records` 不受影响。
10. 在线 CASH / KHQR 与离线收银不受影响。

## 后续边界

Desktop records 当前只做只读销售记录入口收口。

后续如需增加退款、记录导出、桌面端筛选增强、权限细分或财务统计调整，应单独立项，不得在本冻结范围内顺手扩展。
