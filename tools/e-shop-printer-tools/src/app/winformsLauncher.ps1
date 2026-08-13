$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$baseUrl = $env:E_SHOP_PRINTER_TOOLS_BASE_URL
$session = $env:E_SHOP_PRINTER_TOOLS_SESSION
if ([string]::IsNullOrWhiteSpace($baseUrl) -or [string]::IsNullOrWhiteSpace($session)) {
  [System.Windows.Forms.MessageBox]::Show('本地审核服务启动失败。', 'E-Shop Printer Tools') | Out-Null
  exit 2
}

$script:FrontPrinters = @()
$script:KitchenPrinters = @()

function Invoke-AppApi {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Method = 'GET',
    [object]$Body = $null
  )
  $parameters = @{
    Uri = "$baseUrl$Path"
    Method = $Method
    Headers = @{ 'X-Eshop-Session' = $session }
    TimeoutSec = 30
    UseBasicParsing = $true
  }
  if ($null -ne $Body) {
    $parameters.ContentType = 'application/json; charset=utf-8'
    $parameters.Body = $Body | ConvertTo-Json -Depth 12 -Compress
  }
  Invoke-RestMethod @parameters
}

function Show-AppError {
  param([string]$Action, [object]$Failure)
  $message = if ($Failure.Exception.Message) { $Failure.Exception.Message } else { [string]$Failure }
  [System.Windows.Forms.MessageBox]::Show("$Action 失败：`r`n$message", 'E-Shop Printer Tools', 'OK', 'Error') | Out-Null
}

function New-Label {
  param([string]$Text, [int]$X, [int]$Y, [int]$Width, [int]$Height = 24)
  $control = New-Object System.Windows.Forms.Label
  $control.Text = $Text
  $control.Location = New-Object System.Drawing.Point($X, $Y)
  $control.Size = New-Object System.Drawing.Size($Width, $Height)
  $control
}

function New-Button {
  param([string]$Text, [int]$X, [int]$Y, [int]$Width)
  $control = New-Object System.Windows.Forms.Button
  $control.Text = $Text
  $control.Location = New-Object System.Drawing.Point($X, $Y)
  $control.Size = New-Object System.Drawing.Size($Width, 32)
  $control
}

function New-ReadOnlyTextBox {
  param([int]$X, [int]$Y, [int]$Width, [int]$Height)
  $control = New-Object System.Windows.Forms.TextBox
  $control.Location = New-Object System.Drawing.Point($X, $Y)
  $control.Size = New-Object System.Drawing.Size($Width, $Height)
  $control.Multiline = $true
  $control.ReadOnly = $true
  $control.ScrollBars = 'Vertical'
  $control.BackColor = [System.Drawing.Color]::White
  $control
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'E-Shop Printer Tools'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(840, 790)
$form.MinimumSize = New-Object System.Drawing.Size(840, 790)
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)

$title = New-Label 'E-Shop Printer Tools' 22 15 470 38
$title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 19)
$form.Controls.Add($title)

$safeLabel = New-Label '安全审核模式：不会修改打印机或 Windows 配置' 22 55 600 28
$safeLabel.ForeColor = [System.Drawing.Color]::DarkRed
$safeLabel.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 10)
$form.Controls.Add($safeLabel)

$versionLabel = New-Label "版本：$($env:E_SHOP_PRINTER_TOOLS_VERSION)    Build Commit：$($env:E_SHOP_PRINTER_TOOLS_COMMIT)" 22 84 780 24
$form.Controls.Add($versionLabel)

$networkGroup = New-Object System.Windows.Forms.GroupBox
$networkGroup.Text = 'Current Windows Network（只读）'
$networkGroup.Location = New-Object System.Drawing.Point(20, 115)
$networkGroup.Size = New-Object System.Drawing.Size(790, 130)
$form.Controls.Add($networkGroup)

$networkStatus = New-Label '状态：未检测' 15 25 530 24
$networkGroup.Controls.Add($networkStatus)
$networkButton = New-Button '读取当前网络' 620 22 145
$networkGroup.Controls.Add($networkButton)
$networkText = New-ReadOnlyTextBox 15 55 750 60
$networkGroup.Controls.Add($networkText)

$frontGroup = New-Object System.Windows.Forms.GroupBox
$frontGroup.Text = '前台打印机 — USB Identity'
$frontGroup.Location = New-Object System.Drawing.Point(20, 255)
$frontGroup.Size = New-Object System.Drawing.Size(790, 180)
$form.Controls.Add($frontGroup)

$frontStatus = New-Label '状态：未检测' 15 24 390 24
$frontGroup.Controls.Add($frontStatus)
$frontDetectButton = New-Button '检测 USB 打印机' 465 20 145
$frontGroup.Controls.Add($frontDetectButton)
$frontPreviewButton = New-Button '设为前台（仅预览）' 615 20 150
$frontPreviewButton.Enabled = $false
$frontGroup.Controls.Add($frontPreviewButton)
$frontCombo = New-Object System.Windows.Forms.ComboBox
$frontCombo.DropDownStyle = 'DropDownList'
$frontCombo.Location = New-Object System.Drawing.Point(15, 57)
$frontCombo.Size = New-Object System.Drawing.Size(750, 26)
$frontGroup.Controls.Add($frontCombo)
$frontText = New-ReadOnlyTextBox 15 90 750 72
$frontGroup.Controls.Add($frontText)

$kitchenGroup = New-Object System.Windows.Forms.GroupBox
$kitchenGroup.Text = '厨房打印机 — LAN / UDP'
$kitchenGroup.Location = New-Object System.Drawing.Point(20, 445)
$kitchenGroup.Size = New-Object System.Drawing.Size(790, 205)
$form.Controls.Add($kitchenGroup)

$kitchenStatus = New-Label '状态：未检测' 15 24 300 24
$kitchenGroup.Controls.Add($kitchenStatus)
$kitchenDetectButton = New-Button '扫描网络打印机' 315 20 145
$kitchenGroup.Controls.Add($kitchenDetectButton)
$kitchenProbeButton = New-Button '检测 TCP 9100' 465 20 145
$kitchenProbeButton.Enabled = $false
$kitchenGroup.Controls.Add($kitchenProbeButton)
$kitchenPreviewButton = New-Button '设为厨房（仅预览）' 615 20 150
$kitchenPreviewButton.Enabled = $false
$kitchenGroup.Controls.Add($kitchenPreviewButton)
$kitchenCombo = New-Object System.Windows.Forms.ComboBox
$kitchenCombo.DropDownStyle = 'DropDownList'
$kitchenCombo.Location = New-Object System.Drawing.Point(15, 57)
$kitchenCombo.Size = New-Object System.Drawing.Size(750, 26)
$kitchenGroup.Controls.Add($kitchenCombo)
$kitchenText = New-ReadOnlyTextBox 15 90 750 98
$kitchenGroup.Controls.Add($kitchenText)

$redetectButton = New-Button '重新检测' 20 665 140
$form.Controls.Add($redetectButton)
$writeBlockedLabel = New-Label '审核版没有“确认执行”入口：不改 IP、不改 Queue、不装 Driver、不打印。' 175 666 635 32
$writeBlockedLabel.ForeColor = [System.Drawing.Color]::DarkRed
$form.Controls.Add($writeBlockedLabel)
$logLabel = New-Label "日志：$($env:E_SHOP_PRINTER_TOOLS_LOG_PATH)" 20 710 790 36
$form.Controls.Add($logLabel)

function Update-Network {
  try {
    $networkStatus.Text = '状态：检测中...'
    $form.Refresh()
    $network = Invoke-AppApi -Path '/api/network/detect' -Method 'POST'
    if ($null -eq $network.preferredInterface) {
      $networkStatus.Text = '状态：没有检测到可用 IPv4 Interface'
      $networkText.Text = '未发现带 IPv4 的已连接网络接口。'
      return
    }
    $item = $network.preferredInterface
    $networkStatus.Text = "状态：已检测 — $($item.interface)"
    $networkText.Text = "Interface: $($item.interface)`r`nIPv4: $($item.ipv4)    Mask: $($item.subnetMask)    Gateway: $($item.gateway)"
  } catch {
    $networkStatus.Text = '状态：检测失败'
    Show-AppError '读取当前网络' $_
  }
}

function Update-FrontSelection {
  $index = $frontCombo.SelectedIndex
  if ($index -lt 0 -or $index -ge $script:FrontPrinters.Count) {
    $frontPreviewButton.Enabled = $false
    $frontText.Clear()
    return
  }
  $printer = $script:FrontPrinters[$index]
  $frontPreviewButton.Enabled = $true
  $frontText.Text = "Manufacturer: $($printer.manufacturer)`r`nModel: $($printer.model)    VID: $($printer.metadata.vendorId)    PID: $($printer.metadata.productId)`r`nHardware Identity: $($printer.metadata.pnpDeviceId)"
}

function Update-Front {
  try {
    $frontStatus.Text = '状态：检测中...'
    $form.Refresh()
    $script:FrontPrinters = @(Invoke-AppApi -Path '/api/front/discover' -Method 'POST')
    $frontCombo.Items.Clear()
    for ($index = 0; $index -lt $script:FrontPrinters.Count; $index++) {
      $printer = $script:FrontPrinters[$index]
      [void]$frontCombo.Items.Add("$($printer.manufacturer) $($printer.model) — VID $($printer.metadata.vendorId) / PID $($printer.metadata.productId)")
    }
    if ($script:FrontPrinters.Count -eq 0) {
      $frontStatus.Text = '状态：未发现 USB 打印机'
      $frontText.Text = '没有发现 USB Printer PnP Device。'
      $frontPreviewButton.Enabled = $false
    } else {
      $frontStatus.Text = "状态：发现 $($script:FrontPrinters.Count) 台 USB 打印机"
      $frontCombo.SelectedIndex = 0
    }
  } catch {
    $frontStatus.Text = '状态：检测失败'
    Show-AppError '检测 USB 打印机' $_
  }
}

function Update-KitchenSelection {
  $index = $kitchenCombo.SelectedIndex
  if ($index -lt 0 -or $index -ge $script:KitchenPrinters.Count) {
    $kitchenPreviewButton.Enabled = $false
    $kitchenProbeButton.Enabled = $false
    $kitchenText.Clear()
    return
  }
  $printer = $script:KitchenPrinters[$index]
  $kitchenPreviewButton.Enabled = $true
  $kitchenProbeButton.Enabled = -not [string]::IsNullOrWhiteSpace([string]$printer.ip)
  $kitchenText.Text = "Model: $($printer.model)`r`nMAC: $($printer.mac)    Current IP: $($printer.ip)`r`nMask: $($printer.metadata.subnetMask)    Gateway: $($printer.metadata.gateway)`r`nPort: $($printer.port)    DHCP: $($printer.metadata.dhcpEnabled)"
}

function Update-Kitchen {
  try {
    $kitchenStatus.Text = '状态：扫描中...'
    $form.Refresh()
    $script:KitchenPrinters = @(Invoke-AppApi -Path '/api/kitchen/discover' -Method 'POST')
    $kitchenCombo.Items.Clear()
    for ($index = 0; $index -lt $script:KitchenPrinters.Count; $index++) {
      $printer = $script:KitchenPrinters[$index]
      [void]$kitchenCombo.Items.Add("MAC $($printer.mac) — IP $($printer.ip)")
    }
    if ($script:KitchenPrinters.Count -eq 0) {
      $kitchenStatus.Text = '状态：未发现网络打印机'
      $kitchenText.Text = '没有收到可解析的 MP4200FOUND。'
      $kitchenPreviewButton.Enabled = $false
      $kitchenProbeButton.Enabled = $false
    } else {
      $kitchenStatus.Text = "状态：发现 $($script:KitchenPrinters.Count) 台网络打印机"
      $kitchenCombo.SelectedIndex = 0
    }
  } catch {
    $kitchenStatus.Text = '状态：扫描失败'
    Show-AppError '扫描网络打印机' $_
  }
}

$networkButton.Add_Click({ Update-Network })
$frontDetectButton.Add_Click({ Update-Front })
$kitchenDetectButton.Add_Click({ Update-Kitchen })
$frontCombo.Add_SelectedIndexChanged({ Update-FrontSelection })
$kitchenCombo.Add_SelectedIndexChanged({ Update-KitchenSelection })

$frontPreviewButton.Add_Click({
  try {
    $preview = Invoke-AppApi -Path '/api/front/preview' -Method 'POST' -Body @{ index = $frontCombo.SelectedIndex }
    $text = $preview | ConvertTo-Json -Depth 12
    [System.Windows.Forms.MessageBox]::Show("前台 Provisioning Preview（不会执行）：`r`n`r`n$text", '安全审核模式', 'OK', 'Information') | Out-Null
  } catch { Show-AppError '生成前台 Preview' $_ }
})

$kitchenPreviewButton.Add_Click({
  try {
    $preview = Invoke-AppApi -Path '/api/kitchen/preview' -Method 'POST' -Body @{ index = $kitchenCombo.SelectedIndex }
    $text = $preview | ConvertTo-Json -Depth 12
    [System.Windows.Forms.MessageBox]::Show("厨房 Provisioning Preview（不会执行）：`r`n`r`n$text", '安全审核模式', 'OK', 'Information') | Out-Null
  } catch { Show-AppError '生成厨房 Preview' $_ }
})

$kitchenProbeButton.Add_Click({
  try {
    $result = Invoke-AppApi -Path '/api/kitchen/probe' -Method 'POST' -Body @{ index = $kitchenCombo.SelectedIndex }
    [System.Windows.Forms.MessageBox]::Show("TCP 9100：$($result.status)`r`nIP：$($result.ip)`r`nLatency：$($result.latencyMs) ms`r`nSent Bytes：$($result.sentBytes)", 'TCP 9100 Probe', 'OK', 'Information') | Out-Null
  } catch { Show-AppError 'TCP 9100 Probe' $_ }
})

$redetectButton.Add_Click({
  Update-Network
  Update-Front
  Update-Kitchen
})

$form.Add_Shown({ Update-Network })
[void][System.Windows.Forms.Application]::Run($form)
exit 0
