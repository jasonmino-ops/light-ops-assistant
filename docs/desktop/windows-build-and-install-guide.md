# E-Shop Desktop — Windows Build and Install Guide（Milestone A）

## 构建方式一：Windows CI（推荐）

GitHub Actions 工作流：`.github/workflows/desktop-windows-build.yml`
触发：push 涉及 `desktop/**` 或手动 `workflow_dispatch`。
产物：Artifact `eshop-desktop-windows-installer`（`E-Shop-Desktop-Setup-0.1.0.exe`）。
流程：`npm ci → typecheck → vitest → tsc 编译 → electron-builder --win --x64`（windows-latest）。

## 构建方式二：Windows 本机

```powershell
cd desktop
npm ci          # 首次；node_modules 平台相关，勿从其他系统拷贝
npm run dist:win
# 产物：desktop/release/E-Shop-Desktop-Setup-<version>.exe
```

开发模式（连本地 Next dev server）：

```powershell
# 终端 1（仓库根）：npm run dev
# 终端 2：
cd desktop
$env:ESHOP_DESKTOP_BASE_URL="http://localhost:3000"
$env:ESHOP_DESKTOP_STORE_CODE="<门店编码>"
$env:ESHOP_DESKTOP_FORCE_CUSTOMER="1"   # 单屏调试时强制打开顾客窗口
npm run dev
```

## 安装包信息

| 项 | 值 |
|---|---|
| 格式 | NSIS（非一键，可选安装目录） |
| 应用名称 | E-Shop Desktop |
| 应用 ID | com.eshop.desktop |
| 版本 | desktop/package.json `version`（0.1.0） |
| 安装模式 | 按用户（perMachine: false，无需管理员） |
| 快捷方式 | 桌面 + 开始菜单 |
| 用户数据 | `%APPDATA%\eshop-desktop\`（config.json / window-state.json） |
| 日志 | `%APPDATA%\eshop-desktop\logs\eshop-desktop.log`（5MB 轮转 ×3） |
| 卸载 | 保留用户数据（deleteAppDataOnUninstall: false） |
| 自动升级 | `publish: null` 预留，Milestone D 接入 |

## 首次部署配置

1. 安装并首次启动后，编辑 `%APPDATA%\eshop-desktop\config.json`：
   `{ "baseUrl": "https://elifekh.com", "storeCode": "<门店编码>", "lang": "zh" }`
2. 通过 Tray「退出」后重新启动应用生效。
3. 未填 storeCode 时员工窗口进入 `/desktop` 模式选择页，可手动进入 POS。

## 代码签名（重要）

当前安装包**未签名**：首次安装可能出现 Windows SmartScreen 提示（「更多信息 → 仍要运行」）。
正式商用前必须购买代码签名证书（OV/EV）并配置到 electron-builder（`win.certificateFile` 或 CI 签名服务）。
