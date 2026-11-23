#!/usr/bin/env bash
# Run the Rust unit tests natively (Linux) in the WSL build VM.
#   wsl -d Ubuntu-aarui -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/test-rust.sh
set -euo pipefail
source "$HOME/.cargo/env"
SRC="${AAR_UI_SRC:-/mnt/b/Github_my/aar_ui}"
WORK="$HOME/build/aar_ui"
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude dist-web \
  --exclude src-tauri/target --exclude src-tauri/gen --exclude .git --exclude dist-py \
  "$SRC/" "$WORK/"
cd "$WORK"
[[ -d node_modules ]] || npm ci --no-audit --no-fund
mkdir -p dist-web dist-py/python   # generate_context!/resources must exist
cd src-tauri
cargo test --lib --target-dir target/native
