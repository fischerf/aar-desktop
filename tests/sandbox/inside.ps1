# Runs INSIDE Windows Sandbox (a clean Windows without Python, aar or Ollama).
# Input (read-only):  C:\aar-in   installer + helper scripts
# Output (writable):  C:\aar-out  results.json, log.txt, screenshots, done.txt
param([switch]$Full, [string]$Model = "qwen3.5:4b", [string]$VisionModels = "qwen3.5:4b,moondream:1.8b")

$ErrorActionPreference = "Continue"
$in = "C:\aar-in"; $out = "C:\aar-out"
$results = New-Object System.Collections.ArrayList
function Log($m) { $line = "$(Get-Date -Format HH:mm:ss) $m"; Add-Content -Path "$out\log.txt" -Value $line -Encoding UTF8 }
function Result($name, $ok, $detail = "") {
  [void]$results.Add([ordered]@{ name = $name; ok = [bool]$ok; detail = "$detail" })
  Log ("{0} {1} {2}" -f ($(if ($ok) { "PASS" } else { "FAIL" })), $name, $detail)
}
. "$in\webview_fix.ps1"

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class SbWin {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  public static IntPtr Find(uint pid) { IntPtr found = IntPtr.Zero;
    EnumWindows((h,p)=>{ uint wp; GetWindowThreadProcessId(h,out wp); var sb=new StringBuilder(64); GetWindowText(h,sb,64);
      if(wp==pid && sb.ToString()=="Aar"){ found=h; return false; } return true; }, IntPtr.Zero); return found; }
}
"@
function Capture($procId, $file) {
  $h = [SbWin]::Find([uint32]$procId)
  if ($h -eq [IntPtr]::Zero) { return "no window" }
  $r = New-Object SbWin+RECT; [SbWin]::GetWindowRect($h, [ref]$r) | Out-Null
  $w = $r.R - $r.L; $hh = $r.B - $r.T
  $bmp = New-Object System.Drawing.Bitmap $w, $hh
  $g = [System.Drawing.Graphics]::FromImage($bmp); $hdc = $g.GetHdc()
  [SbWin]::PrintWindow($h, $hdc, 2) | Out-Null; $g.ReleaseHdc($hdc); $g.Dispose()
  $bmp.Save($file); $bmp.Dispose()
  return "pos=$($r.L),$($r.T) size=${w}x${hh}"
}

Log "sandbox test start (Full=$Full)"
Log ("OS: " + (Get-CimInstance Win32_OperatingSystem).Caption)
Result "clean machine: no aar on PATH" (-not (Get-Command aar -ErrorAction SilentlyContinue))
Result "clean machine: no python on PATH" (-not (Get-Command python -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike "*WindowsApps*" }))

# 1. Silent install (per user, no admin) ------------------------------------
$setup = Get-ChildItem "$in\Aar_*_x64-setup.exe" | Select-Object -First 1
$p = Start-Process $setup.FullName -ArgumentList "/S" -Wait -PassThru
$exe = Get-ChildItem "$env:LOCALAPPDATA" -Recurse -Filter aar-desktop.exe -ErrorAction SilentlyContinue | Select-Object -First 1
Result "installer /S" ($p.ExitCode -eq 0 -and $exe) "exit=$($p.ExitCode) exe=$($exe.FullName)"
if (-not $exe) { $results | ConvertTo-Json -Depth 4 | Set-Content "$out\results.json" -Encoding UTF8; "done" | Set-Content "$out\done.txt"; exit 1 }
$dir = $exe.DirectoryName
$py = Join-Path $dir "python\python.exe"

# 2. Bundled runtime ----------------------------------------------------------
Result "bundled python present" (Test-Path $py) $py
$imp = & $py -c "import sys, agent, acp, mcp; print(sys.version.split()[0])" 2>&1
Result "bundled runtime imports aar/acp/mcp" ($LASTEXITCODE -eq 0) "$imp"

# 2a. Cloud providers: SDKs bundled; another provider type than the default
#     profile must not inherit its Ollama address/options (aar fix), the key
#     comes from the environment (as the widget passes it). A fake key must
#     reach api.anthropic.com and be rejected there (401), not localhost.
$imp3 = & $py -c "import anthropic, openai, google.genai; print(anthropic.__version__, openai.__version__)" 2>&1
Result "bundled runtime has the cloud SDKs (anthropic, openai, google-genai)" ($LASTEXITCODE -eq 0) "$imp3"
$cloudCfg = Join-Path $env:TEMP "cloud-config.json"
'{"provider": "local", "providers": {"local": {"name": "ollama", "model": "x", "base_url": "http://127.0.0.1:9", "extra": {"num_ctx": 8192, "top_k": 20}}}}' |
  Set-Content $cloudCfg -Encoding ASCII
$env:ANTHROPIC_API_KEY = "sk-ant-api03-invalid-key-for-a-test"
$cr = & $py -m agent.transports.cli run "Hi" --provider anthropic --model claude-sonnet-4-6 --config $cloudCfg 2>&1 | Out-String
Remove-Item Env:ANTHROPIC_API_KEY
$cr | Set-Content "$out\cloud_provider.txt" -Encoding UTF8
Result "aar with --provider anthropic reaches Anthropic (key rejected, no Ollama leftovers)" (($cr -match "401|authentication|x-api-key") -and ($cr -notmatch "127\.0\.0\.1:9|num_ctx")) (($cr -split "`r?`n" | Where-Object { $_ -match "401|authentication|error" } | Select-Object -First 2) -join " | ")

# 2b. Bundled Windows desktop MCP server ------------------------------------
$imp2 = & $py -c "import sys; print(sys.path); import windows_mcp.server as s; print('ok', s.__file__)" 2>&1 | Out-String
$imp2 | Set-Content "$out\mcp_import.txt" -Encoding UTF8
Result "windows MCP server module imports" ($LASTEXITCODE -eq 0) (($imp2 -split "`r?`n" | Select-Object -Last 4) -join " | ")
$mcp = & $py "$in\mcp_probe.py" 2>&1 | Out-String
$mcp | Set-Content "$out\mcp_probe.txt" -Encoding UTF8
Result "windows MCP server lists its tools" ($LASTEXITCODE -eq 0 -and $mcp -match "launch_app") (($mcp -split "`r?`n" | Where-Object { $_ -match "readOnly" }) -join ", ")

# 3. ACP handshake with the bundled runtime (no LLM needed) ------------------
$env:AAR_ACP_CMD = "`"$py`" -m agent.transports.cli"
$probe = & $py "$in\probe_acp.py" - 2>&1 | Out-String
$probe | Set-Content "$out\probe.txt" -Encoding UTF8
Result "aar acp: initialize + session/new" ($probe -match '"sessionId"') ($probe -split "`n" | Select-String "agentInfo" | Select-Object -First 1)

# 3b. Add-ons: extensions from the registry, MCP servers via pip ---------------
$data = Join-Path $env:LOCALAPPDATA "de.aar.ui"
$env:AAR_DESKTOP_EXT_DIR = Join-Path $data "extensions"
function HelperJson($text) {
  $line = ($text -split "`r?`n" | Where-Object { $_ -like "@@JSON *" } | Select-Object -Last 1)
  if ($line) { return ($line.Substring(7) | ConvertFrom-Json) } else { return $null }
}
$h = & $py -m aar_desktop.ext list 2>&1 | Out-String
$list = HelperJson $h
Result "ext list (helper) works" ($list.ok -and $list.supportsDisable) ("aar {0}, {1} extension(s)" -f $list.aarVersion, @($list.extensions).Count)
$src = "https://github.com/fischerf/aar-extensions-registry/archive/refs/heads/main.zip#subdirectory=packages/aar-ext-permission-gate"
$h = & $py -m aar_desktop.ext install aar-ext-permission-gate $src 2>&1 | Out-String
$h | Set-Content "$out\ext_install.txt" -Encoding UTF8
$inst = HelperJson $h
Result "ext install from the registry (no git, no PyPI)" ($LASTEXITCODE -eq 0 -and $inst.ok) ("{0} {1} eps={2}" -f $inst.dist, $inst.version, ($inst.entryPoints -join ","))
$list = HelperJson (& $py -m aar_desktop.ext list 2>&1 | Out-String)
$gate = @($list.extensions) | Where-Object { $_.name -eq "permission_gate" }
Result "installed extension is inspected" ($gate -and $gate.managed -and ($gate.hooks -contains "tool_call") -and -not $gate.error) ("hooks={0} managed={1} err={2}" -f ($gate.hooks -join ","), $gate.managed, $gate.error)
$code = "from aar_desktop._site import add_ext_site; add_ext_site(); from agent.extensions.loader import discover_extensions; print(','.join(i.name for i in discover_extensions()))"
$on = & $py -c $code 2>$null
$env:AAR_DISABLED_EXTENSIONS = "permission-gate"
$off = & $py -c $code 2>$null
Remove-Item Env:AAR_DISABLED_EXTENSIONS
Result "AAR_DISABLED_EXTENSIONS switches an extension off" ("$on" -match "permission_gate" -and "$off" -notmatch "permission_gate") "on=[$on] off=[$off]"
$h = & $py -m aar_desktop.ext uninstall aar-ext-permission-gate 2>&1 | Out-String
$list = HelperJson (& $py -m aar_desktop.ext list 2>&1 | Out-String)
Result "ext uninstall" ($LASTEXITCODE -eq 0 -and -not (@($list.extensions) | Where-Object { $_.name -eq "permission_gate" })) ""
# Reinstall for the app start below (switched off there via settings).
& $py -m aar_desktop.ext install aar-ext-permission-gate $src *> $null

# Every published extension of the registry installs and loads.
# Parsed with Python: the registry has a key "" ($schema), which PS 5.1's ConvertFrom-Json rejects.
$names = & $py -c "import json; from aar_desktop.node import _get; d = json.loads(_get('https://raw.githubusercontent.com/fischerf/aar-extensions-registry/main/extensions.json')); print(' '.join(e['pypi'] for e in d['extensions'] if e.get('status') == 'published'))"
$published = @("$names".Trim() -split " " | Where-Object { $_ })
Result "registry lists published extensions" ($published.Count -ge 8) ($published -join ", ")
$archive = "https://github.com/fischerf/aar-extensions-registry/archive/refs/heads/main.zip"
foreach ($pkg in @($published | Where-Object { $_ -ne "aar-ext-permission-gate" })) {
  $h = & $py -m aar_desktop.ext install $pkg "$archive#subdirectory=packages/$pkg" 2>&1 | Out-String
  $r = HelperJson $h
  if (-not $r.ok) { $h | Set-Content "$out\ext_$pkg.txt" -Encoding UTF8 }
  Result "ext install: $pkg" ($r.ok) ("{0} eps={1}" -f $r.version, ($r.entryPoints -join ","))
}
$list = HelperJson (& $py -m aar_desktop.ext list 2>&1 | Out-String)
foreach ($x in @($list.extensions)) {
  Result "ext loads: $($x.name)" (-not $x.error) ("hooks={0} tools={1} cmds={2} {3}" -f ($x.hooks -join ","), (($x.tools | ForEach-Object { $_.name }) -join ","), ($x.commands -join ","), $x.error)
}

$fetchDir = Join-Path $data "mcp\fetch"
$h = & $py -m aar_desktop.mcp install $fetchDir mcp-server-fetch 2>&1 | Out-String
$h | Set-Content "$out\mcp_install.txt" -Encoding UTF8
Result "MCP server install (pip --target)" ($LASTEXITCODE -eq 0) (($h -split "`r?`n" | Where-Object { $_ -match "Successfully installed" }) -replace "(.{160}).*", '$1...')
$mp = & $py "$in\mcp_user_probe.py" $fetchDir mcp-server-fetch fetch 2>&1 | Out-String
$mp | Set-Content "$out\mcp_user_probe.txt" -Encoding UTF8
Result "installed MCP server starts and lists its tools" ($LASTEXITCODE -eq 0) (($mp -split "`r?`n" | Where-Object { $_ -match "^server=" }) -join " ")

# npm-based servers with the portable Node.js (downloaded by the helper).
$env:AAR_DESKTOP_NODE_DIR = Join-Path $data "node"
$nodeExe = Join-Path $env:AAR_DESKTOP_NODE_DIR "node.exe"
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
function NodeBin($dir) { Join-Path $dir ((Get-Content (Join-Path $dir "launch.json") -Raw | ConvertFrom-Json).bin) }
$cdtDir = Join-Path $data "mcp\chrome-devtools"
$h = & $py -m aar_desktop.node install $cdtDir chrome-devtools-mcp@latest chrome-devtools-mcp 2>&1 | Out-String
$h | Set-Content "$out\node_install.txt" -Encoding UTF8
Result "portable Node.js + chrome-devtools-mcp (npm)" ($LASTEXITCODE -eq 0 -and (Test-Path $nodeExe) -and (Test-Path (Join-Path $cdtDir "launch.json"))) ((& $nodeExe --version 2>&1) -join "")
$cdtArgs = @((NodeBin $cdtDir), "--executablePath", $edge, "--slim", "--headless", "--isolated", "--no-usage-statistics")
$env:CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS = "1"
$mp = & $py "$in\mcp_cmd_probe.py" navigate navigate '{\"url\": \"https://example.com\"}' -- $nodeExe @cdtArgs 2>&1 | Out-String
$mp | Set-Content "$out\cdt_probe.txt" -Encoding UTF8
Result "chrome-devtools-mcp drives Edge (slim, headless)" ($LASTEXITCODE -eq 0) (($mp -split "`r?`n" | Where-Object { $_ -match "^(server|call)" }) -join " | ")
$mp = & $py "$in\mcp_cmd_probe.py" navigate_page - '{}' -- $nodeExe (NodeBin $cdtDir) --executablePath $edge --headless --isolated --no-usage-statistics --no-category-emulation --no-category-performance --no-category-network --no-category-memory 2>&1 | Out-String
$mp | Set-Content "$out\cdt_standard.txt" -Encoding UTF8
Result "chrome-devtools-mcp standard tool set" ($LASTEXITCODE -eq 0) (($mp -split "`r?`n" | Where-Object { $_ -match "^server" }) -replace "tools=.*", "")
$pwDir = Join-Path $data "mcp\playwright"
$h = & $py -m aar_desktop.node install $pwDir "@playwright/mcp@latest" playwright-mcp 2>&1 | Out-String
$h | Set-Content "$out\playwright_install.txt" -Encoding UTF8
Result "playwright-mcp installed (npm)" ($LASTEXITCODE -eq 0) ""
$mp = & $py "$in\mcp_cmd_probe.py" browser_navigate browser_navigate '{\"url\": \"https://example.com\"}' -- $nodeExe (NodeBin $pwDir) --browser msedge --headless --isolated 2>&1 | Out-String
$mp | Set-Content "$out\playwright_probe.txt" -Encoding UTF8
Result "playwright-mcp drives Edge" ($LASTEXITCODE -eq 0 -and $mp -match "Example Domain") (($mp -split "`r?`n" | Where-Object { $_ -match "^(server|call)" } | ForEach-Object { $_.Substring(0, [Math]::Min(200, $_.Length)) }) -join " | ")

# Photo search: Pillow/HEIC in the runtime, index two real photos with the host's
# Ollama (sandbox gateway), search them through the photos MCP server.
$imp = & $py -c "import PIL, pillow_heif; print(PIL.__version__, pillow_heif.__version__)" 2>&1
Result "photo libraries (Pillow, HEIC)" ($LASTEXITCODE -eq 0) "$imp"
$photoDir = Join-Path $env:USERPROFILE "Pictures\Testfotos"
New-Item -ItemType Directory -Force "$photoDir\Urlaub" | Out-Null
# Test photos come from the host (E:\Windows_Sandbox\photos, staged by run.ps1):
# downloading them here runs into Wikimedia's rate limit.
if (Test-Path "$in\photos") { Copy-Item "$in\photos\*" $photoDir -Recurse -Force } else { Log "no test photos staged" }
$gw = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4DefaultGateway.NextHop
$env:AAR_DESKTOP_PHOTO_DIRS = $photoDir
$env:AAR_DESKTOP_PHOTO_DB = Join-Path $data "photos"
$env:AAR_DESKTOP_OLLAMA_URL = "http://${gw}:11434"
$env:AAR_DESKTOP_PHOTO_MODEL = "qwen3.8:latest"
$t0 = Get-Date
& $py -m aar_desktop.photos index *> "$out\photos_index.txt"
$secs = [int]((Get-Date) - $t0).TotalSeconds
$st = HelperJson (& $py -m aar_desktop.photos status 2>&1 | Out-String)
Result "photo index via host Ollama ($($env:AAR_DESKTOP_OLLAMA_URL))" ($st.indexed -eq 2 -and $st.errors -eq 0) ("indexed {0}/{1} in {2}s, thumbs={3} {4}" -f $st.indexed, $st.photos, $secs, @(Get-ChildItem "$($env:AAR_DESKTOP_PHOTO_DB)\thumbs" -ErrorAction SilentlyContinue).Count, $st.progress.error)
$mp = & $py "$in\mcp_cmd_probe.py" photo_search photo_search '{\"terms\": [\"table\", \"desk\"]}' -- $py -m aar_desktop.photos serve 2>&1 | Out-String
$mp | Set-Content "$out\photos_probe.txt" -Encoding UTF8
Result "photo_search finds the table photo (Windows paths)" ($LASTEXITCODE -eq 0 -and $mp -match "Esszimmer.jpg" -and $mp -notmatch "Park.jpg") (($mp -split "`r?`n" | Where-Object { $_ -match "^call" }) -join " ")
foreach ($v in "AAR_DESKTOP_PHOTO_DIRS", "AAR_DESKTOP_PHOTO_DB", "AAR_DESKTOP_OLLAMA_URL", "AAR_DESKTOP_PHOTO_MODEL") { Remove-Item "Env:$v" }

# The app reads these settings: fetch server on, permission_gate off, English UI.
New-Item -ItemType Directory -Force (Join-Path $env:APPDATA "de.aar.ui") | Out-Null
@{
  language = "en"; disabledExtensions = @("permission_gate"); photoFolders = @($photoDir); photoModel = "qwen3.8:latest"
  mcpServers = @(
    @{ id = "fetch"; label = "Read web pages"; kind = "package"; enabled = $true; catalog = "fetch"; package = "mcp-server-fetch"; script = "mcp-server-fetch" },
    @{ id = "chrome-devtools"; label = "Chrome DevTools"; kind = "node"; enabled = $true; catalog = "chrome-devtools"; package = "chrome-devtools-mcp@latest"; script = "chrome-devtools-mcp"
       args = @("--executablePath", "{edge}", "--slim", "--headless", "--isolated", "--no-usage-statistics") }
  )
} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $env:APPDATA "de.aar.ui\settings.json") -Encoding UTF8

# 4. Diagnose -----------------------------------------------------------------
$dp = Start-Process $exe.FullName -ArgumentList "--diagnose", "$out\diagnose.json" -PassThru; $dp.WaitForExit()
$diag = Get-Content "$out\diagnose.json" -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
Result "diagnose: bundled python detected" ($diag.bundledPython) "$($diag.bundledPython)"
Result "diagnose: hardware" ($diag.system.ramMb -gt 0) ("RAM {0} MB, GPUs: {1}" -f $diag.system.ramMb, (($diag.system.gpus | ForEach-Object { "$($_.name) $($_.vramMb)MB" }) -join "; "))
Result "diagnose: ollama not installed" (-not $diag.ollama.installed)

# 5. Start the app: agent from bundled runtime, first-run wizard ------------
$app = Start-Process $exe.FullName -PassThru
Start-Sleep 15
$child = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $app.Id -and $_.CommandLine -match "aar_desktop.boot" }
Result "app starts aar from bundled runtime (with user extensions)" ($child) "$($child.CommandLine)"
$mcpProc = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "windows_mcp.server" }
Result "aar starts the windows MCP server passed by the widget" ($mcpProc) "$($mcpProc.CommandLine)"
$userMcp = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "aar_desktop.mcp run" }
Result "aar starts the user's MCP server from the settings" ($userMcp) "$($userMcp.CommandLine)"
$photoMcp = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "aar_desktop.photos serve" }
Result "aar starts the photo search server (photo folders set)" ($photoMcp) "$($photoMcp.CommandLine)"
$nodeMcp = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "chrome-devtools-mcp" }
Result "aar starts the npm server with Edge filled in for {edge}" ($nodeMcp -and $nodeMcp.CommandLine -match "msedge.exe") "$($nodeMcp.CommandLine)"
$log = Get-Content (Join-Path $env:LOCALAPPDATA "de.aar.ui\logs\aar.log") -ErrorAction SilentlyContinue | Out-String
Copy-Item (Join-Path $env:LOCALAPPDATA "de.aar.ui\logs\aar.log") "$out\aar.log" -ErrorAction SilentlyContinue
Result "no MCP server failed to start" ($log -notmatch "MCP server '.*' skipped") (($log -split "`r?`n" | Where-Object { $_ -match "MCP" } | Select-Object -Last 2) -join " | ")
Result "app window" ((Capture $app.Id "$out\app-start.png") -ne "no window") (Capture $app.Id "$out\app-start.png")

# 6. Full: unattended Ollama install + model download -----------------------
if ($Full) {
  # Ollama must download into a local folder (its resumable part files break on
  # mapped folders). A finished model is copied to the host cache afterwards and
  # copied back in on later runs, so the download happens only once.
  $models = "C:\ollama-models-local"
  New-Item -ItemType Directory -Force $models | Out-Null
  if (Test-Path "C:\ollama-models\manifests") {
    Log "restoring cached models from the host"
    robocopy "C:\ollama-models" $models /E /XF "*-partial*" /NFL /NDL /NJH /NJS | Out-Null
  }
  [Environment]::SetEnvironmentVariable("OLLAMA_MODELS", $models, "User")
  $env:OLLAMA_MODELS = $models
  Log "installing Ollama + pulling $Model (this takes a while)"
  # Not -Wait: that waits for the whole process tree, and setup leaves the Ollama tray app running.
  $sp = Start-Process $exe.FullName -ArgumentList "--setup", "$out\setup.log", $Model -PassThru
  $sp.WaitForExit()
  $setupLog = @(Get-Content "$out\setup.log" -ErrorAction SilentlyContinue)
  Result "setup: Ollama installed + $Model pulled" ($setupLog[-1] -eq "OK") ($setupLog | Select-Object -Last 3 | Out-String)
  if ($setupLog[-1] -eq "OK" -and (Test-Path "C:\ollama-models")) {
    Log "saving models to the host cache"
    robocopy $models "C:\ollama-models" /E /XF "*-partial*" /NFL /NDL /NJH /NJS | Out-Null
  }

  # Small vision models for the photo search on the processor only (the sandbox
  # has no CUDA/ROCm): download, describe the test photos, search them.
  foreach ($vm in @($VisionModels -split "," | Where-Object { $_ })) {
    if ($vm -ne $Model) {
      $vp = Start-Process $exe.FullName -ArgumentList "--setup", "$out\setup-$($vm -replace '[:/]', '_').log", $vm -PassThru
      $vp.WaitForExit()
      $vlog = @(Get-Content "$out\setup-$($vm -replace '[:/]', '_').log" -ErrorAction SilentlyContinue)
      Result "photo model $vm downloaded" ($vlog[-1] -eq "OK") ($vlog | Select-Object -Last 2 | Out-String)
    }
    $tag = $vm -replace '[:/]', '_'
    $env:AAR_DESKTOP_PHOTO_DIRS = $photoDir
    $env:AAR_DESKTOP_PHOTO_DB = Join-Path $env:TEMP "photos-$tag"
    $env:AAR_DESKTOP_OLLAMA_URL = "http://127.0.0.1:11434"
    $env:AAR_DESKTOP_PHOTO_MODEL = $vm
    # The sandbox's Ollama reaches the host GPU (Vulkan): force the processor.
    $env:AAR_DESKTOP_OLLAMA_OPTIONS = '{"num_gpu": 0}'
    $t0 = Get-Date
    & $py -m aar_desktop.photos index *> "$out\photos_index_$tag.txt"
    $secs = [int]((Get-Date) - $t0).TotalSeconds
    $st = HelperJson (& $py -m aar_desktop.photos status 2>&1 | Out-String)
    $rows = & $py -c "import os, sqlite3; db = sqlite3.connect(os.path.join(os.environ['AAR_DESKTOP_PHOTO_DB'], 'index.sqlite')); [print(os.path.basename(r[0]), '|', r[1], '|', r[2], '|', r[3]) for r in db.execute('SELECT path, description, objects, error FROM photos')]" 2>&1 | Out-String
    $rows | Set-Content "$out\photos_rows_$tag.txt" -Encoding UTF8
    # size_vram 0 = the model runs on the processor only.
    $ps = try { (Invoke-RestMethod "http://127.0.0.1:11434/api/ps" -TimeoutSec 10).models | Where-Object { $_.name -like "$($vm.Split(':')[0])*" } | Select-Object -First 1 } catch { $null }
    Result "photo index on CPU with $vm" ($st.indexed -eq 2 -and $st.errors -eq 0 -and $ps -and $ps.size_vram -eq 0) ("indexed {0}/{1} in {2}s (incl. model load), vram={3} cpus={4} {5}" -f $st.indexed, $st.photos, $secs, $ps.size_vram, [Environment]::ProcessorCount, $st.progress.error)
    $mp = & $py "$in\mcp_cmd_probe.py" photo_search photo_search '{\"terms\": [\"table\", \"desk\"]}' -- $py -m aar_desktop.photos serve 2>&1 | Out-String
    $mp | Set-Content "$out\photos_probe_$tag.txt" -Encoding UTF8
    # The park has picnic tables under a pavilion: a hit there is fine, the dining room must come first.
    Result "photo_search ($vm) finds the table photo first" ($LASTEXITCODE -eq 0 -and $mp -match "1\. [^\r\n]*Esszimmer.jpg") (($rows -split "`r?`n" | Where-Object { $_ } | ForEach-Object { $_.Substring(0, [Math]::Min(140, $_.Length)) }) -join " || ")
    foreach ($v in "AAR_DESKTOP_PHOTO_DIRS", "AAR_DESKTOP_PHOTO_DB", "AAR_DESKTOP_OLLAMA_URL", "AAR_DESKTOP_PHOTO_MODEL", "AAR_DESKTOP_OLLAMA_OPTIONS") { Remove-Item "Env:$v" -ErrorAction SilentlyContinue }
  }
  if (Test-Path "C:\ollama-models") { robocopy $models "C:\ollama-models" /E /XF "*-partial*" /NFL /NDL /NJH /NJS | Out-Null }

  # End to end: model -> aar (ACP, like the widget) -> Windows MCP -> msinfo32.
  Get-Process msinfo32 -ErrorAction SilentlyContinue | Stop-Process -Force
  Log "e2e: asking $Model to open System Information"
  & $py "$in\e2e_agent.py" "$out\e2e.json" $Model *> "$out\e2e.log"
  $e2eOk = $LASTEXITCODE -eq 0
  $e2e = Get-Content "$out\e2e.json" -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
  Result "e2e: model calls launch_app via aar + windows MCP" ($e2e.launch_app_called) ("approval asked: {0}, {1}s, stop: {2}" -f $e2e.approval_asked, $e2e.seconds, $e2e.stopReason)
  Result "e2e: System Information window is open" ($e2eOk -and $e2e.msinfo32_running) ""
  $shot = Get-Process msinfo32 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($shot) { Stop-Process -Id $shot.Id -Force -ErrorAction SilentlyContinue }

  # Restart the app: the wizard should now find Ollama and the model.
  Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep 2
  $app = Start-Process $exe.FullName -PassThru
  Start-Sleep 15
  Result "app after setup" ((Capture $app.Id "$out\app-after-setup.png") -ne "no window") ""
}

Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue

# 7. "Own aar": a normal Python with aar installed (like a developer PC with
#    `aar` on PATH). Add-ons must be managed with *that* Python and reach it.
$wheel = Get-ChildItem "$in\aar_agent-*.whl" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($wheel) {
  Get-Process aar-desktop, python, node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $own = "C:\ownpy"
  try {
    Invoke-WebRequest "https://www.nuget.org/api/v2/package/python/3.12.10" -OutFile "$env:TEMP\python.zip" -UseBasicParsing
    Expand-Archive "$env:TEMP\python.zip" "$env:TEMP\pynuget" -Force
    Move-Item "$env:TEMP\pynuget\tools" $own
  } catch { Log "python download failed: $($_.Exception.Message)" }
  $ownPy = "$own\python.exe"
  & $ownPy -m pip install -q --disable-pip-version-check "$($wheel.FullName)[acp,mcp]" *> "$out\ownpy_pip.txt"
  $ownAar = "$own\Scripts\aar.exe"
  Result "own aar installed (normal Python 3.12)" ($LASTEXITCODE -eq 0 -and (Test-Path $ownAar)) $ownAar
  # The app writes its helpers to %LOCALAPPDATA%\de.aar.ui\helpers for this case.
  @{ agentCommand = $ownAar; agentArgs = @("acp"); disabledExtensions = @()
     mcpServers = @(@{ id = "time"; label = "Time"; kind = "package"; enabled = $true; catalog = "time"; package = "mcp-server-time"; script = "mcp-server-time" })
  } | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $env:APPDATA "de.aar.ui\settings.json") -Encoding UTF8
  $app = Start-Process $exe.FullName -PassThru
  Start-Sleep 15
  $helpers = Join-Path $data "helpers"
  Result "app writes its helpers for the own Python" (Test-Path "$helpers\aar_desktop\ext.py") $helpers
  $agentProc = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $app.Id -and $_.CommandLine -match "ownpy" }
  Result "app starts the own aar" ($agentProc) "$($agentProc.CommandLine)"
  Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
  Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

  # What the extensions tab does: install the session report (inspect) with the own Python.
  $env:PYTHONPATH = $helpers
  $h = & $ownPy -m aar_desktop.ext install aar-ext-inspect "$archive#subdirectory=packages/aar-ext-inspect" 2>&1 | Out-String
  $h | Set-Content "$out\ownpy_inspect.txt" -Encoding UTF8
  $r = HelperJson $h
  Result "own aar: install Sitzungsbericht (inspect)" ($r.ok) ("{0} {1}" -f $r.dist, $r.version)
  $list = HelperJson (& $ownPy -m aar_desktop.ext list 2>&1 | Out-String)
  $ins = @($list.extensions) | Where-Object { $_.name -eq "inspect" }
  Result "own aar: inspect loads with /inspect" ($ins -and -not $ins.error -and ($ins.commands -contains "inspect")) ("managed={0} cmds={1} err={2}" -f $ins.managed, ($ins.commands -join ","), $ins.error)
  # aar itself (started with PYTHONPATH = extension dir, as the app does) finds it.
  $env:PYTHONPATH = Join-Path $env:AAR_DESKTOP_EXT_DIR "Lib\site-packages"
  $found = & $ownPy -c "from agent.extensions.loader import discover_extensions; print(','.join(i.name for i in discover_extensions()))" 2>$null
  Result "own aar discovers the installed extension" ("$found" -match "inspect") "[$found]"
  $env:PYTHONPATH = $helpers
  & $ownPy -m aar_desktop.mcp install "$data\mcp\time" mcp-server-time *> "$out\ownpy_mcp.txt"
  Result "own aar: MCP server installed with the own Python" ($LASTEXITCODE -eq 0) ""
  Remove-Item Env:PYTHONPATH
  $app = Start-Process $exe.FullName -PassThru
  Start-Sleep 15
  $timeProc = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "aar_desktop.mcp run" -and $_.CommandLine -match "ownpy" }
  Result "own aar starts the MCP server with the own Python" ($timeProc) "$($timeProc.CommandLine)"
  Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
} else { Log "no aar wheel staged - own-aar scenario skipped" }

$results | ConvertTo-Json -Depth 4 | Set-Content "$out\results.json" -Encoding UTF8
Log "sandbox test end"
"done" | Set-Content "$out\done.txt"
