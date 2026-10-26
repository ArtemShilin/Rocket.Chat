#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANAGE="$HERE/../../deploy/local/manage.sh"
"$MANAGE" start
"$MANAGE" compose exec -T ollama ollama pull embeddinggemma:300m
"$MANAGE" compose exec -T ollama ollama pull qwen3:1.7b
docker --context colima-rocketchat exec -i rocketchat-local-rocketchat-1 node - < <(cat <<'JS'
(async () => {
  const result = await (await fetch('http://ollama:11434/api/tags')).json();
  console.log('Available local models:', result.models.map(item => item.name).join(', '));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
JS
)
