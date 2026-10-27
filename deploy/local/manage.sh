#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTEXT=colima-rocketchat
PROFILE=rocketchat

initialize() {
  if [[ ! -f "$HERE/.env" ]]; then
    (umask 077; python3 - "$HERE/.env" <<'PY'
import os, secrets, sys
with open(sys.argv[1], 'x') as f:
    f.write('ADMIN_USERNAME=admin\nADMIN_EMAIL=admin@rocketchat.test\n')
    f.write('ADMIN_PASS=' + secrets.token_urlsafe(32) + '\n')
PY
    )
  fi
  chmod 600 "$HERE/.env"
}

compose() {
  docker --context "$CONTEXT" compose --env-file "$HERE/images.env" --env-file "$HERE/.env" -f "$HERE/compose.yml" "$@"
}

case "${1:-help}" in
  start)
    initialize
    if ! docker --context "$CONTEXT" info >/dev/null 2>&1; then
      colima start "$PROFILE" --vm-type vz --arch x86_64 --cpu 3 --memory 6 --disk 30 --runtime docker --mount-type virtiofs
    fi
    compose up -d --wait --wait-timeout 600
    printf '\nRocket.Chat: http://localhost:3000\nCredentials: %s/.env\n' "$HERE"
    ;;
  stop) compose stop ;;
  stop-vm)
    compose stop
    colima stop "$PROFILE"
    ;;
  status) compose ps -a ;;
  logs) shift; compose logs --tail 100 "$@" ;;
  check) python3 "$HERE/check.py" ;;
  browser-check)
    python3 "$HERE/check.py"
    if [[ ! -d "$HERE/.state/browser/node_modules/playwright-core" ]]; then
      npm install --prefix "$HERE/.state/browser" --no-audit --no-fund --ignore-scripts playwright-core@1.64.1
    fi
    node "$HERE/browser-check.cjs"
    ;;
  build-devices) "$HERE/../../custom/account-devices/build.sh" ;;
  build-ai) "$HERE/../../custom/local-ai/build.sh" ;;
  build-workspace) "$HERE/../../custom/workspace-devices/build.sh" ;;
  build-canned) "$HERE/../../custom/canned-responses/build.sh" ;;
  build-views) "$HERE/../../custom/message-views/build.sh" ;;
  prepare-ai) "$HERE/../../custom/local-ai/prepare.sh" ;;
  credentials) cat "$HERE/.env" ;;
  backup)
    initialize
    mkdir -p "$HERE/backups"
    chmod 700 "$HERE/backups"
    archive="$HERE/backups/rocketchat-$(date +%Y%m%d-%H%M%S).archive.gz"
    (umask 077; compose exec -T mongodb mongodump --db rocketchat --archive --gzip > "$archive.partial")
    mv "$archive.partial" "$archive"
    printf '%s\n' "$archive"
    ;;
  compose) shift; compose "$@" ;;
  *) printf 'Usage: %s {start|stop|stop-vm|status|logs [service]|check|browser-check|build-devices|build-ai|build-workspace|build-canned|build-views|prepare-ai|credentials|backup|compose ...}\n' "$0" ;;
esac
