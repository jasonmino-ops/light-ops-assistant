# 店小二电脑收银台桌面应用 / Kiosk 使用指南

## 适用场景

本指南适用于门店固定电脑、二手一体机、柜台大屏等场景，将店小二电脑端收银台作为长期打开的收银工作台使用。

当前入口：

```text
https://elifekh.com/cashier
```

实际使用时应带上门店参数：

```text
https://elifekh.com/cashier?storeCode=ST169E7000
```

## 普通安装方式

推荐使用 Chrome 或 Edge：

1. 用电脑浏览器打开完整收银台链接。
2. 点击页面左侧的“安装到电脑”。
3. 浏览器出现安装确认后点击安装。
4. 安装完成后，可从桌面或应用列表打开“店小二收银台”。

首次安装必须从带 `storeCode` 的完整链接进入。收银台会在本机浏览器中记住最近一次门店编号；即使 PWA 从 `/cashier` 启动，也会自动恢复到最近门店的收银台链接。

如果此前已经安装过旧版桌面应用，建议先卸载旧版“店小二收银台”，再从带 `storeCode` 的完整链接重新安装，避免浏览器沿用旧 manifest 的启动地址。

如果浏览器没有弹出安装提示：

- 使用 Chrome 或 Edge。
- 点击浏览器地址栏右侧的安装图标。
- 或在浏览器菜单中选择“安装应用”。

## 全屏使用

在 /cashier 左侧可点击：

```text
进入全屏
```

再次点击可退出全屏。

如果浏览器不允许页面进入全屏，请使用浏览器自身的全屏功能。

## Windows Chrome Kiosk 快捷方式

可创建 Windows 桌面快捷方式，目标示例：

```text
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --app=https://elifekh.com/cashier?storeCode=ST169E7000
```

说明：

- `--kiosk` 会以全屏 kiosk 模式打开。
- `--app=` 会以独立应用窗口打开指定 URL。
- `storeCode` 必须替换为真实门店编号。

## Windows Edge Kiosk 快捷方式

可创建 Windows 桌面快捷方式，目标示例：

```text
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk https://elifekh.com/cashier?storeCode=ST169E7000 --edge-kiosk-type=fullscreen
```

说明：

- `--edge-kiosk-type=fullscreen` 使用 Edge 全屏 kiosk 模式。
- `storeCode` 必须替换为真实门店编号。

## Mac 全屏方式

Mac 上推荐：

1. 用 Chrome / Edge / Safari 打开收银台链接。
2. 点击页面中的“进入全屏”，或使用系统快捷键：

```text
Control + Command + F
```

## 退出 Kiosk 的方法

Windows 常见退出方式：

- `Alt + F4`
- `Ctrl + Alt + Delete`
- 由管理员结束浏览器进程

Mac 常见退出方式：

- `Control + Command + F`
- `Command + Q`

## 门店试跑建议

- 首次试跑前，先用普通浏览器模式验证 CASH / KHQR / 顾客订单处理。
- 确认收银台链接包含正确 `storeCode`。
- 确认门店网络稳定。
- 确认电脑不会自动睡眠。
- Kiosk 模式建议在门店低峰期先测试 10-15 分钟。

## 注意事项

- 本轮不包含断网离线收银。
- 本轮不包含本地缓存排队提交。
- 本轮不改变 CASH / KHQR / records 主流程。
- 本轮不改变 /sale 手机端收银流程。
- 若需离线收银，需要后续单独设计和验收。
