$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$env:PORT = if ($env:AI_IDE_PRD_PORT) { $env:AI_IDE_PRD_PORT } else { "18900" }
$env:HOST = "127.0.0.1"
$env:DATA_DIR = Join-Path $Root "data-prd"
$env:LOG_DIR = Join-Path $env:DATA_DIR "logs"
$env:STATIC_DIR = Join-Path $Root "ui\dist"
$env:PUBLIC_BASE_URL = "http://127.0.0.1:$($env:PORT)"
$env:PYTHONIOENCODING = "utf-8"
$env:LOG_LEVEL = if ($env:LOG_LEVEL) { $env:LOG_LEVEL } else { "info" }
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

New-Item -ItemType Directory -Force $env:DATA_DIR | Out-Null
New-Item -ItemType Directory -Force $env:LOG_DIR | Out-Null

Write-Host "AI IDE Studio PRD local instance"
Write-Host "Root:      $Root"
Write-Host "URL:       http://127.0.0.1:$($env:PORT)/workspace"
Write-Host "DATA_DIR:  $env:DATA_DIR"
Write-Host "LOG_DIR:   $env:LOG_DIR"
Write-Host ""

$portInUse = Get-NetTCPConnection -LocalPort ([int]$env:PORT) -State Listen -ErrorAction SilentlyContinue
if ($portInUse) {
  Write-Host "ERROR: port $($env:PORT) is already in use. Set AI_IDE_PRD_PORT to another port or stop the existing process." -ForegroundColor Red
  $portInUse | Format-Table -AutoSize
  exit 1
}

Write-Host "Press Ctrl+C to stop."

npm start
