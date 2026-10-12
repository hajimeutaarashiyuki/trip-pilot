<#
.SYNOPSIS
  註冊／移除「Trip Pilot 打包檔伺服器（tools/serve-packs.mjs）開機自動啟動」的 Windows 工作排程。

.DESCRIPTION
  缺口：手機按「更新」是來桌機 18810 抓 packs/pack.json（經 tailscale serve /trip-pilot）。伺服器原本要人雙擊
  serve-packs.bat；桌機自動更新重開機後就沒了，人在國外救不了。本腳本照 language-learning 的 install_autostart.ps1 做法：

    觸發：開機（BootTrigger，延遲 20 秒）
    身分：目前使用者、S4U 登入（不存密碼、不需登入即可跑）
    動作：<絕對路徑 node.exe> tools\serve-packs.mjs --log "<專案>\logs\packs-server.log"，工作目錄＝app\
    設定：不限執行時間、失敗每 1 分鐘重啟×999、忽略重複啟動、電池也跑、錯過就補跑

  為什麼寫絕對路徑：開機（S4U）環境沒有使用者 PATH。node 在 C:\Program Files\nodejs\node.exe（機器層級），直接用。
  冪等：重跑＝覆寫同名工作。預設＝試跑只印計畫；-Apply 才註冊；-StartNow 註冊後立刻啟動；-Uninstall 移除（也要 -Apply）。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File app\tools\install_autostart.ps1 -Apply -StartNow
#>
# === 需修改 ===
[CmdletBinding()]
param(
  [switch]$Uninstall,
  [switch]$Apply,
  [switch]$StartNow,
  [string]$Node = "C:\Program Files\nodejs\node.exe",
  [string]$TaskName = "TripPilot-PackServer",
  [int]$BootDelaySec = 20
)
# === 以上 ===

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$DryRun = -not $Apply

$ToolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Split-Path -Parent $ToolsDir
$ProjectDir = Split-Path -Parent $AppDir
$LogDir = Join-Path $ProjectDir "logs"
$LogFile = Join-Path $LogDir "packs-server.log"
$Script = Join-Path $ToolsDir "serve-packs.mjs"

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Path -LiteralPath $Node)) { throw "找不到 node.exe：$Node" }
if (-not (Test-Path -LiteralPath $Script)) { throw "找不到 serve-packs.mjs：$Script" }

if ($Uninstall) {
  Write-Host "移除工作 $TaskName"
  if ($DryRun) { Write-Host "（試跑：沒帶 -Apply，不動系統）"; exit 0 }
  if (-not (Test-Admin)) { throw "要系統管理員" }
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($t) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; Write-Host "[OK] 已移除" } else { Write-Host "本來就沒有" }
  exit 0
}

$action = New-ScheduledTaskAction -Execute $Node -Argument ('"' + $Script + '" --log "' + $LogFile + '"') -WorkingDirectory $AppDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = "PT${BootDelaySec}S"
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Trip Pilot 打包檔伺服器（手機更新用）：node tools/serve-packs.mjs，埠 18810，經 tailscale serve /trip-pilot"

Write-Host "工作：$TaskName"
Write-Host "動作：$Node $($action.Arguments)"
Write-Host "工作目錄：$AppDir"
Write-Host "身分：$env:USERNAME（S4U）  觸發：開機後 $BootDelaySec 秒  log：$LogFile"
if ($DryRun) { Write-Host "（試跑：沒帶 -Apply，不註冊）"; exit 0 }
if (-not (Test-Admin)) { throw "要系統管理員" }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Write-Host "[OK] 已註冊"
if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 3
  $st = (Get-ScheduledTask -TaskName $TaskName).State
  Write-Host "[OK] 已啟動，狀態：$st"
}
