@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  call quick-start.cmd
) else (
  for /f "usebackq delims=" %%L in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\proxy-env.ps1"`) do set "%%L"
  node bin\connect.mjs %*
)
endlocal
