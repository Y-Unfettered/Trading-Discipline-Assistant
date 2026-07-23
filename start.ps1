$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$codexBin = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"
$codex = Get-ChildItem $codexBin -Recurse -Filter codex.exe -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $codex) {
    $codex = Join-Path $env:APPDATA "npm\codex.cmd"
}
Write-Host "Starting Trade Discipline Journal..."
Write-Host "Open: http://127.0.0.1:3768"
if (Test-Path $codex) {
    Write-Host "Codex CLI: $codex"
    & $codex --version
} else {
    Write-Warning "Codex CLI was not found: $codex"
}
npm start
