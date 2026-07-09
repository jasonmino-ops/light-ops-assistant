# SV-04A POS Device Setup Kit Field Verification Record

## 1. 基本信息

- 任务编号：SV-04A
- 任务名称：POS Device Setup Kit Candidate
- 阶段：Store Validation Era
- Commit Hash：5c909005dc08159898410027d8bc10dd59539301
- 安装包路径：`setup-kit/LightOps-POS-Setup-Kit/`
- 验证类型：Windows 真机验证
- 当前状态：Field Verification Completed
- 是否 Final Freeze：否
- 是否 Push：否

## 2. 验证对象

本次验证对象为：

- `01-Start-Here.html`
- `02-Chrome/Chrome安装说明.txt`
- `02-Chrome/Chrome官方下载入口.url`
- `03-Xprinter-XP-N160II-Driver/驱动版本说明.txt`
- `03-Xprinter-XP-N160II-Driver/PLACE_DRIVER_HERE.txt`
- `04-Setup-Checklist/装机检查清单.html`
- `05-Staff-Guide/店员操作说明.html`
- `06-Open-LightOps-POS.url`
- `07-Device-Info-Form/设备信息记录表.html`
- `08-Troubleshooting/常见失败排查.html`
- `README.txt`
- `VERSION.txt`

## 3. 真机验证结果

| # | 验证项目 | 结果 | 备注 |
|---|---|---|---|
| 1 | Windows 真机可打开 Setup Kit 文件夹 | PASS | 文件夹可访问 |
| 2 | `01-Start-Here.html` 可离线打开 | PASS | 离线 HTML 可打开 |
| 3 | 首页相对链接可正常跳转 | PASS | 本地相对链接可用 |
| 4 | Chrome 安装说明可打开 | PASS | TXT 可打开 |
| 5 | Chrome 官方下载 `.url` 可打开 | PASS | 指向 Chrome 官方下载页 |
| 6 | 店小二入口 `.url` 可打开 `https://elifekh.com` | PASS | 指向店小二入口 |
| 7 | 装机检查清单可打开 | PASS | HTML 可打开 |
| 8 | 装机检查清单适合打印 | PASS | 页面为可打印清单格式 |
| 9 | 店员操作说明可打开 | PASS | HTML 可打开 |
| 10 | 店员操作说明适合现场阅读 | PASS | 非技术语言，适合店员阅读 |
| 11 | 设备信息记录表可打开 | PASS | HTML 可打开 |
| 12 | 设备信息记录表适合打印 | PASS | 表格格式适合打印填写 |
| 13 | 常见失败排查可打开 | PASS | HTML 可打开 |
| 14 | 驱动目录存在 `PLACE_DRIVER_HERE.txt` | PASS | 占位说明存在 |
| 15 | 驱动版本说明字段完整 | PASS | 包含型号、来源、文件名、版本、哈希、SV-02 验证日期等字段 |
| 16 | 未包含真实驱动二进制 | PASS | 已提交 Candidate 包不包含真实驱动二进制；当前本地工作区存在未跟踪驱动包，未进入 git |
| 17 | 未包含脚本 / 自动化文件 | PASS | 已提交包仅包含 HTML / TXT / URL 静态资产 |
| 18 | 未出现云打印 / kiosk-printing / 静默打印 / 本地打印服务内容 | PASS | 未新增相关能力或方案 |
| 19 | 自动打印口径正确：自动弹出 Chrome 打印流程，店员确认一次 | PASS | 已明确不是静默打印 |
| 20 | 未修改 POS 主代码 | PASS | 未改动 POS 主流程代码 |

## 4. 真实驱动包记录

本次 Windows 真机验证环境中已人工补入本地驱动包，但该驱动包仅存在于本地工作区 / 后续 U 盘验证材料中，不进入 git。

- 驱动来源：待现场回填
- 驱动文件名：`芯烨80系列驱动精简版V2.1R.exe`
- 驱动版本：V2.1R（由文件名记录，需现场确认）
- 文件哈希：`14172a96c50f908bf337ad14d7a4f4b3c5b2760354b0dbcbbc8e77658d807c7d`
- SV-02 验证日期：待现场回填
- 是否仅存在于本地/U盘，不进入 git：是

## 5. 完整装机记录

本次为 Setup Kit 文件包真机验证，非完整门店装机验证。

| # | 完整装机项目 | 结果 | 备注 |
|---|---|---|---|
| 1 | Xprinter XP-N160II 驱动安装 | N/A | 本次不作为完整门店装机验收 |
| 2 | Xprinter 设置为 Windows 默认打印机 | N/A | 本次不作为完整门店装机验收 |
| 3 | Windows 测试页成功 | N/A | 本次不作为完整门店装机验收 |
| 4 | `elifekh.com` 弹窗权限设置成功 | N/A | 本次不作为完整门店装机验收 |
| 5 | 店小二最小真实销售小票成功 | N/A | 本次不作为完整门店装机验收 |
| 6 | 扫码枪连续扫码成功 | N/A | 本次不作为完整门店装机验收 |
| 7 | 连续两单不刷新成功 | N/A | 本次不作为完整门店装机验收 |
| 8 | 打印后自动回新订单成功 | N/A | 本次不作为完整门店装机验收 |

## 6. 已确认边界

- 未修改 POS 主代码
- 未修改扫码逻辑
- 未修改打印逻辑
- 未修改数据库
- 未新增 PowerShell / bat / cmd / vbs / reg / exe / msi 到 git
- 未提交真实 Xprinter 驱动二进制
- 未新增云打印
- 未新增 kiosk-printing
- 未新增静默打印
- 未新增本地打印服务
- 未新增自动修改 Windows / Chrome / 默认打印机 / 注册表 / 安全设置能力

## 7. 当前剩余风险

1. SV-03 仍是 Candidate，非 Final Freeze。
2. SV-04A 派生自 SV-03 Candidate，因此也不能 Final Freeze。
3. 仍需真实门店装机验证回写。
4. 仍需确认全屏打印行为最终结论。
5. 仍需至少多一台 Windows 设备或真实门店验证后再考虑 Final Freeze。

## 8. Candidate Freeze 判断

- 是否允许 SV-04A 进入 Candidate Freeze：建议允许。
- 是否允许 Final Freeze：不允许。
- 是否允许进入 SV-04B：不允许。
- 是否允许 push：不允许自动 push，需 Jason 明确批准。

判断依据：本次 Windows 真机文件包验证通过，说明 SV-04A 可以作为 Field Verified Candidate 存在，并具备进入 Candidate Freeze 的条件；但尚未完成真实门店装机 / 多设备验证，因此不能 Final Freeze，也不能进入 SV-04B。

## 9. Final Decision

SV-04A 当前可以作为 Field Verified Candidate。

下一步应生成 Candidate Freeze Record 或等待 Jason 批准 push。

Final Freeze 需等待真实门店装机 / 多设备验证后再做。

当前不进入 SV-04B。
