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
  $processIds = $portInUse | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($processId in $processIds) {
    Write-Host "Stopping existing process on port $($env:PORT): PID $processId"
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
    } catch {
      Write-Host "ERROR: failed to stop process PID $processId on port $($env:PORT): $($_.Exception.Message)" -ForegroundColor Red
      Write-Host "Close the original start window, or run this script in an elevated PowerShell session."
      exit 1
    }
  }
}

$stillInUse = Get-NetTCPConnection -LocalPort ([int]$env:PORT) -State Listen -ErrorAction SilentlyContinue
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  if (-not $stillInUse) { break }
  Start-Sleep -Milliseconds 500
  $stillInUse = Get-NetTCPConnection -LocalPort ([int]$env:PORT) -State Listen -ErrorAction SilentlyContinue
}
if ($stillInUse) {
  Write-Host "ERROR: port $($env:PORT) is still in use after stopping existing process." -ForegroundColor Red
  $stillInUse | Format-Table -AutoSize
  exit 1
}

Write-Host "Building latest code..."
npm run build
Write-Host ""

Write-Host "Press Ctrl+C to stop."

npm start
