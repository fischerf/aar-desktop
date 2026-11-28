# Dot-sourced by the sandbox scripts (needs Log). The sandbox shares the host's
# WebView2 files but keeps the registry of its base image: after a host WebView2
# update the registered version's folder is gone and every WebView2 app shows
# "Could not find the WebView2 Runtime". Point the loader at the folder that exists.
$wvKey = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
$wvRoot = "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application"
$wvReg = (Get-ItemProperty $wvKey -ErrorAction SilentlyContinue).pv
if ($wvReg -and -not (Test-Path "$wvRoot\$wvReg\msedgewebview2.exe")) {
  $wvDir = Get-ChildItem $wvRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path "$($_.FullName)\msedgewebview2.exe" } |
    Sort-Object { [version]$_.Name } | Select-Object -Last 1
  if ($wvDir) {
    $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = $wvDir.FullName
    Log "WebView2 $wvReg registered but missing (host updated): using $($wvDir.Name)"
  }
}
