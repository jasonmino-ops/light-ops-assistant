# E-Shop Certificate Manager v1 技术设计

状态：待 Windows TEST Root 真机验收（已完成一轮独立审查阻断修复）
分支：`claude/certificate-manager-01`
范围：`tools/certificate-manager/` 新增目录，**不改动任何现有文件**

---

## 1. 调查结论

### 1.1 可复用资产

仓库内已有 `desktop/`（E-Shop Desktop，Electron 33 + TypeScript 5.8 + electron-builder 25 + vitest 2）。
它已经具备本工具需要的全部能力：Windows 窗口、NSIS/portable 打包、单实例、
`contextIsolation` + preload 白名单 IPC、`ActivationWindowController` 这类"单窗口 + 状态渲染"范式。

结论：沿用同一套技术栈，不引入 .NET / WPF / PowerShell / 任何新框架。

### 1.2 QZ Tray 2.2.6 事实（来源：qzind/tray 源码，非文档推测）

| 事实 | 来源 |
|---|---|
| `APP_DIR = C:\Program Files\QZ Tray` | wiki/Provisioning 变量表 |
| 配置文件 `qz-tray.properties` 在安装目录 | `PropertyInvoker.getProperties()` |
| 自定义 Root 属性名 `authcert.override`（别名 `trustedRootCert`） | `ArgValue.AUTHCERT_OVERRIDE` |
| 属性值是**绝对路径**，多条用 `;` 分隔 | `CaInvoker.invoke()` + `FileUtilities.FILE_SEPARATOR = ';'` |
| 运行期由 `Certificate.scanAdditionalCAs()` 读取并加入 rootCAs | `Certificate.java:139` |
| 另有兜底：安装目录下的 `override.crt` 会被无条件扫描 | `Certificate.java:145` |
| `ca` provisioning 自 2.2.5 起提供 | wiki/Provisioning |
| `allowed.dat`（`%APPDATA%\qz`）是 `cert` 类型用的，与自签名 Root 无关 | wiki/Provisioning |

两点关键推论：

1. **不需要写 Windows Trusted Root Store。** QZ 的签名校验走自己的 rootCAs 列表；
   Windows 根存储只服务于 QZ 自签的 localhost SSL 证书，与本工具无关。
   少一次 `certutil`，少一类难以回滚的系统级改动。
2. **不能凭空创建 `qz-tray.properties`。** `CertificateManager.loadProperties()` 按
   安装目录 → `C:\ProgramData\qz` → `%APPDATA%\qz` 的顺序，**只取第一个能成功加载的位置**。
   若安装目录下该文件缺失，我们造一个只含 `authcert.override` 的文件，
   反而可能改变 QZ 的属性来源解析。因此该文件缺失一律判为「配置异常」并拒绝操作。

### 1.3 现场事实（CarGarden，Windows 10 Pro 19045，第一次真机启动）

| 现场事实 | 影响 |
|---|---|
| QZ 装在 `D:\qz tray`，不在 Program Files | 安装目录不能写死，必须动态发现 |
| QZ 由 `D:\qz tray\runtime\bin\javaw.exe` + `-jar "D:\qz tray/qz-tray.jar"` 启动 | 进程名是 `javaw.exe`，按 `qz-tray.exe` 找进程一定落空 |
| 安装目录里可能没有 `qz-tray.exe` | 不能把 exe 当作"已安装"的唯一依据，也不能当唯一版本来源 |
| 路径含空格、命令行里 `\` 与 `/` 混用 | 解析必须两种分隔符都认 |

QZ 的 NSIS 安装器带 `MUI_PAGE_DIRECTORY`（见 `ant/windows/windows-installer.nsi.in`），
`C:\Program Files\QZ Tray` 只是默认值，用户可以任选目录 —— 现场这种情况是设计内的，
不是异常，也不应要求门店把 QZ 挪回 Program Files。

**安装目录发现顺序**（`src/core/discovery.ts`，不全盘扫描、不联网）：

1. 正在运行的 QZ 进程命令行里的 `-jar` 路径；
2. `HKLM\SOFTWARE\QZ Tray` 默认值（`WindowsInstaller.java:132` 写入 destination）；
3. 卸载项 `DisplayIcon`（`WindowsInstaller.java:136`，指向 `<安装目录>\qz-tray.exe`）；
4. 默认候选目录。

> QZ 并**不**写 `InstallLocation`（源码里没有），所以第 2、3 条用的是它真正写入的两个值。

命令行解析的安全边界：只接受**绝对路径**、文件名**恰为** `qz-tray.jar`、
不含换行/空字符；且候选目录必须**同时**存在 `qz-tray.jar` 与 `qz-tray.properties`。
畸形或伪造的命令行不会让工具去改任意目录的配置。

进程起停一律**按 PID**，不用 `/IM` —— 现场镜像名是 `javaw.exe`，
按镜像名结束会误杀门店里其它 Java 程序。

### 1.3.1 版本探测

两个真实来源，都取不到就 UNCONFIRMED，绝不猜测：

1. `<安装目录>\qz-tray.exe` 的 ProductVersion（exe 存在时）；
2. 注册表卸载项 `DisplayVersion`（`WindowsInstaller.java:140`）。

不读 `qz-tray.jar` 的 MANIFEST —— QZ 的 `build.xml` 只写了
`Application-Name` / `Main-Class` / `Permissions` / `Multi-Release`，里面没有版本号。

`detectQzVersion()` 返回判别式联合类型：

- `{ status: 'OK', version }`
- `{ status: 'UNCONFIRMED', version: null, reason }`

取不到时**绝不猜测、绝不回退到不存在的路径**。UNCONFIRMED 一律：

1. 状态显示「配置异常 / 版本无法确认」，并带上具体原因；
2. 安装 / 更新 / 修复一律拒绝写入，错误信息里给出可直接执行的人工核对命令
   （`(Get-Item '<dir>\qz-tray.exe').VersionInfo.ProductVersion`）。

同时用 `hasQzInstallAssets()`（要求 `qz-tray.jar` 与 `qz-tray.properties` 同时存在，
**不要求** `qz-tray.exe`）区分"根本没装"与"装了但读不到版本"。

### 1.4 权限与 portable 外壳

写 QZ 安装目录下的 `qz-tray.properties` 必须提权。

**权限判定用的是进程令牌是否已提升**（`src/core/admin.ts`）：

```
WindowsPrincipal.IsInRole([WindowsBuiltInRole]::Administrator)
```

这个调用只在令牌里的 Administrators 组处于 enabled 状态时才为 true；
未提升的管理员用户该组是 deny-only，返回 false —— 正是"是否已提升"。
另外单独查 `S-1-5-32-544` 是否出现在令牌里，用来区分
"根本不是管理员"和"是管理员但没提权"，给出不同提示。

> 现场第一次启动时界面误报"管理员权限不足"，根因是旧实现拿
> **"能否写 QZ 安装目录"** 当权限判据：QZ 目录没被发现（`qzInstallDir` 为 null）时
> 探针必然失败，权限就被连带误报。现在权限判定与目录发现完全解耦。
> 写探针只在读不到进程令牌时充当兜底，且提示里会说明是兜底结论。

打包上必须**同时**设置两处，缺一不可：

| 配置 | 作用对象 |
|---|---|
| `win.requestedExecutionLevel: requireAdministrator` | `win-unpacked` 里的内层 exe |
| `portable.requestExecutionLevel: admin` | portable 目标生成的 NSIS 自解压**外壳** |

只设前者时，最终交付的 portable exe 外壳是 `asInvoker`：双击不弹 UAC，
外壳以标准权限运行、内层 requireAdministrator 的 exe 无法通过 ExecWait 启动，
现场表现为"点了没反应"。

因此构建后必须**直接核验最终 portable exe 的 manifest**，
由 `scripts/verify-portable-manifest.mjs` 作为闸门接在 `pack:win` 之后，
不通过即 exit 1。只检查 `win-unpacked` 内层 exe 是无效的。

---

## 2. 最终技术方案

**Electron 单窗口小程序，核心逻辑放在零依赖的 `src/core/`。**

选择原因：

- **最短**：复用仓库既有的 Electron/TS/vitest/electron-builder，无新工具链；
- **最稳**：所有本机改动只落在两处（我们自己的目录 + `qz-tray.properties` 的一行）；
- **易部署**：产出单文件 portable exe，拷贝即用，现场无安装步骤；
- **易接入 Desktop**：`src/core/` 不 import electron，靠一个注入式 `Env` 描述运行环境，
  未来直接复制进 `desktop/src/main/certificate/`，接上 Desktop 的窗口即可；
- **无后台服务、无数据库、无联网**。

### 2.1 未来接入 Desktop 的方式

```
现在： src/core/*  ← src/main/main.ts（独立窗口 + IPC）
将来： src/core/*  ← desktop/src/main/ipcRouter.ts（新增 4 个 channel）
                   + Desktop 设置页里的一个「证书」面板
```
`Env` 由 `resolveWindowsEnv()` 产生，Desktop 侧只需提供同样的 `Env`，业务逻辑一行不改。

---

## 3. Certificate Package 格式

一个目录，打包后位于 `resources/certificate-package`：

```
certificate-package/
├── manifest.json
└── eshop-root-ca.crt      ← 只有公开证书
```

```json
{
  "schema": "eshop.certificate-package/v1",
  "certificateId": "eshop-root-ca",
  "version": 1,
  "displayName": "E-Shop Root CA",
  "rootFile": "eshop-root-ca.crt",
  "rootFingerprint": "AA:BB:…（SHA-256，大写冒号分隔）",
  "validFrom": "2026-01-01T00:00:00.000Z",
  "validTo": "2036-01-01T00:00:00.000Z",
  "minimumQzVersion": "2.2.5"
}
```

加载时的强制校验（任一不过 → 整包拒绝，状态显示「配置异常」）：

1. `schema` 必须精确匹配；
2. 必填字段齐全，`version` 为 ≥1 的整数；
3. 递归扫描整个包目录：出现 `PRIVATE KEY` 等标记或 `.key/.p12/.pfx/.jks` → 拒绝；
4. Root 必须能被解析为 X.509，且 `basicConstraints CA:TRUE`；
5. 实测 SHA-256 指纹必须等于 `rootFingerprint`；
6. 实测有效期必须与 `validFrom` / `validTo` 一致（容差 1 秒）。

**多门店复用**：同一份 Certificate Package + 同一个 exe，可在任意门店重复部署，
`certificateId` + `version` 即门店间的一致性判据。第一版无云端、无账号、无远程下发。

---

## 4. 状态判断规则

四种状态，由检查项按固定优先级推导：

| 顺序 | 条件 | 状态 |
|---|---|---|
| 1 | 证书包不可用 / QZ 未安装 / QZ 版本 < `minimumQzVersion` / 无管理员权限 | 配置异常 |
| 2 | 无安装记录且无本机 Root 文件 | 未安装 |
| 3 | Root 文件缺失 / 损坏 / 指纹不符 / 已过期 / `authcert.override` 缺失或未指向我们 | 配置异常 |
| 4 | 本机版本 < 证书包版本 | 需要更新 |
| 5 | 其余 | 正常 |

界面同时列出每项检查的通过与否，可自动修复的项标注「（可通过【修复】处理）」。

---

## 5. 四个按钮的流程

共用的落地流程 `deploy()`（安装 / 更新 / 修复都走它）：

```
环境前置检查（证书包 / QZ / 版本 / 权限 / 配置文件存在）
  → 备份 qz-tray.properties 与旧 Root 到 backups\<时间戳>\
  → 写临时文件 → 原子 rename 写入 Root 证书
  → 回读校验指纹
  → 读 qz-tray.properties，仅对 authcert.override 做「追加自己的路径」
  → 写临时文件 → 原子 rename
  → 回读校验：确实包含我们的路径；且除 authcert.override 外其余内容逐字节不变
  → 写 state.json
  → 若 QZ 原本在运行则重启：taskkill 后轮询确认进程确实退出，
     start 后轮询确认进程确实重新出现（最多约 6s）；
     任一步确认不了即抛错进入回滚，绝不在 QZ 状态未知时报告成功
  （QZ 原本没运行则完全不拉起）
```

- **安装**：已是同版本且状态正常 → 直接返回「无需重复安装」（幂等，配置文件不被改写）。
- **更新**：无安装记录 → 提示先安装；本机版本更高 → 拒绝降级；否则走 `deploy()`。
- **修复**：不看版本，强制按证书包重写 Root 与配置，覆盖文件丢失 / 指纹不符 / 配置缺失或错误。
- **卸载**：主进程弹确认框 → 备份 → 从 `authcert.override` 中**只摘除自己那一条**；
  若摘完为空则整条属性删除，否则保留其余第三方条目 → 删除我们的 Root 与 `state.json`。
  不卸载 QZ Tray，不删 QZ 官方证书，不动任何其它属性。
  无 `state.json` 时同样只按已知路径清理 E-Shop 自己添加的内容。

### 备份与回滚

每步操作前把要改的文件复制到 `backups\<ISO 时间戳>\`，同时压入一个撤销动作。
任一步抛错 → 逆序执行撤销（还原 `qz-tray.properties`、还原或删除 Root、还原 `state.json`），
再把 QZ **恢复成操作前的运行状态**：

- 操作前在运行 → 尽力拉起；拉不起来则标记「回滚未完全成功」；
- 操作前未运行 → 保持未运行；若中途被拉起则停回去。

最后在界面上明确显示「已回滚到操作前状态」或「⚠ 回滚未完全成功，请检查备份」。

日志：`%PROGRAMDATA%\E-Shop\CertificateManager\certificate-manager.log`，追加写，界面可查看最近 200 行。

---

## 6. 实际修改范围

新增 `tools/certificate-manager/`（独立 npm 项目，独立 `node_modules`）。
**未修改仓库中任何既有文件。**

本机运行时只改动：

1. `%PROGRAMDATA%\E-Shop\CertificateManager\`（全部由本工具创建）；
2. `C:\Program Files\QZ Tray\qz-tray.properties` 中的 `authcert.override` 一行。

---

## 7. 后续 Gate（本轮不做，发版前必须关闭）

1. **QZ Tray 重装或升级会清除 `authcert.override`。**
   QZ 的安装器会重写安装目录下的 `qz-tray.properties`，我们写的那一行会随之消失，
   本机 Root 文件还在但 QZ 已不再信任。
   现场 SOP 必须写明：**任何一次 QZ Tray 重装或升级之后，都要重新打开
   Certificate Manager 检查状态，若显示「配置异常」则点【修复】。**

2. **Certificate Package 真实性与路径边界。**
   TEST Root 的真机验证可以继续使用当前的包完整性方案
   （schema + 指纹 + 有效期 + CA 标志 + 私钥扫描）。
   但**生产 Root 发版前必须补**：
   - Certificate Package 的真实性验证（对 manifest 本身签名并校验，
     而不只是校验"证书和 manifest 自洽"）；
   - `rootFile` 的路径边界校验（当前直接 `join(dir, rootFile)`，
     未拒绝 `..` 与绝对路径）。

## 8. 明确不做

多门店云端管理平台、门店账号、中央控制台、远程下发、在线设备管理、
自动证书签发、自动 Root 轮换、后台常驻服务、数据库、云端 API、自动更新、遥测；
不写 Windows Trusted Root Store；不接 USB 打印 / mPOS；
不做 Certificate Package 正式签名、生产 Root、路径遍历加固、Authenticode 代码签名、
QZ 多用户会话、CRLF / ISO-8859-1 全面重写、自定义 QZ 安装目录；
不改 Browser / Signing API / AWS / KMS / OIDC / IAM / ESC-POS / Bitmap Renderer /
Print Adapter / QZ Transport / Windows Printer Queue / Desktop Activation / POS / CASH / KHQR / 订单系统。
