店小二 POS 设备装机包 / LightOps POS Setup Kit

版本：v0.1-candidate
状态：SV-04A Candidate

适用环境：
- Windows PC
- Chrome 浏览器
- Xprinter XP-N160II 80mm USB 打印机
- USB 扫码枪
- 店小二 Desktop POS：https://elifekh.com

如何开始：
1. 打开 01-Start-Here.html。
2. 按页面顺序完成装机步骤。
3. 打印 04-Setup-Checklist/装机检查清单.html 并现场勾选。
4. 打印 07-Device-Info-Form/设备信息记录表.html 并填写设备信息。
5. 交付前向店员演示 05-Staff-Guide/店员操作说明.html。

目录说明：
- 01-Start-Here.html：装机首页。
- 02-Chrome/：Chrome 安装与官方入口。
- 03-Xprinter-XP-N160II-Driver/：驱动版本记录与驱动放置提示。
- 04-Setup-Checklist/：可打印装机检查清单。
- 05-Staff-Guide/：店员操作说明。
- 06-Open-LightOps-POS.url：店小二入口快捷方式。
- 07-Device-Info-Form/：可打印设备信息记录表。
- 08-Troubleshooting/：常见失败排查。
- VERSION.txt：版本信息。

禁止事项：
- 不包含真实 Xprinter 驱动二进制安装包。
- 不包含 .exe、.msi、.bat、.cmd、.ps1、.vbs、.reg。
- 不写 PowerShell。
- 不自动修改 Windows、Chrome、注册表、默认打印机或系统安全设置。
- 不绕过 Chrome 打印对话框。
- 不使用 kiosk-printing。
- 不使用本地打印服务。
- 不包含云打印内容。

驱动二进制不入 git：
真实驱动安装包不提交到 git。请将已验证的 Xprinter XP-N160II Windows 驱动安装包手动放入 03-Xprinter-XP-N160II-Driver/ 目录，并补全驱动来源、文件名、版本、文件哈希和 SV-02 验证日期。

Final Freeze 说明：
本包来自 SV-03 POS Device Setup Architecture Pack Candidate。SV-04A 当前仅为 Candidate，后续需完成真实门店验证后再进入 Final Freeze。
