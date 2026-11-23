# Run pytest for an aar source tree inside a fresh Windows Sandbox (for
# Windows-only integration tests: UI Automation, PowerShell execution, ...).
# Nothing is executed on the host. Only one sandbox can run at a time, so runs
# are serialised with a system-wide mutex.
#
#   powershell -ExecutionPolicy Bypass -File scripts\sandbox\aar-pytest.ps1 `
#     -Src B:\Github_my\aar_wt\windows-mcp -Extras "dev,mcp,acp" -Packages "pywinauto" `
#     -PytestArgs "tests/live -m windows_live -x -q"
#
# Output (default <Root>\pytest\<src folder name>): pytest.txt, pip.log, done.txt (exit code),
# anything the tests write to C:\out
param(
  [Parameter(Mandatory)] [string]$Src,
  [string]$Extras = "dev",
  [string]$Packages = "",
  [string]$PytestArgs = "-q",
  [string]$Out = "",
  [string]$Root = "E:\Windows_Sandbox",
  [string]$PythonHome = "$env:LOCALAPPDATA\Programs\Python\Python312",
  [int]$TimeoutMinutes = 30
)
$ErrorActionPreference = "Stop"
$Src = (Resolve-Path $Src).Path
if (-not $Out) { $Out = Join-Path $Root ("pytest\" + (Split-Path $Src -Leaf)) }
Remove-Item -Recurse -Force $Out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $Out | Out-Null
if (-not (Test-Path "$PythonHome\python.exe")) { throw "No Python at $PythonHome" }

# Script that runs inside the sandbox (as the logged-in sandbox user).
$inner = @"
`$ErrorActionPreference = 'Continue'
function Log(`$m) { Add-Content C:\out\log.txt "`$(Get-Date -Format HH:mm:ss) `$m" }
Log 'copy sources'
robocopy C:\src C:\work /E /XD .venv .git __pycache__ node_modules .ruff_cache .pytest_cache .agent /NFL /NDL /NJH /NJS | Out-Null
Log 'create venv'
& C:\py\python.exe -m venv C:\venv *> C:\out\venv.log
Log 'pip install'
`$spec = 'C:\work[$Extras]'
& C:\venv\Scripts\python.exe -m pip install --disable-pip-version-check -e `$spec $Packages *> C:\out\pip.log
Log "pip exit `$LASTEXITCODE"
Set-Location C:\work
Log 'pytest $PytestArgs'
`$env:AAR_SANDBOX = '1'
& C:\venv\Scripts\python.exe -m pytest $PytestArgs *> C:\out\pytest.txt
`$code = `$LASTEXITCODE
Log "pytest exit `$code"
"`$code" | Set-Content C:\out\done.txt
"@
Set-Content -Path "$Out\inner.ps1" -Value $inner -Encoding UTF8

$config = @"
<Configuration>
  <Networking>Enable</Networking>
  <MemoryInMB>8192</MemoryInMB>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <MappedFolders>
    <MappedFolder><HostFolder>$Src</HostFolder><SandboxFolder>C:\src</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$PythonHome</HostFolder><SandboxFolder>C:\py</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$Out</HostFolder><SandboxFolder>C:\out</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
</Configuration>
"@

$mutex = New-Object System.Threading.Mutex($false, "Global\aar-windows-sandbox")
Write-Host "==> waiting for the sandbox slot"
[void]$mutex.WaitOne()
$id = $null
try {
  $ErrorActionPreference = "Continue"
  $id = (wsb start --config $config --raw | ConvertFrom-Json).Id
  if (-not $id) { throw "wsb start failed" }
  Write-Host "==> sandbox $id"
  Start-Process wsb -ArgumentList "connect", "--id", $id     # creates the user logon
  $deadline = (Get-Date).AddMinutes(5)
  do { Start-Sleep 5; wsb exec --id $id -c "cmd /c exit 0" -r ExistingLogin 2>&1 | Out-Null }
  until ($LASTEXITCODE -eq 0 -or (Get-Date) -gt $deadline)
  if ($LASTEXITCODE -ne 0) { throw "sandbox user session did not come up" }

  Start-Job -ScriptBlock { param($id) wsb exec --id $id -c "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\out\inner.ps1" -r ExistingLogin } -ArgumentList $id | Out-Null
  $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
  $shown = 0
  while (-not (Test-Path "$Out\done.txt") -and (Get-Date) -lt $deadline) {
    Start-Sleep 5
    if (Test-Path "$Out\log.txt") {
      $l = @(Get-Content "$Out\log.txt"); $l | Select-Object -Skip $shown | ForEach-Object { Write-Host "    $_" }; $shown = $l.Count
    }
  }
}
finally {
  Get-Job | Remove-Job -Force -ErrorAction SilentlyContinue
  if ($id) { wsb stop --id $id 2>&1 | Out-Null; Write-Host "==> sandbox stopped" }
  $mutex.ReleaseMutex(); $mutex.Dispose()
}

if (-not (Test-Path "$Out\done.txt")) { Write-Host "TIMEOUT - see $Out"; exit 3 }
Get-Content "$Out\pytest.txt" -Tail 40
$code = [int](Get-Content "$Out\done.txt")
Write-Host "==> pytest exit $code (full output: $Out\pytest.txt)"
exit $code
