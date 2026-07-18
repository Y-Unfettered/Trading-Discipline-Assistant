$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 3768
$listening = netstat -ano | Select-String "127.0.0.1:$port\s+.*LISTENING"
if ($listening) { exit 0 }

Set-Location $root
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdout = Join-Path $logDir "server.log"
$stderr = Join-Path $logDir "server-error.log"
Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
