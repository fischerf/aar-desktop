# Run the installer/runtime/app tests in a fresh Windows Sandbox (nothing is
# installed or started on the host). Requires the Windows Sandbox feature and
# its CLI `wsb` (Windows 11 24H2+).
#
#   powershell -ExecutionPolicy Bypass -File scripts\sandbox\run.ps1          # quick (~2 min)
#   powershell -ExecutionPolicy Bypass -File scripts\sandbox\run.ps1 -Full    # + Ollama install and model download
#
# Data (inputs, results, Ollama model cache) lives outside the repo under -Root:
#   <Root>\installer-test\in, <Root>\installer-test\out (results.json, log.txt, screenshots),
#   <Root>\ollama-models (kept between -Full runs)
param(
  [string]$Root = "E:\Windows_Sandbox",
  [switch]$Full,
  [string]$Model = "qwen3.5:4b",
  [int]$TimeoutMinutes = 0,
  [switch]$KeepOpen
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path "$PSScriptRoot\..\.."
$in = Join-Path $Root "installer-test\in"
$out = Join-Path $Root "installer-test\out"
if ($TimeoutMinutes -le 0) { $TimeoutMinutes = if ($Full) { 90 } else { 35 } }

# Stage inputs (read-only for the sandbox) and an empty output folder.
Remove-Item -Recurse -Force $in, $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $in, $out | Out-Null
$setup = Get-ChildItem (Join-Path $repo "dist\Aar_*_x64-setup.exe") | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $setup) { throw "No installer in dist\ - run scripts/wsl/build.sh first" }
Copy-Item $setup.FullName, "$repo\tests\sandbox\inside.ps1", "$repo\tests\sandbox\mcp_probe.py", "$repo\tests\sandbox\mcp_user_probe.py", "$repo\tests\sandbox\mcp_cmd_probe.py", "$repo\tests\sandbox\e2e_agent.py", "$repo\scripts\probe_acp.py" $in
# aar wheel (built with --python) for the "own aar" scenario.
Get-ChildItem (Join-Path $repo "dist\aar_agent-*.whl") -ErrorAction SilentlyContinue | Copy-Item -Destination $in
# Test photos for the photo search (kept on the host, never in the repo).
if (Test-Path (Join-Path $Root "photos")) { Copy-Item (Join-Path $Root "photos") (Join-Path $in "photos") -Recurse }

# -Full: Ollama model cache kept on the host between runs (not cleaned).
$cache = Join-Path $Root "ollama-models"
$memory = 8192
$cacheMap = ""
if ($Full) {
  New-Item -ItemType Directory -Force $cache | Out-Null
  $memory = 12288
  $cacheMap = "<MappedFolder><HostFolder>$cache</HostFolder><SandboxFolder>C:\ollama-models</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>"
}

$config = @"
<Configuration>
  <Networking>Enable</Networking>
  <MemoryInMB>$memory</MemoryInMB>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <MappedFolders>
    <MappedFolder><HostFolder>$in</HostFolder><SandboxFolder>C:\aar-in</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$out</HostFolder><SandboxFolder>C:\aar-out</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
    $cacheMap
  </MappedFolders>
</Configuration>
"@

# Only one Windows Sandbox can run at a time; share the slot with aar-pytest.ps1.
$mutex = New-Object System.Threading.Mutex($false, "Global\aar-windows-sandbox")
Write-Host "==> waiting for the sandbox slot"
[void]$mutex.WaitOne()
$id = $null
try {
  Write-Host "==> starting Windows Sandbox ($($setup.Name), Full=$Full)"
  $started = wsb start --config $config --raw | ConvertFrom-Json
  $id = $started.Id
  if (-not $id) { throw "wsb start failed: $started" }
  Write-Host "    sandbox id $id"

  # A user logon (needed for GUI apps and per-user installs) only exists once a
  # client is connected: this opens the Sandbox window on the host desktop.
  Start-Process wsb -ArgumentList "connect", "--id", $id
  $ErrorActionPreference = "Continue"   # native stderr must not abort the retry loop
  $deadline = (Get-Date).AddMinutes(5)
  do {
    Start-Sleep 5
    wsb exec --id $id -c "cmd /c exit 0" -r ExistingLogin 2>&1 | Out-Null
  } until ($LASTEXITCODE -eq 0 -or (Get-Date) -gt $deadline)
  if ($LASTEXITCODE -ne 0) { throw "sandbox user session did not come up" }

  $cmdArgs = "-NoProfile -ExecutionPolicy Bypass -File C:\aar-in\inside.ps1"
  if ($Full) { $cmdArgs += " -Full -Model $Model" }
  Write-Host "==> running tests inside the sandbox"
  # Fire and forget; completion is signalled by done.txt in the output folder.
  Start-Job -ScriptBlock { param($id, $a) wsb exec --id $id -c "powershell.exe $a" -r ExistingLogin } -ArgumentList $id, $cmdArgs | Out-Null

  $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
  $shown = 0
  while (-not (Test-Path "$out\done.txt") -and (Get-Date) -lt $deadline) {
    Start-Sleep 5
    if (Test-Path "$out\log.txt") {
      $lines = Get-Content "$out\log.txt"
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

$results = Get-Content "$out\results.json" -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
if (-not $results) { Write-Error "no results"; exit 2 }
$failed = @($results | Where-Object { -not $_.ok })
Write-Host ""
$results | ForEach-Object { Write-Host ("{0}  {1}  {2}" -f ($(if ($_.ok) { "PASS" } else { "FAIL" })), $_.name, $_.detail) }
Write-Host ""
if ($failed.Count) { Write-Host "$($failed.Count) FAILED" -ForegroundColor Red; exit 1 }
Write-Host "ALL PASSED" -ForegroundColor Green
