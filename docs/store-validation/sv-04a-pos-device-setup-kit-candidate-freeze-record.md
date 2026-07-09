# SV-04A POS Device Setup Kit Candidate Freeze Record

## 1. 基本信息

- 任务编号：SV-04A
- 任务名称：POS Device Setup Kit Candidate
- 阶段：Store Validation Era
- 状态：Candidate Freeze
- 是否 Final Freeze：否
- 是否 Push：否
- 日期：2026-07-10
- 安装包路径：`setup-kit/LightOps-POS-Setup-Kit/`

## 2. 冻结范围

本次 Candidate Freeze 覆盖以下文件与目录：

- `setup-kit/LightOps-POS-Setup-Kit/`
- `docs/store-validation/sv-04a-pos-device-setup-kit-implementation-record.md`
- `docs/store-validation/sv-04a-pos-device-setup-kit-field-verification-record.md`
- `.gitignore` 中的 SV-04A 驱动忽略规则

## 3. Commit 清单

- `5c909005dc08159898410027d8bc10dd59539301`
- `3c1137a3d8485f13b101cc617b14205c63453911`
- `089b7ff9a172bc72f8500cb20bcdde72e79d9ca8`

## 4. 已完成事项

- SV-04A 静态 Setup Kit 已生成
- 已提交 setup-kit 静态资产
- 已生成 Implementation Record
- 已生成 Field Verification Record
- 已完成 Windows 真机验证
- 已确认未修改 POS 主代码
- 已确认未提交真实驱动二进制
- 已确认未新增脚本 / 自动化文件
- 已添加 gitignore 规则保护驱动二进制
- 驱动 exe 可作为本地 / U 盘交付资产存在，但不属于 git 资产

## 5. 冻结边界

Candidate Freeze 后允许：

- 作为 U 盘 / 下载装机包候选版使用
- 继续在真实 Windows 设备上验证
- 继续补充本地驱动文件到 U 盘交付包
- 根据真实门店验证结果回写

Candidate Freeze 后禁止：

- 直接 Final Freeze
- 进入 SV-04B
- 加入 PowerShell / bat / cmd / vbs / reg / exe / msi 到 git
- 提交真实驱动二进制
- 修改 POS 主代码
- 修改扫码逻辑
- 修改打印逻辑
- 加入云打印 / kiosk-printing / 静默打印 / 本地打印服务

## 6. 剩余风险

- SV-03 仍是 Candidate，非 Final Freeze
- SV-04A 派生自 SV-03 Candidate
- 仍需真实门店装机回写
- 仍需多设备验证
- 仍需 SV-02 Final 后回写全屏打印结论
- 当前只是 Field Verified Candidate，不是正式交付最终版

## 7. 下一步

1. 需要 Jason 批准是否 push 当前三个 commit 以及本 Candidate Freeze Record commit
2. 下一次真实门店装机使用该 Setup Kit
3. 记录现场缺口并回写 SV-03 / SV-04A
4. 多设备验证后再考虑 Final Freeze
5. 当前不启动 SV-04B

## 8. Final Decision

- Candidate Freeze：成立
- Final Freeze：不允许
- SV-04B：不允许
- Push：需 Jason 明确批准
