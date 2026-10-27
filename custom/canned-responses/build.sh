#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker --context colima-rocketchat build --ulimit nofile=65536:65536 -f "$HERE/Dockerfile" -t rocketchat-local:8.9.0-canned-v1 "$HERE/.."
