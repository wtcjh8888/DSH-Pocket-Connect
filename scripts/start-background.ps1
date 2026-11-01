$ErrorActionPreference = 'Stop'
$connectRoot = Split-Path -Parent $PSScriptRoot
$connectNode = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $connectRoot 'node_modules/wrangler/bin/wrangler.js'))) {
    throw 'Run quick-start.cmd once to install dependencies first.'
}
$connectArgs = '"' + (Join-Path $connectRoot 'bin/connect.mjs') + '" ui --no-open'
Start-Process -FilePath $connectNode -ArgumentList $connectArgs -WorkingDirectory $connectRoot -WindowStyle Hidden
Write-Output 'DSH Pocket Connect is running in the background. Open quick-start.cmd to manage it.'
