# Helpers for the jammy build chroot (sourced by setup-linux.sh / build-linux.sh).

# Mount /proc, /sys, /dev into the chroot (only what is not mounted yet).
chroot_mount() {
  local root="$1"
  mkdir -p "$root/proc" "$root/sys" "$root/dev"
  mountpoint -q "$root/proc" || mount -t proc proc "$root/proc"
  # rslave: unmounting later must never propagate back to the VM's /sys, /dev.
  mountpoint -q "$root/sys" || { mount --rbind /sys "$root/sys" && mount --make-rslave "$root/sys"; }
  mountpoint -q "$root/dev" || { mount --rbind /dev "$root/dev" && mount --make-rslave "$root/dev"; }
  # DNS of the VM.
  cp -L /etc/resolv.conf "$root/etc/resolv.conf" 2>/dev/null || true
}

chroot_umount() {
  local root="$1"
  for m in dev sys proc; do
    mountpoint -q "$root/$m" && umount -R -l "$root/$m" 2>/dev/null || true
  done
}

# Run a bash script inside the chroot as root (login-like environment).
in_chroot() {
  local root="$1"
  shift
  chroot "$root" /usr/bin/env -i HOME=/root TERM="${TERM:-xterm}" LANG=C.UTF-8 \
    PATH=/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    /bin/bash -c "$1"
}
