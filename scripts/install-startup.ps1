$ErrorActionPreference = 'Stop'
$connectRoot = Split-Path -Parent $PSScriptRoot
$connectStartupFolder = [Environment]::GetFolderPath('Startup')
$connectShortcutPath = Join-Path $connectStartupFolder 'DSH-Pocket-Connect.lnk'
$connectShell = New-Object -ComObject WScript.Shell
$connectShortcut = $connectShell.CreateShortcut($connectShortcutPath)
$connectShortcut.TargetPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$connectShortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $PSScriptRoot 'start-background.ps1') + '"'
$connectShortcut.WorkingDirectory = $connectRoot
$connectShortcut.WindowStyle = 7
$connectShortcut.Description = 'Start DSH Pocket Connect on user sign-in.'
$connectShortcut.Save()
$connectLegacyPath = Join-Path $connectStartupFolder 'Connect Fixed Entry.lnk'
if (Test-Path -LiteralPath $connectLegacyPath) {
    $connectLegacy = $connectShell.CreateShortcut($connectLegacyPath)
    if ($connectLegacy.Description -eq 'Start Connect fixed-entry sync on user sign-in.') {
        Remove-Item -LiteralPath $connectLegacyPath
    }
}
Write-Output 'Startup shortcut installed. Enable auto-sync in the Connect panel to resume synchronization.'
