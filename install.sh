#!/usr/bin/env bash
# Install skills from this repo into ~/.claude/skills/.
#
# Usage:
#   ./install.sh                    # install all skills
#   ./install.sh direct git-pr-merge   # install only the named ones
#   ./install.sh --force            # overwrite skills that already exist
#
# Hooks are intentionally NOT installed here — see README.md, they need to be
# wired into settings.json deliberately.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$REPO_DIR/skills"
DEST_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"

FORCE=0
REQUESTED=()
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown flag: $arg" >&2; exit 2 ;;
    *) REQUESTED+=("$arg") ;;
  esac
done

if [[ ! -d "$SRC_DIR" ]]; then
  echo "ERROR: no skills/ directory next to install.sh" >&2
  exit 2
fi

if [[ "${#REQUESTED[@]}" -eq 0 ]]; then
  for d in "$SRC_DIR"/*/; do
    REQUESTED+=("$(basename "$d")")
  done
fi

mkdir -p "$DEST_DIR"

INSTALLED=0
SKIPPED=0

for name in "${REQUESTED[@]}"; do
  # An empty name would resolve to the directories themselves and make the
  # `rm -rf "$dest"` below delete the whole skills directory.
  if [[ -z "$name" ]]; then
    echo "  ✗ empty skill name" >&2
    exit 2
  fi

  src="$SRC_DIR/$name"
  dest="$DEST_DIR/$name"

  if [[ ! -d "$src" ]]; then
    echo "  ✗ $name — not found in this repo" >&2
    exit 2
  fi

  if [[ -e "$dest" && "$FORCE" -ne 1 ]]; then
    echo "  ! $name — already exists, skipping (use --force to overwrite)"
    SKIPPED=$((SKIPPED+1))
    continue
  fi

  rm -rf "$dest"
  cp -R "$src" "$dest"
  # Scripts must stay executable through the copy.
  find "$dest" -name '*.sh' -exec chmod +x {} +
  echo "  ✓ $name"
  INSTALLED=$((INSTALLED+1))
done

echo
echo "Installed $INSTALLED skill(s) into $DEST_DIR${SKIPPED:+, skipped $SKIPPED}."
echo "Start a new Claude Code session to pick them up."
