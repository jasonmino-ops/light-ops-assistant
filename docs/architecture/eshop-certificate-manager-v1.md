# E-Shop Certificate Manager v1 技术设计

状态：待 Windows 真机验收
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

### 1.3 权限

写 `C:\Program Files\QZ Tray\qz-tray.properties` 必须提权。
采用 `requestedExecutionLevel: requireAdministrator`：启动时由 Windows 弹一次 UAC，人工确认。
同时代码层用"对 QZ 目录做写探针"判定权限，非管理员时状态直接显示「配置异常 / 管理员权限不足」。

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
  → 若 QZ 原本在运行则重启（原本没运行就不拉起）
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
再尽力恢复 QZ 运行状态，最后在界面上明确显示「已回滚到操作前状态」或
「⚠ 回滚未完全成功，请检查备份」。

日志：`%PROGRAMDATA%\E-Shop\CertificateManager\certificate-manager.log`，追加写，界面可查看最近 200 行。

---

## 6. 实际修改范围

新增 `tools/certificate-manager/`（独立 npm 项目，独立 `node_modules`）。
**未修改仓库中任何既有文件。**

本机运行时只改动：

1. `%PROGRAMDATA%\E-Shop\CertificateManager\`（全部由本工具创建）；
2. `C:\Program Files\QZ Tray\qz-tray.properties` 中的 `authcert.override` 一行。

---

## 7. 明确不做

多门店云端管理平台、门店账号、中央控制台、远程下发、在线设备管理、
自动证书签发、自动 Root 轮换、后台常驻服务、数据库、云端 API、自动更新、遥测；
不写 Windows Trusted Root Store；不接 USB 打印 / mPOS；
不改 Browser / Signing API / AWS / KMS / OIDC / IAM / ESC-POS / Bitmap Renderer /
Print Adapter / QZ Transport / Windows Printer Queue / Desktop Activation / POS / CASH / KHQR / 订单系统。
