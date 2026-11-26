#!/usr/bin/env bash
# Smoke test of the Linux packages in the WSL build VM (Ubuntu 24.04, headless):
#   * tar.gz: --diagnose finds the bundled runtime + helpers, the runtime imports aar,
#     the GUI starts under Xvfb and launches aar (log), screenshot of the mascot;
#   * AppImage: --diagnose via --appimage-extract-and-run;
#   * rpm: the runtime lands in /usr/lib/Aar/python.
# Nothing is installed into the VM's system; HOME is a temporary folder.
#
#   wsl -d Ubuntu-aarui -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/smoke-linux.sh
set -euo pipefail
SRC="${AAR_UI_SRC:-/mnt/b/Github_my/aar_ui}"
DIST="$SRC/dist/linux"
# Test this version's packages (dist/linux may hold older ones).
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$SRC/src-tauri/tauri.conf.json")"
SHOTS="$SRC/dist/screenshots"
export DEBIAN_FRONTEND=noninteractive
need=()
command -v import >/dev/null || need+=(imagemagick)
command -v rpm2cpio >/dev/null || need+=(rpm2cpio)
command -v cpio >/dev/null || need+=(cpio)
((${#need[@]})) && { apt-get update -qq && apt-get install -y -qq "${need[@]}" >/dev/null; }

T="$(mktemp -d /tmp/aar-smoke.XXXXXX)"
trap 'rm -rf "$T"' EXIT
fail=0
check() { if eval "$1"; then echo "PASS  $2"; else echo "FAIL  $2"; fail=1; fi; }

echo "==> tar.gz ($VERSION)"
tar -xzf "$DIST/Aar_${VERSION}_x86_64.tar.gz" -C "$T"
APP="$T/Aar_${VERSION}_x86_64"
export HOME="$T/home" XDG_CONFIG_HOME="$T/home/.config" XDG_DATA_HOME="$T/home/.local/share"
mkdir -p "$HOME"
"$APP/bin/aar-desktop" --diagnose "$T/diag.json"
diag_ok=0
python3 - "$T/diag.json" "$APP" <<'EOF' || diag_ok=1
import json, sys
d = json.load(open(sys.argv[1]))
print(json.dumps({k: d[k] for k in ("os", "resourceDir", "bundledPython", "bundledHelpers", "system")}, indent=1))
assert d["os"] == "linux", d["os"]
assert (d["bundledPython"] or "").startswith(sys.argv[2] + "/lib/Aar/python/bin/python3"), d["bundledPython"]
assert d["bundledHelpers"] is True
assert d["mcpServers"] == [], "no Windows desktop server on Linux"
EOF
check "[[ $diag_ok == 0 ]]" "diagnose finds bundled runtime and helpers"
check "'$APP/lib/Aar/python/bin/python3' -c 'import aar_desktop.boot, agent.transports.cli, mcp, anthropic, openai, PIL' " "runtime imports aar, mcp, SDKs, pillow"
check "'$APP/lib/Aar/python/bin/python3' -m agent.transports.cli --help >/dev/null" "aar CLI runs"
check "sh '$APP/install.sh' >/dev/null && grep -q '^Exec=\"$APP/bin/aar-desktop\"' '$XDG_DATA_HOME/applications/aar-desktop.desktop'" "install.sh adds the menu entry"

echo "==> GUI under Xvfb"
cat >"$T/gui.sh" <<EOF
"$APP/bin/aar-desktop" >"$T/gui.out" 2>&1 &
PID=\$!
sleep 25
import -window root "$T/screen.png" || true
kill \$PID 2>/dev/null; sleep 1; kill -9 \$PID 2>/dev/null || true
EOF
dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" bash "$T/gui.sh" || true
LOG="$XDG_DATA_HOME/de.aar.ui/logs/aar.log"
[[ -f "$LOG" ]] && sed -n '1,15p' "$LOG"
check "grep -q 'Agent starten: $APP/lib/Aar/python/bin/python3 -m aar_desktop.boot' '$LOG'" "GUI starts aar from the bundled runtime"
check "[[ -f '$XDG_CONFIG_HOME/autostart/aar-desktop.desktop' ]] && grep -q 'Exec=\"$APP/bin/aar-desktop\"' '$XDG_CONFIG_HOME/autostart/aar-desktop.desktop'" "autostart entry written"
check "[[ -f '$XDG_DATA_HOME/de.aar.ui/rules/desktop.md' ]] && grep -q 'use bash' '$XDG_DATA_HOME/de.aar.ui/rules/desktop.md'" "Linux rules written"
check "! grep -qi 'panicked' '$T/gui.out'" "no panic"
grep -v '^$' "$T/gui.out" | head -20 || true
mkdir -p "$SHOTS" && cp "$T/screen.png" "$SHOTS/linux-xvfb.png" 2>/dev/null && echo "screenshot: dist/screenshots/linux-xvfb.png"

echo "==> AppImage"
AI="$DIST/Aar_${VERSION}_amd64.AppImage"
chmod +x "$AI"
(cd "$T" && "$AI" --appimage-extract-and-run --diagnose "$T/diag-ai.json") || true
check "python3 -c \"import json,sys; d=json.load(open('$T/diag-ai.json')); assert d['bundledHelpers'] and '/usr/lib/Aar/python/bin/python3' in d['bundledPython'], d\"" "AppImage finds its runtime"

echo "==> rpm"
# Ubuntu's rpm2cpio exits with 1 on these (zstd) packages although the archive is complete.
mkdir -p "$T/rpm"
rpm2cpio "$DIST/Aar-${VERSION}-1.x86_64.rpm" >"$T/rpm.cpio" || true
(cd "$T/rpm" && cpio -idm --quiet <"$T/rpm.cpio") || true
check "[[ -x '$T/rpm/usr/bin/aar-desktop' && -x '$T/rpm/usr/lib/Aar/python/bin/python3' ]]" "rpm: binary + runtime in /usr/lib/Aar"
check "grep -q '^Exec=aar-desktop' '$T/rpm/usr/share/applications/'*.desktop" "rpm: desktop entry"

ls -la "$DIST"
exit $fail
