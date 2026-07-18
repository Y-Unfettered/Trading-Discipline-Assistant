$taskName = "TradeDisciplineAssistant"
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "已移除自启动任务：$taskName"
} else {
  Write-Host "未发现自启动任务：$taskName"
}
