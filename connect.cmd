@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  call quick-start.cmd
) else (
  node bin\connect.mjs %*
)
endlocal
