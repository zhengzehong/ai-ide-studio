$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$portText = if ($env:AI_IDE_PERF_PORT) { $env:AI_IDE_PERF_PORT } else { "19000" }
$port = 0
if (-not [int]::TryParse($portText, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
  Write-Host "ERROR: AI_IDE_PERF_PORT must be an integer between 1 and 65535." -ForegroundColor Red
  exit 1
}
if ($port -eq 18900) {
  Write-Host "ERROR: port 18900 is reserved for PRD. Use 19000 or another isolated port." -ForegroundColor Red
  exit 1
}

$env:PORT = $portText
$env:HOST = if ($env:AI_IDE_PERF_HOST) { $env:AI_IDE_PERF_HOST } else { "0.0.0.0" }
$env:EDGE_MODE = "process"
$env:EDGE_REALTIME_PATH = "/realtime"
$env:DATA_DIR = Join-Path $Root "data-perf"
$env:LOG_DIR = Join-Path $env:DATA_DIR "logs"
$env:STATIC_DIR = Join-Path $Root "ui\dist"
$env:PUBLIC_BASE_URL = if ($env:AI_IDE_PERF_PUBLIC_BASE_URL) {
  $env:AI_IDE_PERF_PUBLIC_BASE_URL
} else {
  "http://127.0.0.1:$port"
}
$env:PYTHONIOENCODING = "utf-8"
$env:LOG_LEVEL = if ($env:LOG_LEVEL) { $env:LOG_LEVEL } else { "info" }
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  $processIds = $listener | Select-Object -ExpandProperty OwningProcess -Unique
  Write-Host "ERROR: performance port $port is already in use by PID(s): $($processIds -join ', ')." -ForegroundColor Red
  Write-Host "Stop that instance explicitly or choose AI_IDE_PERF_PORT. No process was terminated."
  exit 1
}

New-Item -ItemType Directory -Force $env:DATA_DIR | Out-Null
New-Item -ItemType Directory -Force $env:LOG_DIR | Out-Null

Write-Host "AI IDE Studio isolated performance instance"
Write-Host "Root:      $Root"
Write-Host "PC URL:    http://127.0.0.1:$port/"
Write-Host "Bind:      $($env:HOST):$port"
Write-Host "Public:    $($env:PUBLIC_BASE_URL)"
Write-Host "Realtime:  same-origin $($env:EDGE_REALTIME_PATH)"
Write-Host "DATA_DIR:  $env:DATA_DIR"
Write-Host "LOG_DIR:   $env:LOG_DIR"
Write-Host ""

Write-Host "Building performance branch..."
npm run build
Write-Host ""
Write-Host "Press Ctrl+C to stop."

npm start
