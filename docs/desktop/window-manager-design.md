# E-Shop Desktop — Window Manager Design（Milestone A）

实现：`desktop/src/main/windowManager.ts`（含 `src/shared/backoff.ts` 恢复策略）。

## 屏幕识别

基于 Electron `screen` 模块动态判定，不依赖固定屏幕编号：
主屏 = `screen.getPrimaryDisplay()`；副屏 = 其余 display 中按 bounds (x,y) 排序的第一块。
监听 `display-added` / `display-removed` / `display-metrics-changed`，每次变化更新 Runtime Health 的 `displays` 状态。

## 员工窗口（主屏）

- 启动自动创建，位于主屏，1280×800（最小 1024×700），位置尺寸持久化于 `userData/window-state.json`。
- 关闭员工窗口不退出 Runtime（Tray 常驻，误关闭保护）；Tray「打开收银窗口」或重复启动应用可恢复/聚焦。
- `did-fail-load` 记录日志并写入 Health（`cloudReachability: error`）。

## 顾客窗口（副屏）

- 存在副屏时启动自动创建：无边框 + 全屏（Kiosk 形态），覆盖副屏 bounds。
- 单屏环境不创建、不报错；`ESHOP_DESKTOP_FORCE_CUSTOMER=1` 时在主屏以窗口化形态打开（单屏开发调试）。
- 不重复创建：`ensureCustomerWindow` 幂等。
- 副屏断开：不销毁、不崩溃，取消全屏并挪回主屏窗口化；副屏重新接入：`display-added` 自动恢复到副屏。
- 误关闭 / 渲染进程崩溃（`render-process-gone`）：自动重建。

## 恢复退避策略（防无限重启循环）

指数退避 1s→2s→4s→8s→16s→30s，最多 6 次；窗口稳定运行 ≥60s 后计数重置；
超过阈值 give-up 并写入 Runtime Health（`customerRecovery.exhausted = true`）+ 错误日志。
每次恢复成功后由 CartSyncService 重推最新购物车快照。

## 单实例

`app.requestSingleInstanceLock()`；第二实例启动即退出，第一实例收到 `second-instance` 事件时聚焦员工窗口并记录 `single-instance.conflict` 日志。

## 退出策略

仅 Tray「退出 E-Shop Desktop」触发真正退出：置 quitting 标记（停止一切恢复定时器）→ 销毁 Tray → 销毁全部窗口 → `app.quit()`。`window-all-closed` 不退出。
