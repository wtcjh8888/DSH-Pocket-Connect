@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22+ is required. Please install an LTS release from https://nodejs.org/
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"
if errorlevel 1 (
  echo Please upgrade to Node.js 22 or newer.
  pause
  exit /b 1
)
if not exist "node_modules\wrangler\bin\wrangler.js" (
  echo Installing project dependencies. This may take a few minutes...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo Installation failed. Check your network and try again.
    pause
    exit /b 1
  )
)
node bin\connect.mjs ui
if errorlevel 1 pause
endlocal
