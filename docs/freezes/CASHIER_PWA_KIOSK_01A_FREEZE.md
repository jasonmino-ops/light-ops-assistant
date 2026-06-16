# Cashier-PWA-Kiosk-01A 冻结记录

## 冻结结论

Cashier-PWA-Kiosk-01A 已完成并冻结。`/cashier` 已具备电脑端桌面应用安装能力、进入/退出全屏能力，并支持门店电脑通过 PWA 稳定进入最近门店收银台。已修复 PWA 安装后启动到 `/home` 或丢失 `storeCode` 后跳 Telegram 绑定页的问题。

## 冻结 commit

`b481269`

## 冻结内容

1. `/cashier` 支持安装为电脑桌面应用。
2. `/cashier` 支持进入/退出全屏。
3. `/cashier` 使用收银台专用 `manifest.webmanifest`。
4. 修复全局 `manifest start_url=/home` 导致 PWA 桌面启动跑偏的问题。
5. 修复 PWA 启动 `/cashier` 时丢失 `storeCode` 后跳 Telegram 绑定页的问题。
6. 桌面 PWA 可恢复最近门店收银台。
7. 新增 kiosk 使用说明文档。

## 未改内容

1. 未改数据库。
2. 未改销售核心逻辑。
3. 未改 CASH / KHQR / records。
4. 未改 Telegram 绑定逻辑。
5. 未做离线收银。
6. 未做 Windows exe 安装包。
7. 未做 U 盘安装包。

## 真实验收结果

1. 重新卸载旧 PWA 后安装新版收银台桌面应用。
2. 从桌面打开后可进入 `/cashier?storeCode=ST169E7000`。
3. 不再跳 Telegram 绑定页。
4. 收银台门店上下文恢复正常。
5. CASH / KHQR 原有收银能力未受影响。

## 风险

低。当前阶段只完成电脑端 PWA 安装、全屏、门店上下文恢复和 kiosk 使用说明，不涉及离线收银、支付逻辑、销售记录口径或数据库结构。

## 后续建议

下一阶段可进入 `/cashier` 离线收银模式设计与分阶段实现，但必须单独开任务，先从商品缓存和在线/离线状态提示开始，不直接改销售核心链路。
