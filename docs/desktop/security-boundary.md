# E-Shop Desktop — Security Boundary（Milestone A）

静态断言测试：`desktop/tests/static-security.test.ts`、`desktop/tests/ipc-whitelist.test.ts`。

## Electron 核心边界（两个窗口一致）

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`（默认）
- Renderer 与页面均无 Node.js 访问；preload 为 sandboxed 自包含文件，仅 import `electron`
- 未使用 remote 模块、未开启 `allowRunningInsecureContent`

## Preload 暴露面（最小 API）

页面唯一可见对象：`window.eshopDesktopRuntime = Object.freeze({ isDesktop, runtime:'electron', windowRole, version })`——只读标识，无任何方法。
不暴露 `ipcRenderer`、不暴露任何 Electron/Node API、无通用 invoke/send 透传。

## IPC

- 通道白名单共 4 条（见 ipc-contract.md），按窗口角色 + 主 frame 校验发送者
- `eshop:cart:publish` payload 经 Main 端全字段运行时校验（类型/长度/枚举/数值有限性），失败即丢弃并记日志
- 顾客窗口：仅能发送 `display-ready`，无 invoke 权限，接收到的快照只回放到展示页 BroadcastChannel——不存在反向控制 POS 的路径
- 不存在任意命令执行、任意文件读取、任意 JS 执行通道

## 导航与窗口

- `setWindowOpenHandler` 一律 deny（无任意新窗口）
- `will-navigate` 仅允许与配置 baseUrl 同源的 URL（`isAllowedNavigation`），其余 preventDefault + 日志
- `setPermissionRequestHandler` 默认拒绝所有权限请求（摄像头/通知/地理位置等）
- 配置文件 baseUrl 仅接受 `http(s)://`（拒绝 `file:` / `javascript:`）

## POS Device Authorization

Desktop 不介入设备授权：授权流程仍完全发生在页面（`lib/desktop-pos-auth.ts`）与云端 API 之间；IPC 层不携带、不缓存、不转发任何授权 token。

## 日志脱敏

logger 对 key 匹配 `token|secret|password|authorization|cookie|phone|telegram|khqr|payment` 的字段一律写 `[redacted]`；字符串截断 2000 字符；不记录支付凭证与完整会员隐私。日志轮转 5MB × 3 份。
