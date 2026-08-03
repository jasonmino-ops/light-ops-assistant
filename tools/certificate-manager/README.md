# E-Shop Certificate Manager

把 **E-Shop 自签名 Root Certificate** 部署到门店 Windows 电脑，并让本机 QZ Tray 信任它。
一个窗口、四个按钮，现场工程师一分钟内可完成部署或修复。

不改动现有打印链路（Browser → Signing API → AWS KMS → QZ Tray → Windows Printer Queue），
只管理本机的证书文件与 QZ Tray 的信任配置。

## 技术路线

Electron 33 + TypeScript，与 `desktop/`（E-Shop Desktop）同一套技术栈和构建工具。
`src/core/` 不依赖 electron，未来可整体搬进 `desktop/src/main/` 作为一个功能模块，
UI 换成 Desktop 自己的窗口即可，业务逻辑零改动。

```
src/core/       纯 TS 逻辑（可测、可移植）
src/main/       Electron 主进程 + IPC
src/preload/    contextBridge，只暴露 7 个通道
src/renderer/   单窗口 UI
```

## QZ Tray 对接方式

依据 qzind/tray 源码（`CaInvoker` / `Certificate.scanAdditionalCAs` / `PrefsSearch`）：

| 项 | 值 |
|---|---|
| QZ 安装目录 | `C:\Program Files\QZ Tray` |
| QZ 配置文件 | `<安装目录>\qz-tray.properties` |
| 信任自定义 Root 的属性 | `authcert.override` |
| 属性值格式 | `;` 分隔的**绝对路径**列表 |
| 最低 QZ 版本 | 2.2.5（`ca` provisioning 起始版本） |
| 版本读取方式 | `qz-tray.exe` 的 ProductVersion（PowerShell） |

QZ Tray 2.2.6 的 Windows 安装目录只有 `qz-tray.exe` / `qz-tray.jar` / `libs\` /
`qz-tray.properties`，**没有** jpackage 的 `app\*.cfg`，也没有 `version.txt`。
版本唯一可靠来源是 exe 的 ProductVersion；读不到时显示「版本无法确认」并**拒绝写入**，
不猜测、不回退到不存在的路径。

这正是 QZ 官方 `provision.json` 里 `"type": "ca"` 在安装期所做的事情，
本工具只是在**已安装**的 QZ Tray 上完成同样的最终状态。

**不写 Windows Trusted Root Store。** QZ 的签名信任链走它自己的 `authcert.override`，
Windows 根证书存储只与 QZ 自己生成的 localhost SSL 证书有关，不在本工具职责内。

## E-Shop 自有目录

```
%PROGRAMDATA%\E-Shop\CertificateManager\
├── certs\eshop-root-ca.crt      被 authcert.override 指向的 Root
├── state.json                    安装记录（版本、指纹、安装前原值）
├── backups\<时间戳>\             每次操作前的 qz-tray.properties / 旧证书
└── certificate-manager.log       操作日志
```

刻意**不往 QZ 安装目录写任何文件**，只在 `qz-tray.properties` 里增删 `authcert.override` 一行。

## 命令

```bash
npm ci
npm run make:test-package   # 生成验收用 TEST Root（私钥不落盘）
npm test                    # 编译 + 91 项自动测试
npm run start               # 本机启动窗口
npm run pack:win            # 产出 Windows zip + portable exe，并自动核验 exe manifest
npm run verify:portable     # 单独核验已有产物的 manifest
```

## Windows 上的运行方式

- **双击 portable exe 应当直接弹出 UAC 提权确认框。** 这是正常且必须的：
  写 `C:\Program Files\QZ Tray\qz-tray.properties` 需要管理员权限。
  如果双击后没有任何反应，说明产物的 manifest 不对，不要继续验收 ——
  跑 `npm run verify:portable` 复核。
- 当前**未做 Authenticode 代码签名**，UAC 框里会显示「未知发布者」，
  SmartScreen 也可能提示。**这不是本阶段的阻断问题**，
  正式对外发版前再补商业签名。
- `portable.requestExecutionLevel: admin` 与构建后的 manifest 闸门
  （`scripts/verify-portable-manifest.mjs`）保证外壳与内层 exe 都是
  `requireAdministrator`，只检查 `win-unpacked` 里的内层 exe 是不够的。

## 安全边界

- 程序内**不存在**任何私钥，也**不生成**、**不使用**私钥；
- 证书包被递归扫描，出现私钥标记或 `.key/.p12/.pfx/.jks` 即整包拒绝；
- 不联网，不自动获取 Root，不自动更新；
- 安装/更新/卸载全部由人工点击触发，卸载额外有主进程确认框；
- 写 `C:\Program Files` 需要管理员权限，由 Windows UAC 人工确认。
