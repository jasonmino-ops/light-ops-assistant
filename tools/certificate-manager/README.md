# E-Shop Certificate Manager

> **状态：V1 FINAL FROZEN**（Windows 真机验收通过，version 0.1.0，commit `70d42cd`）
> 当前 version **0.1.1**：仅更换内置证书包为 TEST Root v2（manifest v2），
> `src/`、`scripts/`、`tsconfig*`、`electron-builder.yml` 与 0.1.0 零差异，功能与行为不变。
> 除阻断性 BUG 外禁止继续开发。冻结范围见
> [docs/architecture/eshop-certificate-manager-v1.md](../../docs/architecture/eshop-certificate-manager-v1.md) 第 8 节。

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
| QZ 安装目录 | **动态发现**，不写死（现场 CarGarden 是 `D:\qz tray`） |
| QZ 配置文件 | `<安装目录>\qz-tray.properties` |
| 信任自定义 Root 的属性 | `authcert.override` |
| 属性值格式 | `;` 分隔的**绝对路径**列表 |
| 最低 QZ 版本 | 2.2.5（`ca` provisioning 起始版本） |
| 版本读取方式 | `qz-tray.exe` 的 ProductVersion → 注册表 `DisplayVersion` |

### 现场事实（必须遵守）

- **QZ 可以装在任何目录。** QZ 的 NSIS 安装器带 `MUI_PAGE_DIRECTORY`，
  `C:\Program Files\QZ Tray` 只是默认值。现场实际是 `D:\qz tray`。
- **QZ 可能由 bundled runtime 启动**：
  `"D:\qz tray\runtime\bin\javaw.exe" ... -jar "D:\qz tray/qz-tray.jar"`，
  进程名是 `javaw.exe` 而不是 `qz-tray.exe`。
- 因此 **`qz-tray.exe` 不能作为「QZ 已安装」的判断依据**，
  也不能按镜像名 `/IM` 结束进程（会误杀门店里其它 Java 程序，一律按 PID）。

### QZ 进程身份规则

枚举时先在 CIM 查询里按镜像名过滤，只看 `java.exe` / `javaw.exe` / `qz-tray.exe`，
**查询语句本身不含 `qz-tray.jar` 字面量**，从结构上杜绝"检测进程把自己数进去"。
随后在 TypeScript 里做严格判定：

- `java.exe` / `javaw.exe`：命令行有独立 `-jar` 参数 → 路径 basename 恰为 `qz-tray.jar`
  → 绝对路径 → jar 文件真实存在 → jar 所在目录 == 已发现的 QZ 安装目录；
- `qz-tray.exe`：可执行文件路径 == `<安装目录>\qz-tray.exe`；
- 一律排除 `powershell.exe` / `pwsh.exe` / `cmd.exe` / `conhost.exe` / `wmic.exe` 与本进程自身。

「命令行里出现过 `qz-tray.jar`」**不是**判据。停止确认与启动确认共用这一个解析器。
- QZ Tray 2.2.6 的安装目录里**没有** jpackage 的 `app\*.cfg`，也没有 `version.txt`。

### 安装目录发现顺序

1. 正在运行的 QZ 进程命令行里的 `-jar` 路径（只接受绝对路径且文件名恰为 `qz-tray.jar`）；
2. 注册表 `HKLM\SOFTWARE\QZ Tray` 默认值（`qz.installer.WindowsInstaller` 写入的安装目录）；
3. 注册表卸载项 `DisplayIcon`（指向 `<安装目录>\qz-tray.exe`）；
4. 默认候选目录。

每一条候选都必须通过校验：目录下**同时**存在 `qz-tray.jar` 与 `qz-tray.properties`。
不做全盘扫描，不联网。版本读不到时显示「版本无法确认」并**拒绝写入**，不猜测。

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

`certificate-manager.log` 里带 `[qz]` 前缀的行是重启诊断：安装目录、目标 PID 与命令行、
`taskkill` 返回、每一轮停止/启动确认看到的 PID 与被排除的候选及原因、
`entering start phase` 与实际启动命令。只记录候选进程，不输出整套系统进程列表。

## 命令

```bash
npm ci
npm run make:test-package   # 生成验收用 TEST Root（私钥不落盘）
npm test                    # 编译 + 144 项自动测试
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
- **管理员权限判定的是进程令牌是否已提升**
  （`WindowsPrincipal.IsInRole(BuiltInRole::Administrator)`），
  与 QZ 目录是否被发现完全无关。点了 UAC「是」之后界面必须显示「已获得」；
  若显示「不足」，看提示区分是"没提权"还是"账户不是管理员"。

## 安全边界

- 程序内**不存在**任何私钥，也**不生成**、**不使用**私钥；
- 证书包被递归扫描，出现私钥标记或 `.key/.p12/.pfx/.jks` 即整包拒绝；
- 不联网，不自动获取 Root，不自动更新；
- 安装/更新/卸载全部由人工点击触发，卸载额外有主进程确认框；
- 写 `C:\Program Files` 需要管理员权限，由 Windows UAC 人工确认。
