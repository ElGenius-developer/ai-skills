#!/bin/bash
# Install the context-budget and post-merge hooks into ~/.claude/hooks and merge them into settings.json.
# Idempotent: backs up settings, appends (never replaces), skips entries already present, validates with jq.
# Overrides for testing: CLAUDE_HOME (default ~/.claude), SETTINGS_FILE (default $CLAUDE_HOME/settings.json).
set -euo pipefail
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
SETTINGS="${SETTINGS_FILE:-$CLAUDE_HOME/settings.json}"
mkdir -p "$CLAUDE_HOME/hooks"
for f in context-budget.sh context_budget.py post-merge-handoff.sh; do
  if [ -e "$CLAUDE_HOME/hooks/$f" ] && ! cmp -s "$HERE/assets/hooks/$f" "$CLAUDE_HOME/hooks/$f"; then
    echo "kept existing $CLAUDE_HOME/hooks/$f (differs from the asset; not overwritten)"
  else
    cp "$HERE/assets/hooks/$f" "$CLAUDE_HOME/hooks/$f"
  fi
  chmod +x "$CLAUDE_HOME/hooks/$f"
done
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
jq empty "$SETTINGS"
cp "$SETTINGS" "$SETTINGS.bak-$(date +%Y%m%d%H%M%S)"
add() { # event matcher script
  local cmd="bash \"\$HOME/.claude/hooks/$3\""
  if jq -e --arg ev "$1" --arg s "$3" '[.hooks[$ev][]?.hooks[]?.command // empty | select(contains($s))] | length > 0' "$SETTINGS" >/dev/null 2>&1; then
    echo "already present: $1 $3"; return
  fi
  local entry
  entry=$(jq -n --arg m "$2" --arg c "$cmd" '{hooks:[{type:"command",command:$c,timeout:5}]} + (if $m=="" then {} else {matcher:$m} end)')
  jq --arg ev "$1" --argjson e "$entry" '.hooks = (.hooks // {}) | .hooks[$ev] = ((.hooks[$ev] // []) + [$e])' "$SETTINGS" > "$SETTINGS.tmp"
  jq empty "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
  echo "added: $1 $3"
}
add UserPromptSubmit "" context-budget.sh
add PostToolUse Bash post-merge-handoff.sh
jq empty "$SETTINGS" && echo "settings valid: $SETTINGS"
