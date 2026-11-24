# Runs INSIDE Windows Sandbox for scripts\sandbox\desktop.ps1.
# C:\aar-in (installer, scripts, params.json, optional override\), C:\paint-pkgs
# (Paint + frameworks copied from the host), C:\aar-out (results).
$ErrorActionPreference = "Continue"
$in = "C:\aar-in"; $out = "C:\aar-out"
function Log($m) { Add-Content -Path "$out\log.txt" -Value "$(Get-Date -Format HH:mm:ss) $m" -Encoding UTF8 }
$params = Get-Content "$in\params.json" -Raw | ConvertFrom-Json
Log "desktop test start (mode=$($params.mode))"

# 1. Aar (bundled runtime + windows MCP server) -------------------------------
$setup = Get-ChildItem "$in\Aar_*_x64-setup.exe" | Select-Object -First 1
Start-Process $setup.FullName -ArgumentList "/S" -Wait
$exe = Get-ChildItem "$env:LOCALAPPDATA" -Recurse -Filter aar-desktop.exe -ErrorAction SilentlyContinue | Select-Object -First 1
$rt = Join-Path $exe.DirectoryName "python"
$py = Join-Path $rt "python.exe"
Log "aar installed: $py"
if (Test-Path "$in\override\windows_mcp") {
  robocopy "$in\override\windows_mcp" "$rt\aar-tools\windows_mcp" /MIR /NFL /NDL /NJH /NJS | Out-Null
  $mcp = Get-ChildItem $rt -Recurse -Filter mcp.py | Where-Object { $_.FullName -match "\\agent\\extensions\\mcp.py$" } | Select-Object -First 1
  Copy-Item "$in\override\aar_mcp.py" $mcp.FullName -Force
  Log "windows_mcp + agent/extensions/mcp.py overridden from source"
}

# 2. Paint ---------------------------------------------------------------------
# Store packages copied from WindowsApps cannot be registered as they are:
# frameworks never in developer mode, Paint itself is refused there too. So
# repack each folder with makeappx and sign it with a self-signed certificate
# carrying the same publisher name (package family names stay the same), which
# is trusted only inside this throwaway sandbox.
if (Test-Path "C:\paint-pkgs\*\AppxManifest.xml") {
  $t0 = Get-Date
  $tools = "C:\sdk-buildtools"
  $ProgressPreference = "SilentlyContinue"
  Invoke-WebRequest "https://www.nuget.org/api/v2/package/Microsoft.Windows.SDK.BuildTools" -OutFile "$env:TEMP\bt.zip"
  Expand-Archive "$env:TEMP\bt.zip" $tools -Force
  $makeappx = (Get-ChildItem $tools -Recurse -Filter makeappx.exe | Where-Object { $_.FullName -match "\\x64\\" } | Select-Object -First 1).FullName
  $signtool = (Get-ChildItem $tools -Recurse -Filter signtool.exe | Where-Object { $_.FullName -match "\\x64\\" } | Select-Object -First 1).FullName
  $cert = New-SelfSignedCertificate -Type Custom -Subject "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US" -KeyUsage DigitalSignature -CertStoreLocation Cert:\CurrentUser\My -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
  Export-PfxCertificate -Cert $cert -FilePath C:\repack.pfx -Password (ConvertTo-SecureString "aar" -AsPlainText -Force) | Out-Null
  Export-Certificate -Cert $cert -FilePath C:\repack.cer | Out-Null
  Import-Certificate C:\repack.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
  Import-Certificate C:\repack.cer -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
  $order = Get-ChildItem "C:\paint-pkgs" -Directory | Sort-Object { if ($_.Name -like "Microsoft.VCLibs*") { 0 } elseif ($_.Name -like "Microsoft.WindowsAppRuntime*") { 1 } elseif ($_.Name -like "*_split.*") { 3 } else { 2 } }
  foreach ($d in $order) {
    $src = "C:\repack\$($d.Name)"
    robocopy $d.FullName $src /E /NFL /NDL /NJH /NJS /MT:8 | Out-Null
    Remove-Item "$src\AppxSignature.p7x", "$src\AppxBlockMap.xml", "$src\AppxMetadata" -Recurse -Force -ErrorAction SilentlyContinue
    $appx = "C:\repack\$($d.Name).appx"
    & $makeappx pack /d $src /p $appx /o /nv | Out-Null
    & $signtool sign /fd SHA256 /f C:\repack.pfx /p aar $appx | Out-Null
    try { Add-AppxPackage $appx -ErrorAction Stop } catch { Log "PAINT INSTALL FAILED $($d.Name): $($_.Exception.Message -replace "`r?`n", ' ')" }
    Remove-Item $src -Recurse -Force
  }
  Log ("Paint: {0} ({1:n0}s)" -f (Get-AppxPackage Microsoft.Paint).PackageFullName, ((Get-Date) - $t0).TotalSeconds)
} else { Log "no Paint packages mapped - Paint tasks will fail" }

# 3. LLM endpoint: the host's Ollama through the sandbox gateway --------------
$url = $params.llmUrl
if (-not $url) {
  $gw = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4DefaultGateway.NextHop
  $url = "http://${gw}:11434"
}
try {
  $tags = Invoke-RestMethod "$url/api/tags" -TimeoutSec 10
  Log ("LLM $url reachable, models: " + (($tags.models | ForEach-Object { $_.name }) -join ", "))
} catch { Log "LLM $url NOT reachable: $($_.Exception.Message)" }

# 4. Run -------------------------------------------------------------------------
$env:PYTHONUTF8 = "1"
# Ollama options for the model; -Cpu = processor only (num_gpu 0), else Ollama's default (GPU).
$llmExtra = @{ num_ctx = [int]$params.numCtx }
if ($params.cpu) { $llmExtra.num_gpu = 0 }
Log ("LLM options: " + ($llmExtra | ConvertTo-Json -Compress))
if ($params.mode -eq "tasks") {
  $env:AAR_TEST_LLM_EXTRA = $llmExtra | ConvertTo-Json -Compress
  & $py "$in\desktop_tasks.py" $out $url $params.model $params.tasks $params.numCtx *> "$out\desktop_tasks.log"
} elseif ($params.mode -eq "widget") {
  # An aar profile like a user's own ~/.aar/config.json; the widget uses its default.
  New-Item -ItemType Directory -Force "$env:USERPROFILE\.aar" | Out-Null
  # session_dir with "/" like `aar init` writes it (Explorer must still open the folder).
  @{ provider = "qwen38"; session_dir = ".agent/sessions"; providers = @{ qwen38 = @{ name = "ollama"; model = $params.model; base_url = $url; extra = $llmExtra } } } |
    ConvertTo-Json -Depth 5 | Set-Content "$env:USERPROFILE\.aar\config.json" -Encoding ASCII
  & $py "$in\widget_driver.py" $out $exe.FullName $params.tasks *> "$out\widget_driver.log"
} elseif ($params.mode -eq "edge-probe") {
  & $py "$in\edge_probe.py" $out *> "$out\edge_probe.log"
} else {
  & $py "$in\paint_probe.py" $params.mode $out *> "$out\paint_probe.log"
}
$exitCode = $LASTEXITCODE
if ($params.mode -in "tasks", "widget") {
  try {
    foreach ($m in (Invoke-RestMethod "$url/api/ps" -TimeoutSec 10).models) {
      Log ("LLM loaded: {0} size={1:N1} GB on GPU={2:N1} GB" -f $m.name, ($m.size / 1GB), ($m.size_vram / 1GB))
    }
  } catch { Log "LLM /api/ps failed: $($_.Exception.Message)" }
}
Log "exit=$exitCode"
"done" | Set-Content "$out\done.txt"
