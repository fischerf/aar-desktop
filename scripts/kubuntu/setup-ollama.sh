#!/usr/bin/env bash
# Install Ollama the way Aar's setup assistant does it (no root, ~/.local) and pull a model.
cd ~/aar
./Aar_*_amd64.AppImage --setup ~/aar/ollama-setup.log "${1:-qwen3.5:4b}"
echo "exit=$?"
tail -5 ~/aar/ollama-setup.log
ls -la ~/.local/bin/ollama && du -sh ~/.local/lib/ollama
curl -s -m 3 127.0.0.1:11434/api/version; echo
