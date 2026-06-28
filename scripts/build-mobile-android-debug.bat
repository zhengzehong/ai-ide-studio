@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%.."
for %%I in ("%ROOT_DIR%") do set "ROOT_DIR=%%~fI"
set "APK_PATH=%ROOT_DIR%\release\AI-IDE-Studio-Mobile-prd-0.2.0-debug.apk"

cd /d "%ROOT_DIR%"
if errorlevel 1 (
  echo Failed to enter project root: %ROOT_DIR%
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found in PATH.
  echo Please install Node.js or run this script from a terminal with Node.js available.
  pause
  exit /b 1
)

echo Building AI IDE Studio mobile Android debug APK...
node scripts\build-mobile-android-debug.mjs
if errorlevel 1 (
  echo.
  echo Build failed.
  pause
  exit /b 1
)

echo.
echo APK written to:
echo %APK_PATH%
pause
