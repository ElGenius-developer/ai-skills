#!/usr/bin/env bash
# PreToolUse(Bash) — block any git push that would land on `main`.
# Pushing straight to the default branch is treated as a no-exceptions violation:
# all changes reach main only via a reviewed PR that a human merges.
# Exit 2 = block the tool call.
#
# To guard a differently-named default branch, change PROTECTED below.
set -euo pipefail

CMD="$(python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null || true)"

# Not a git push at all -> allow.
case "$CMD" in
  *"git push"*) ;;
  *) exit 0 ;;
esac

block() {
  echo "[push-guard] BLOCKED: pushing directly to 'main' is prohibited." >&2
  echo "[push-guard] All changes reach main ONLY via a reviewed PR a human merges." >&2
  echo "[push-guard] Push your feature branch instead: git push -u origin <branch>; then 'gh pr create'." >&2
  exit 2
}

# Explicit targets: origin main, origin HEAD:main, origin <anything>:main, -u origin main, etc.
if echo "$CMD" | grep -Eiq 'git[[:space:]]+push([[:space:]]+[^[:space:]]+)*[[:space:]]+(origin[[:space:]]+)?(main|HEAD:main|[^[:space:]]*:main)([[:space:]]|$)'; then
  block
fi

# Bare `git push` while the current branch is main (relies on push.default/upstream).
if echo "$CMD" | grep -Eiq 'git[[:space:]]+push([[:space:]]+(-[^[:space:]]+|--[^[:space:]]+))*[[:space:]]*$'; then
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
  [ "$branch" = "main" ] && block
fi

exit 0
