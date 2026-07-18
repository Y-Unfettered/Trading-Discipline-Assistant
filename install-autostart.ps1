$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $root "start-background.ps1"
$taskName = "TradeDisciplineAssistant"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "交易纪律助手本地后台服务，用于15:35自动刷新收盘行情和数据备份" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "已启用交易纪律助手开机登录自启动：$taskName"
