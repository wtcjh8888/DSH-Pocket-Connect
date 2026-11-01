$ErrorActionPreference = 'Stop'
$connectStartupFolder = [Environment]::GetFolderPath('Startup')
foreach ($connectShortcutName in @('DSH-Pocket-Connect.lnk', 'Connect Fixed Entry.lnk')) {
    $connectShortcutPath = Join-Path $connectStartupFolder $connectShortcutName
    if (Test-Path -LiteralPath $connectShortcutPath) { Remove-Item -LiteralPath $connectShortcutPath }
}
Write-Output 'Connect startup shortcut removed.'
