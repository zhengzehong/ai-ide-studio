$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$env:PORT = "18800"
$env:HOST = "127.0.0.1"
$env:DATA_DIR = Join-Path $Root "data-prd"
$env:LOG_DIR = Join-Path $env:DATA_DIR "logs"
$env:STATIC_DIR = Join-Path $Root "ui\dist"
$env:LOG_LEVEL = if ($env:LOG_LEVEL) { $env:LOG_LEVEL } else { "info" }

New-Item -ItemType Directory -Force $env:DATA_DIR | Out-Null
New-Item -ItemType Directory -Force $env:LOG_DIR | Out-Null

Write-Host "AI IDE Studio PRD local instance"
Write-Host "Root:      $Root"
Write-Host "URL:       http://127.0.0.1:18800/workspace"
Write-Host "DATA_DIR:  $env:DATA_DIR"
Write-Host "LOG_DIR:   $env:LOG_DIR"
Write-Host ""
Write-Host "Press Ctrl+C to stop."

npm start
