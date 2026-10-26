#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! docker --context colima-rocketchat image inspect rocketchat-local:8.9.0-devices-v1 >/dev/null 2>&1; then
  "$HERE/../account-devices/build.sh"
fi
docker --context colima-rocketchat build --ulimit nofile=65536:65536 -f "$HERE/Dockerfile" -t rocketchat-local:8.9.0-ai-v1 "$HERE/.."
