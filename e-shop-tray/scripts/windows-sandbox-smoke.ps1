param(
  [Parameter(Mandatory = $false)]
  [string]$TrayHost = "127.0.0.1",
  [Parameter(Mandatory = $false)]
  [int]$Port = 17631
)

$ErrorActionPreference = "Stop"
$baseUrl = "http://${TrayHost}:${Port}"
$origin = "https://elifekh.com"

$health = Invoke-RestMethod -Method Get -Uri "$baseUrl/v1/health" -Headers @{ Origin = $origin }
if ($health.service -ne "e-shop-tray") { throw "Unexpected service: $($health.service)" }
if ($health.protocolVersion -ne "0.1") { throw "Unexpected protocol: $($health.protocolVersion)" }
if ($health.status -notin @("online", "busy")) { throw "Unexpected status: $($health.status)" }

$preflight = Invoke-WebRequest -Method Options -Uri "$baseUrl/v1/print" -Headers @{
  Origin = $origin
  "Access-Control-Request-Method" = "POST"
  "Access-Control-Request-Private-Network" = "true"
}
if ($preflight.StatusCode -ne 204) { throw "Preflight failed: $($preflight.StatusCode)" }
if ($preflight.Headers["Access-Control-Allow-Origin"] -ne $origin) { throw "CORS origin mismatch" }
if ($preflight.Headers["Access-Control-Allow-Private-Network"] -ne "true") { throw "PNA compatibility header missing" }

$process = Get-Process | Where-Object { $_.ProcessName -eq "E-Shop Tray" }
if (-not $process) { throw "E-Shop Tray process is not running" }

Write-Output "RESULT=PASS"
Write-Output "SERVICE=$($health.service)"
Write-Output "VERSION=$($health.version)"
Write-Output "STATUS=$($health.status)"
