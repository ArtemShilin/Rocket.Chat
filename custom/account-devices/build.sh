#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$HERE/prepare-geoip.py"
docker --context colima-rocketchat build --ulimit nofile=65536:65536 -t rocketchat-local:8.9.0-devices-v1 "$HERE"
printf '\nBuilt rocketchat-local:8.9.0-devices-v1\n'
