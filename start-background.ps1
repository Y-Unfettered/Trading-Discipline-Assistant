$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appListening = netstat -ano | Select-String "127.0.0.1:3768\s+.*LISTENING"
$newsNowListening = netstat -ano | Select-String "127.0.0.1:4444\s+.*LISTENING"
if ($appListening -and $newsNowListening) { exit 0 }

Set-Location $root
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdout = Join-Path $logDir "server.log"
$stderr = Join-Path $logDir "server-error.log"
$node = (Get-Command node -ErrorAction Stop).Source
$launcher = Join-Path $root "scripts\start-local-stack.mjs"
$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $env:ComSpec
$startInfo.WorkingDirectory = $root
$startInfo.Arguments = "/d /c `"`"$node`" `"$launcher`" 1>>`"$stdout`" 2>>`"$stderr`"`""
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$process = [System.Diagnostics.Process]::Start($startInfo)
if (-not $process) { throw "无法启动交易纪律助手后台服务" }
