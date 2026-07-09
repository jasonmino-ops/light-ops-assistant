# SV-04A POS Device Setup Kit Implementation Record

## 1. 基本信息

- 任务编号：SV-04A
- 任务名称：POS Device Setup Kit Candidate
- 阶段：Store Validation Era
- Commit Hash：5c909005dc08159898410027d8bc10dd59539301
- 当前状态：Candidate Commit Completed
- 是否 Final Freeze：否
- 是否 Push：否

## 2. 实现范围

本次新增目录：

```text
setup-kit/LightOps-POS-Setup-Kit/
```

新增文件清单：

- `setup-kit/LightOps-POS-Setup-Kit/01-Start-Here.html`
- `setup-kit/LightOps-POS-Setup-Kit/02-Chrome/Chrome安装说明.txt`
- `setup-kit/LightOps-POS-Setup-Kit/02-Chrome/Chrome官方下载入口.url`
- `setup-kit/LightOps-POS-Setup-Kit/03-Xprinter-XP-N160II-Driver/驱动版本说明.txt`
- `setup-kit/LightOps-POS-Setup-Kit/03-Xprinter-XP-N160II-Driver/PLACE_DRIVER_HERE.txt`
- `setup-kit/LightOps-POS-Setup-Kit/04-Setup-Checklist/装机检查清单.html`
- `setup-kit/LightOps-POS-Setup-Kit/05-Staff-Guide/店员操作说明.html`
- `setup-kit/LightOps-POS-Setup-Kit/06-Open-LightOps-POS.url`
- `setup-kit/LightOps-POS-Setup-Kit/07-Device-Info-Form/设备信息记录表.html`
- `setup-kit/LightOps-POS-Setup-Kit/08-Troubleshooting/常见失败排查.html`
- `setup-kit/LightOps-POS-Setup-Kit/README.txt`
- `setup-kit/LightOps-POS-Setup-Kit/VERSION.txt`

## 3. 已确认边界

- 未修改 POS 主代码
- 未修改扫码逻辑
- 未修改打印逻辑
- 未修改数据库
- 未新增脚本
- 未新增真实驱动二进制
- 未新增云打印内容
- 未新增 kiosk-printing
- 未新增静默打印
- 未新增本地打印服务
- 未新增自动修改 Windows / Chrome / 默认打印机 / 注册表 / 安全设置的能力

## 4. 上游事实口径

- SV-03 是 Candidate Ready，非 Final Freeze。
- SV-04A 派生自 SV-03 Candidate。
- SV-02 打印路径是 Xprinter XP-N160II 80mm USB + Windows + Chrome Browser Print。
- 自动打印不是静默打印，而是自动弹出 Chrome 打印流程，店员确认一次。

## 5. 验证结果

- Review 结论：PASS WITH FIXES
- 必须修正项：仅为 commit 前排除 unrelated untracked 文件
- 是否按要求只 stage `setup-kit/LightOps-POS-Setup-Kit/`：是
- build 结果：上一轮 `npm run build` 通过
- git status 剩余内容：
  - `docs/.review-workspace/`
  - `runtime/`

## 6. 当前未完成事项

- 未 push
- 未 Final Freeze
- 未进行 Windows 真机离线打开验证
- 未补入真实 Xprinter 驱动包
- 未进行真实门店装机验证
- 未进行多设备验证

## 7. 下一步验证清单

1. 离线打开 `01-Start-Here.html`
2. 检查所有相对链接
3. 检查 `.url` 是否能打开 Chrome 官网和 `elifekh.com`
4. 打印装机检查清单
5. 将真实 XP-N160II 驱动包人工放入驱动目录
6. 补充驱动来源、文件名、版本、哈希、SV-02 验证日期
7. 按 SV-03 流程完成 Windows 测试页
8. 用最小真实销售打印店小二小票
9. 扫码枪连续扫码
10. 连续两单不刷新验收

## 8. Final Decision

SV-04A 当前允许作为 Candidate Commit 存在。

不允许 Final Freeze。

不允许进入 SV-04B。

需等待 Windows 真机和真实门店装机验证后再回写。
