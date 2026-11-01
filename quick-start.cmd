@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-background.ps1" -OpenPanel -InstallDependencies
if errorlevel 1 pause
endlocal
