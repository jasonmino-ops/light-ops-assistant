# E-Shop Desktop — Known Limitations（Milestone A，如实记录）

1. **未在 Windows 真机验证**。本轮开发与验证环境为 Linux ARM64 沙箱（macOS 仓库挂载）：已完成 Type Check、53 项单元测试、tsc 编译产物、Web 层回归单测；**未执行** Windows 安装包本机构建、Electron 真机启动、双屏/托盘/单实例的真机行为验证。Windows 构建链已配置为 GitHub Actions（windows-latest），首次 push 后需确认 CI 绿色并下载安装包进入真机验收。
2. **安装包未代码签名**：SmartScreen 会提示；商用前需购买证书。
3. **Electron 二进制未在本环境下载**（`ELECTRON_SKIP_BINARY_DOWNLOAD=1`）：`desktop/node_modules` 当前为 Linux 平台安装结果，Jason 本机使用前需在 macOS/Windows 重新 `npm ci`。
4. **顾客窗口恢复重推依赖固定延迟**（did-finish-load +500ms/+2500ms）补偿 React 挂载时间差；极端慢机器上首帧可能仍由 800ms 云端轮询兜底补齐（行为正确，延迟稍高）。
5. **BroadcastChannel 在 Electron 同 session 双窗口间可能原生直达**（Chromium 实现行为）：顾客页可能先于 IPC 回放收到原始消息。页面现有 guard 会正确去重，不影响正确性；但「IPC 为唯一通路」的隔离性验证需在真机用日志确认。
6. **Runtime Health 无运营 UI**：仅 Tray「查看运行状态」对话框 + 日志（按 Milestone A 范围设计）。
7. **network / cloudReachability 状态为粗粒度**：仅由页面加载成败推导，无主动探活（留待 Milestone C/D）。
8. **员工窗口无 Kiosk 模式**：Milestone A 保持窗口化便于门店过渡与调试。
9. **配置修改需重启生效**：无设置 UI（Milestone C Device Center 范围）。
10. **根 tsconfig `exclude` 增加了 `"desktop"`**：这是对现有 SaaS 的唯一根级文件改动；另发现 `tests/subscription-lifecycle.test.ts` 存在一处与本次改动无关的既有 TS 报错（ES2017 target vs 正则 flag），未修复（超出 Milestone 范围）。
