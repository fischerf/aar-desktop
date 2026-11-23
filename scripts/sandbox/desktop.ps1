# Everyday desktop tasks for the LLM in a fresh Windows Sandbox: install Aar, add
# Paint (the sandbox has no Store apps), then let the model work through
# tests/sandbox/desktop_tasks.py (Paint, Edge, Explorer, Settings, Task Manager,
# Character Map) via aar + the bundled Windows MCP server. The model runs on the
# host's Ollama (reached through the sandbox gateway, so it needs to listen on
# all interfaces), not inside the sandbox.
#
#   powershell -ExecutionPolicy Bypass -File scripts\sandbox\desktop.ps1                    # all tasks
#   powershell -ExecutionPolicy Bypass -File scripts\sandbox\desktop.ps1 -Tasks paint,edge-wiki
#   powershell -ExecutionPolicy Bypass -File scripts\sandbox\desktop.ps1 -Mode script       # Paint sunset without LLM
#   powershell -ExecutionPolicy Bypass -File scripts\sandbox\desktop.ps1 -Mode widget -SkipPaint -Tasks all  # the real widget, driven like a user
#   powershell -ExecutionPolicy Bypass -File scripts\sandbox\desktop.ps1 -Mode edge-probe -SkipPaint  # Edge via MCP, no LLM
#
# -AarSrc: aar checkout whose tools\windows_mcp and agent\extensions\mcp.py replace
# the bundled ones (iterate without rebuilding the installer); "" keeps the bundle.
# One-time Paint setup (host, read-only copy of installed packages):
#   robocopy "C:\Program Files\WindowsApps\<pkg>" <Root>\desktop\paint-pkgs\<pkg> /E
#   for Microsoft.Paint_*_x64__*, its split packages, Microsoft.VCLibs.140.00(.UWPDesktop)
#   and Microsoft.WindowsAppRuntime.2 (see Get-AppxPackage Microsoft.Paint).Dependencies.
param(
  [string]$Root = "E:\Windows_Sandbox",
  [ValidateSet("tasks", "widget", "probe", "script", "edge-probe")][string]$Mode = "tasks",
  [string]$Tasks = "all",
  [string]$Model = "qwen3.8:latest",
  [int]$NumCtx = 32768,
  [string]$LlmUrl = "",
  [string]$AarSrc = "",
  [int]$TimeoutMinutes = 120,
  [switch]$SkipPaint,
  [switch]$KeepOpen
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path "$PSScriptRoot\..\.."
$base = Join-Path $Root "desktop"
$in = Join-Path $base "in"; $out = Join-Path $base "out"; $pkgs = Join-Path $base "paint-pkgs"
New-Item -ItemType Directory -Force $pkgs | Out-Null

Remove-Item -Recurse -Force $in, $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $in, $out | Out-Null
$setup = Get-ChildItem (Join-Path $repo "dist\Aar_*_x64-setup.exe") | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $setup) { throw "No installer in dist\ - run scripts/wsl/build.sh first" }
Copy-Item $setup.FullName, "$repo\tests\sandbox\desktop_inside.ps1", "$repo\tests\sandbox\desktop_tasks.py", "$repo\tests\sandbox\paint_probe.py", "$repo\tests\sandbox\edge_probe.py", "$repo\tests\sandbox\widget_driver.py", "$repo\tests\sandbox\e2e_agent.py" $in
if ($AarSrc) {
  robocopy "$AarSrc\tools\windows_mcp" "$in\override\windows_mcp" /E /XD __pycache__ /NFL /NDL /NJH /NJS | Out-Null
  Copy-Item "$AarSrc\agent\extensions\mcp.py" "$in\override\aar_mcp.py"
}
@{ mode = $Mode; tasks = $Tasks; model = $Model; numCtx = $NumCtx; llmUrl = $LlmUrl } | ConvertTo-Json | Set-Content "$in\params.json" -Encoding UTF8

$paintMap = if ($SkipPaint) { "" } else { "<MappedFolder><HostFolder>$pkgs</HostFolder><SandboxFolder>C:\paint-pkgs</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>" }
$config = @"
<Configuration>
  <Networking>Enable</Networking>
  <MemoryInMB>8192</MemoryInMB>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <MappedFolders>
    <MappedFolder><HostFolder>$in</HostFolder><SandboxFolder>C:\aar-in</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    $paintMap
    <MappedFolder><HostFolder>$out</HostFolder><SandboxFolder>C:\aar-out</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
</Configuration>
"@

$mutex = New-Object System.Threading.Mutex($false, "Global\aar-windows-sandbox")
Write-Host "==> waiting for the sandbox slot"
[void]$mutex.WaitOne()
$id = $null
try {
  Write-Host "==> starting Windows Sandbox (mode=$Mode, tasks=$Tasks, model=$Model)"
  $started = wsb start --config $config --raw | ConvertFrom-Json
  $id = $started.Id
  if (-not $id) { throw "wsb start failed: $started" }
  Start-Process wsb -ArgumentList "connect", "--id", $id
  $ErrorActionPreference = "Continue"
  $deadline = (Get-Date).AddMinutes(5)
  do {
    Start-Sleep 5
    wsb exec --id $id -c "cmd /c exit 0" -r ExistingLogin 2>&1 | Out-Null
  } until ($LASTEXITCODE -eq 0 -or (Get-Date) -gt $deadline)
  if ($LASTEXITCODE -ne 0) { throw "sandbox user session did not come up" }

  Start-Job -ScriptBlock { param($id) wsb exec --id $id -c "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\aar-in\desktop_inside.ps1" -r ExistingLogin } -ArgumentList $id | Out-Null
  $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
  $shown = 0
  while (-not (Test-Path "$out\done.txt") -and (Get-Date) -lt $deadline) {
    Start-Sleep 5
    if (Test-Path "$out\log.txt") {
      $lines = Get-Content "$out\log.txt" -Encoding UTF8
      $lines | Select-Object -Skip $shown | ForEach-Object { Write-Host "    $_" }
      $shown = $lines.Count
    }
  }
  if (-not (Test-Path "$out\done.txt")) { Write-Warning "timeout after $TimeoutMinutes min" }
}
finally {
  Get-Job | Remove-Job -Force -ErrorAction SilentlyContinue
  if ($id -and $KeepOpen) { Write-Host "    sandbox left running (wsb stop --id $id)" }
  elseif ($id) { wsb stop --id $id 2>&1 | Out-Null; Write-Host "==> sandbox stopped" }
  $mutex.ReleaseMutex(); $mutex.Dispose()
}
Write-Host "==> results in $out"
