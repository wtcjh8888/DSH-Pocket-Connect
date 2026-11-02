param([switch]$OpenPanel, [switch]$InstallDependencies)
$ErrorActionPreference = 'Stop'
try {
    $connectRoot = Split-Path -Parent $PSScriptRoot
    $connectNode = (Get-Command node -ErrorAction Stop).Source
    $connectVersion = & $connectNode -p 'process.versions.node.match(/^[0-9]+/)[0]'
    if ($LASTEXITCODE -ne 0 -or [int]$connectVersion -lt 22) {
        throw 'Node.js 22 or newer is required. Install it from https://nodejs.org/ and try again.'
    }
    $connectData = if ($env:CONNECT_DATA_DIR) { [IO.Path]::GetFullPath($env:CONNECT_DATA_DIR) } else { Join-Path $connectRoot 'data' }
    New-Item -ItemType Directory -Path $connectData -Force | Out-Null
    if (-not (Test-Path -LiteralPath (Join-Path $connectRoot 'node_modules/wrangler/bin/wrangler.js'))) {
        if (-not $InstallDependencies) { throw 'Run quick-start.vbs once to install dependencies first.' }
        $connectNpm = (Get-Command npm.cmd -ErrorAction Stop).Source
        # Run installation without a console; retain diagnostics in the private data folder.
        $connectInstallArgs = '/d /s /c ""' + $connectNpm + '" ci --no-audit --no-fund"'
        $connectInstall = Start-Process -FilePath $env:ComSpec -ArgumentList $connectInstallArgs -WorkingDirectory $connectRoot -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $connectData 'install.log') -RedirectStandardError (Join-Path $connectData 'install-error.log')
        if ($connectInstall.ExitCode -ne 0) { throw "Dependency installation failed. Check your network and data/install-error.log, then try again." }
    }
    # Route Node's outbound traffic through the Windows system proxy only while
    # it is actually listening; local DSH requests stay direct via NO_PROXY.
    foreach ($connectLine in & (Join-Path $PSScriptRoot 'proxy-env.ps1')) {
        $connectSplit = $connectLine.IndexOf('=')
        if ($connectSplit -gt 0) {
            Set-Item -LiteralPath ("env:" + $connectLine.Substring(0, $connectSplit)) -Value $connectLine.Substring($connectSplit + 1)
        }
    }
    $connectArgs = '"' + (Join-Path $connectRoot 'bin/connect.mjs') + '" ui'
    if (-not $OpenPanel) { $connectArgs += ' --no-open' }
    # Unique logs also allow reopening an existing panel without locking its server log.
    $connectLogName = 'launcher-' + [Guid]::NewGuid().ToString('N')
    $connectErrorLog = Join-Path $connectData ($connectLogName + '-error.log')
    # Let the detached shell own file redirection, so logs outlive this PowerShell process.
    $connectOutputLog = Join-Path $connectData ($connectLogName + '.log')
    $connectLaunchArgs = '/d /v:off /s /c ""' + $connectNode + '" ' + $connectArgs + ' > "' + $connectOutputLog + '" 2> "' + $connectErrorLog + '""'
    $connectProcess = Start-Process -FilePath $env:ComSpec -ArgumentList $connectLaunchArgs -WorkingDirectory $connectRoot -WindowStyle Hidden -PassThru
    if ($connectProcess.WaitForExit(2000) -and $connectProcess.ExitCode -ne 0) {
        throw "Connect could not start. Check $connectErrorLog for details."
    }
} catch {
    $connectMessage = $_.Exception.Message
    $connectShell = New-Object -ComObject WScript.Shell
    $null = $connectShell.Popup($connectMessage, 0, 'DSH Pocket Connect - startup failed', 16)
    exit 1
}
