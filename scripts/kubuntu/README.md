# Kubuntu tests in WSL

Aar Desktop's Linux packages tested in KDE Plasma inside isolated WSL distros – without any window on
the Windows desktop:

| Distro | Plasma | Session |
|---|---|---|
| `Kubuntu-aarui-2604` | 6 (Ubuntu 26.04) | Wayland: `kwin_wayland --virtual` + XWayland (`run-test.sh`) |
| `Kubuntu-aarui-2404` | 5 (Ubuntu 24.04) | X11: Xvfb + `kwin_x11` (`run-x11.sh`), the 24.04 default |

> **WSLg shows every window on the host.** Before each test run `isolate-gui.sh` as root, and start
> sessions only through `run-test.sh` / `run-x11.sh` – they source `no-wslg.sh` (private runtime dir,
> no WSLg sockets) and abort if WSLg is still reachable.

## Set up (once per distro)

```bash
wsl --install Ubuntu-26.04 --name Kubuntu-aarui-2604 --location E:\WSL\Kubuntu-aarui-2604 --no-launch
# as root, while the drives are still mounted: Plasma, test tools, user "tester" (no sudo),
# packages from dist/linux, then /etc/wsl.conf without drives and Windows interop
wsl -d Kubuntu-aarui-2604 -u root -- bash /mnt/b/Github_my/aar_ui/scripts/kubuntu/setup.sh
wsl --terminate Kubuntu-aarui-2604        # applies the isolation
```

After that the distro cannot see `B:` any more. Copy files in through `wsl.exe` from Git Bash (UNC paths
and PowerShell pipes do not work: BOM/CRLF):

```bash
for f in scripts/kubuntu/*.sh; do
  b=$(base64 -w0 "$f")
  MSYS_NO_PATHCONV=1 wsl.exe -d Kubuntu-aarui-2604 -- bash -c "echo $b | base64 -d | tr -d '\r' > /home/tester/aar/$(basename $f); chmod +x /home/tester/aar/$(basename $f)"
done
# binary packages via stdin (check with sha256sum)
MSYS_NO_PATHCONV=1 wsl.exe -d Kubuntu-aarui-2604 -- bash -c "cat > /home/tester/aar/Aar_0.1.3_amd64.AppImage" < dist/linux/Aar_0.1.3_amd64.AppImage
```

Root part of the isolation (`isolate-gui.sh`) goes to `/root/isolate-gui.sh` the same way, with `-u root`.

## Run

```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Kubuntu-aarui-2604 -u root -- bash /root/isolate-gui.sh
MSYS_NO_PATHCONV=1 wsl.exe -d Kubuntu-aarui-2604 -- bash -c "MODEL=qwen3.5:4b bash /home/tester/aar/run-test.sh appimage"   # or targz
MSYS_NO_PATHCONV=1 wsl.exe -d Kubuntu-aarui-2404 -- bash -c "bash /home/tester/aar/run-x11.sh appimage"
```

`session.sh` starts kded (tray watcher) and plasmashell, then Aar: first start (setup assistant), second
start = toggle, restart with Ollama, a typed chat prompt (xdotool), collapse. Results in
`/home/tester/aar/shots/<pkg>/`: `test.log` (window geometry, `_NET_WM_STATE`, tray items), `aar.log`,
screenshots of Aar's window (`xwd`; the virtual KWin has no OpenGL for workspace shots) and, under X11,
of the whole screen. `probe-geom.sh` logs the window geometry over time when expanding/collapsing.

A local model for the chat test: `setup-ollama.sh` installs Ollama the way the setup assistant does
(`aar-desktop --setup`, no root, `~/.local`) and pulls `qwen3.5:4b`. Without a display session, run it
inside the distro as tester.
