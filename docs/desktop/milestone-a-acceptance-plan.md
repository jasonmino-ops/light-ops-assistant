# E-Shop Desktop — Milestone A Acceptance Plan（Windows 真机验收）

环境：Windows 一体机（主屏员工 POS + 副屏顾客显示）、USB 扫码枪、Xprinter XP-N160II 80mm USB、USB 数码客显、已装 Chrome。
前置：真实门店 storeCode、已完成 POS Device Authorization 的账号。

## A. Web 回归（Chrome，先做，确保浏览器版未被破坏）

| # | 步骤 | 通过标准 |
|---|---|---|
| W1 | Chrome 打开 `/desktop/pos?storeCode=…&mode=pos` | 正常进入收银台 |
| W2 | Chrome 打开 `/desktop/display?storeCode=…` | 正常显示 |
| W3 | Chrome 双标签加购物车 | 双屏同步与改动前一致 |
| W4 | 完成一笔销售并打印 | 浏览器打印闭环不变 |
| W5 | 设备授权流程 | Device Authorization 不变 |

## B. Desktop Shell 真机步骤

| # | 步骤 | 通过标准 |
|---|---|---|
| 1 | 运行 `E-Shop-Desktop-Setup-0.1.0.exe` 安装 | 安装成功，桌面/开始菜单出现快捷方式（允许 SmartScreen 提示，属已知限制） |
| 2 | 首次启动；配置 `%APPDATA%\eshop-desktop\config.json` 后重启 | 员工窗口自动打开并加载 POS |
| 3 | 双屏识别 | 日志 `displays.changed` 显示 2 屏；顾客窗口自动打开 |
| 4 | 员工窗口位置 | 位于主屏，窗口化可移动，重启后记忆位置 |
| 5 | 顾客窗口位置 | 位于副屏，无边框全屏 |
| 6 | 扫码枪连续扫码加购 | 商品逐条进入购物车（现有扫码逻辑不变） |
| 7 | 顾客屏实时同步 | 每次加购顾客屏近实时（明显快于 800ms 轮询节奏）刷新 |
| 8 | 快速连续增删改数量、清空、再加购 | 顾客屏最终状态与员工端一致，无旧状态回跳 |
| 9 | 手动关闭顾客窗口 | 约 1–2 秒后自动重建，并立即显示当前购物车 |
| 10 | 拔掉副屏 HDMI | 应用不崩溃；顾客窗口挪回主屏窗口化；日志 `displays.removed` |
| 11 | 重新接上副屏 | 顾客窗口自动回到副屏全屏；购物车快照恢复 |
| 12 | 再次双击桌面图标启动 | 不出现第二实例，员工窗口被聚焦；日志 `single-instance.conflict` |
| 13 | 断开网络 30 秒再恢复 | 应用不崩溃；恢复后 POS 正常；日志有 load-fail/恢复记录 |
| 14 | 云端恢复验证 | 顾客窗口重载后（Tray 关开一次）内容与云端 PosSession 一致 |
| 15 | 完成一笔销售并打印 | Xprinter 现有打印链路不受影响；顾客屏正确清屏 |
| 16 | 扫码枪在 Desktop 员工窗口内工作 | 与浏览器版一致（键盘型 HID 输入不经 Runtime） |
| 17 | 故障定位演练 | 打开 `%APPDATA%\eshop-desktop\logs\eshop-desktop.log`，能按时间定位上述各步骤事件 |
| 18 | Tray 退出 → 再启动 | 干净退出无残留进程；再次启动一切正常 |

## C. 实时同步专项判定

员工端加购 → 顾客屏更新延迟应为「肉眼即时」（IPC 路径 <100ms 量级）；对照：关闭 Desktop 用纯浏览器双开时延迟约 0.8–1.6s。
连续快速扫码 10 件：顾客屏最终 items/数量/金额与员工端完全一致（sequence 防倒序生效）。

## 验收结论记录

每项记录：通过 / 不通过 / 备注 + 截图或日志片段。全部通过后按冻结边界（architecture-baseline-v1.md）冻结 Milestone A 范围。
