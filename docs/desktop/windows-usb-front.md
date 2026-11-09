# Windows Desktop USB FRONT 配置与验收

USB FRONT 由已绑定的 Windows Desktop 按设备启用。真实订单沿用现有 V3 Local First 打印流程。该设备需要具备门店 V3 执行权。TCP FRONT 和 KITCHEN 继续使用原有配置。

## 核对 Windows 绑定

使用运行 Desktop 的 Windows 账户核对目标队列、USB 端口及 PnP 实例。队列须为本机专用、非共享、非默认、空闲且在线。同一端口应只有一个队列。打印机须支持现有小票渲染所用的 RAW 指令。队列名可使用常见文字、数字、空格、点、下划线、连字符和圆括号。

```powershell
$queue = 'Counter USB'
Get-CimInstance Win32_Printer | Where-Object Name -eq $queue |
    Select-Object Name, PortName, Local, Network, Shared, Default, WorkOffline, PrinterStatus
$port = 'USB004'
$portKey = "HKLM:\SYSTEM\CurrentControlSet\Control\Print\Monitors\USB Monitor\Ports\$port"
$instance = (Get-ItemProperty -LiteralPath $portKey -Name 'Device Id').'Device Id'
Get-PnpDevice -PresentOnly -InstanceId $instance
```

## 按设备启用

正常退出 Desktop。使用现有 `--v3-endpoint-provision=<绝对路径>` 入口导入本机受控的 JSON。以下为示例。填写实际绑定的 storeId、deviceId、队列、端口及 PnP 实例，并选用高于已安装配置的 revision。导入的是完整角色配置。若已有 TCP KITCHEN，将其原值写入同一文件。

```json
{
  "schemaVersion": 1,
  "storeId": "example-store",
  "deviceId": "example-device",
  "revision": 2,
  "endpoints": {
    "FRONT": {
      "kind": "windows-usb",
      "queueName": "Counter USB",
      "portName": "USB004",
      "deviceInstanceId": "USB\\VID_0525&PID_A4A8\\EXAMPLE"
    },
    "KITCHEN": { "host": "192.168.1.21", "port": 9100 }
  }
}
```

```powershell
& $desktopExe '--v3-endpoint-provision=C:\E-Shop\endpoint-provision.json'
```

重新配置 TCP FRONT 时，使用更高 revision 和原 `{ "host": "...", "port": 9100 }` 形状。USB 换口、换机或队列改名后，先核对实体打印机，再显式导入新绑定。

## 本机测试票

正常退出 Desktop，确认目标队列空闲，使用已绑定账户启动一次测试。测试需要有效 V3 Owner 执行批次。单次请求有效期为五分钟，票面标记为 `TEST - NO SALE`，使用本机诊断账本。

```powershell
$request = "{0}:{1}" -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(), [guid]::NewGuid()
& $desktopExe "--v3-usb-front-test=$request"
```

核对 Desktop 日志 `v3-print-usb.test-result` 或 `v3-print-usb.test-rejected`，并与 Windows 队列和实际纸票对照。

| 结果 | 含义与处理 |
| --- | --- |
| `CROSSED` | RAW 文档已提交到 Windows Spooler。现场核对对应请求的纸票。 |
| `FAILED_NOT_CROSSED` | 提交前已确认没有发送字节。排除队列离线、绑定漂移或占用后，可发起新的显式测试。 |
| `NOT_EXECUTED` | 该测试请求已留下不可执行状态。核对原记录。 |
| `CROSSING_UNKNOWN` 或 `LOCAL_EFFECT_AMBIGUITY` | 保留队列、纸票、Desktop 日志和诊断账本，进入人工恢复流程。未知结果会阻止重复提交及 V3 释权，包括重启后。 |
| `NO_OWNER_SCOPED_BATCH` 或配置拒绝 | 确认当前设备拥有有效 V3 执行权、配置已导入且 FRONT 使用 USB。 |

诊断账本位于 Desktop 用户目录的 `v3-printing/usb-front-test/.execution-ledger.json`。待人工核对的记录应随现场证据一并保留。订单 ACK、测试票提交和真实出纸分别取证。
