# Prints KEY=value proxy settings when the Windows system proxy is enabled and
# its port is actively listening. Empty output means direct connections should
# be used; callers pass the lines to node as environment variables.
$ErrorActionPreference = 'Continue'
$proxyUrl = ''
try {
    $connectInet = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
    if ($connectInet.ProxyEnable -eq 1 -and $connectInet.ProxyServer) {
        $connectCandidates = @($connectInet.ProxyServer.Split(';') | Where-Object { $_ -and $_ -notmatch '^(ftp|socks)=' })
        $connectSpec = @($connectCandidates | Where-Object { $_ -match '^https?=' })[0]
        if (-not $connectSpec) { $connectSpec = $connectCandidates[0] }
        $connectSpec = ($connectSpec -replace '^https?=', '').Trim()
        if ($connectSpec -match '^([A-Za-z0-9\.\-\[\]]+):(\d+)$') {
            $connectHost = $Matches[1]
            $connectPort = [int]$Matches[2]
            if ($connectPort -ge 1 -and $connectPort -le 65535) {
                $connectProbe = New-Object System.Net.Sockets.TcpClient
                try {
                    $connectOpen = $connectProbe.ConnectAsync($connectHost, $connectPort)
                    if ($connectOpen.Wait(800) -and $connectProbe.Connected) { $proxyUrl = "http://$connectHost`:$connectPort" }
                } catch { }
                finally { $connectProbe.Close() }
            }
        }
    }
} catch { }
if ($proxyUrl) {
    "HTTP_PROXY=$proxyUrl"
    "HTTPS_PROXY=$proxyUrl"
    "NO_PROXY=127.0.0.1,localhost,::1"
    "NODE_USE_ENV_PROXY=1"
}
