#!/usr/bin/env bash
# pr_safety_check.sh — read-only pre-flight checks before opening a PR
#
# Usage:   pr_safety_check.sh <base-branch>
# Example: pr_safety_check.sh main
#
# Exits 0 if all checks pass, 1 if any check fails. Side effects: NONE.

set -euo pipefail

BASE="${1:-main}"
PASS=0
FAIL=0
WARNINGS=()
FAILURES=()

check() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "  ✓ $label"
    PASS=$((PASS+1))
  else
    echo "  ✗ $label"
    FAILURES+=("$label")
    FAIL=$((FAIL+1))
  fi
}

warn() {
  local label="$1"; shift
  if ! "$@" >/dev/null 2>&1; then
    echo "  ! $label"
    WARNINGS+=("$label")
  fi
}

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: not inside a git repository" >&2
  exit 2
fi

SRC="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$SRC" == "HEAD" ]]; then
  echo "ERROR: detached HEAD — switch to a named branch first" >&2
  exit 2
fi
if [[ "$SRC" == "$BASE" ]]; then
  echo "ERROR: source branch is the same as base ($BASE) — nothing to PR" >&2
  exit 2
fi

# Resolve base ref locally; prefer origin/<base> if it exists.
BASE_REF="$BASE"
if git rev-parse --verify "origin/$BASE" >/dev/null 2>&1; then
  BASE_REF="origin/$BASE"
fi

MERGE_BASE="$(git merge-base "$SRC" "$BASE_REF" 2>/dev/null || true)"
if [[ -z "$MERGE_BASE" ]]; then
  echo "ERROR: no merge base between $SRC and $BASE_REF" >&2
  exit 2
fi

echo "## PR Safety Check"
echo
echo "- Source:  \`$SRC\`"
echo "- Base:    \`$BASE_REF\`"
echo "- Merge base: \`${MERGE_BASE:0:10}\`"
echo

# Files added/modified on this branch vs base
CHANGED_FILES="$(git diff --name-only "$MERGE_BASE"...HEAD || true)"

echo "### Checks"

# 1. Working tree clean
check "Working tree clean (no uncommitted changes)" \
  bash -c '[[ -z "$(git status --porcelain)" ]]'

# 2. At least one commit ahead
AHEAD_COUNT=$(git rev-list --count "$MERGE_BASE"..HEAD)
if [[ "$AHEAD_COUNT" -lt 1 ]]; then
  echo "  ✗ Branch must be ahead of base by ≥1 commit (currently $AHEAD_COUNT)"
  FAILURES+=("Branch has no commits ahead of base")
  FAIL=$((FAIL+1))
else
  echo "  ✓ Branch is $AHEAD_COUNT commit(s) ahead of base"
  PASS=$((PASS+1))
fi

# 3. No leftover conflict markers in tracked files (look only at files in the diff)
HAS_MARKERS=0
if [[ -n "$CHANGED_FILES" ]]; then
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    [[ -f "$f" ]] || continue
    # Skip binary files
    if file --mime "$f" 2>/dev/null | grep -q 'charset=binary'; then continue; fi
    if grep -lE '^(<<<<<<< |>>>>>>> |======= $)' "$f" >/dev/null 2>&1; then
      HAS_MARKERS=1
      echo "      ↳ marker in $f"
    fi
  done <<< "$CHANGED_FILES"
fi
if [[ "$HAS_MARKERS" -eq 0 ]]; then
  echo "  ✓ No leftover conflict markers"
  PASS=$((PASS+1))
else
  echo "  ✗ Conflict markers found in tracked files"
  FAILURES+=("Conflict markers in tracked files")
  FAIL=$((FAIL+1))
fi

# 4. No secret-shaped new files
SECRET_FILES=()
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  case "$f" in
    .env|.env.*|*.pem|*.key|id_rsa|id_dsa|id_ed25519|credentials.json|*service-account*.json|*.p12|*.pfx)
      # .env.example is fine
      [[ "$f" == ".env.example" ]] && continue
      SECRET_FILES+=("$f")
      ;;
  esac
done <<< "$CHANGED_FILES"
if [[ "${#SECRET_FILES[@]}" -eq 0 ]]; then
  echo "  ✓ No secret-shaped files in diff"
  PASS=$((PASS+1))
else
  echo "  ✗ Secret-shaped files in diff: ${SECRET_FILES[*]}"
  FAILURES+=("Secret-shaped files in diff")
  FAIL=$((FAIL+1))
fi

# 5. No huge binaries (>5 MB) added
BIG_BINARIES=()
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  [[ -f "$f" ]] || continue
  size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo 0)
  if [[ "$size" -gt 5242880 ]]; then
    if file --mime "$f" 2>/dev/null | grep -q 'charset=binary'; then
      BIG_BINARIES+=("$f ($size bytes)")
    fi
  fi
done <<< "$CHANGED_FILES"
if [[ "${#BIG_BINARIES[@]}" -eq 0 ]]; then
  echo "  ✓ No binary files >5 MB"
  PASS=$((PASS+1))
else
  echo "  ✗ Large binary files in diff: ${BIG_BINARIES[*]}"
  FAILURES+=("Large binaries in diff")
  FAIL=$((FAIL+1))
fi

# 6. No debug/print statements in the diff additions
DEBUG_HITS=$( ( git diff "$MERGE_BASE"...HEAD -- ':(exclude)*.md' ':(exclude)*test*' ':(exclude)*Test*' 2>/dev/null \
  | grep -E '^\+' \
  | grep -cE 'console\.log|var_dump\(|dd\(|dump\(|print_r\(|println!\(|fmt\.Println' ) || true )
DEBUG_HITS="${DEBUG_HITS:-0}"
if [[ "$DEBUG_HITS" -eq 0 ]]; then
  echo "  ✓ No debug/print statements added"
  PASS=$((PASS+1))
else
  echo "  ! $DEBUG_HITS debug-print line(s) added (warning, not blocking)"
  WARNINGS+=("$DEBUG_HITS debug-print line(s) added")
fi

# 7. No .only / .skip / fdescribe / fit in test files
TEST_FOCUS=$( ( git diff "$MERGE_BASE"...HEAD -- '*test*' '*Test*' '*spec*' 2>/dev/null \
  | grep -E '^\+' \
  | grep -cE '\.only\(|\.skip\(|\bfdescribe\(|\bfit\(' ) || true )
TEST_FOCUS="${TEST_FOCUS:-0}"
if [[ "$TEST_FOCUS" -eq 0 ]]; then
  echo "  ✓ No focused/skipped tests added"
  PASS=$((PASS+1))
else
  echo "  ! $TEST_FOCUS focused/skipped test line(s) added (warning)"
  WARNINGS+=("$TEST_FOCUS focused/skipped tests")
fi

# 8. Remote tracking
if git rev-parse --verify "origin/$SRC" >/dev/null 2>&1; then
  AHEAD=$(git rev-list --count "origin/$SRC..HEAD" 2>/dev/null || echo 0)
  BEHIND=$(git rev-list --count "HEAD..origin/$SRC" 2>/dev/null || echo 0)
  if [[ "$BEHIND" -gt 0 ]]; then
    echo "  ! Local branch is $BEHIND commit(s) behind origin/$SRC (warning)"
    WARNINGS+=("Local branch behind origin")
  else
    echo "  ✓ Local branch is up to date with origin/$SRC (or ahead by $AHEAD)"
    PASS=$((PASS+1))
  fi
else
  echo "  ! origin/$SRC does not exist yet — will be pushed for the first time"
  WARNINGS+=("Branch not yet on remote (first push)")
fi

# 9. gh CLI available + authenticated
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    echo "  ✓ gh CLI authenticated"
    PASS=$((PASS+1))
  else
    echo "  ✗ gh CLI present but not authenticated (run \`gh auth login\`)"
    FAILURES+=("gh not authenticated")
    FAIL=$((FAIL+1))
  fi
else
  echo "  ✗ gh CLI not installed"
  FAILURES+=("gh CLI missing")
  FAIL=$((FAIL+1))
fi

# Summary
echo
echo "### Summary"
echo "- Passed:   $PASS"
echo "- Failed:   $FAIL"
echo "- Warnings: ${#WARNINGS[@]}"
FILE_COUNT=$( ( echo "$CHANGED_FILES" | grep -c '^.\+' ) || true )
echo "- Files in diff: ${FILE_COUNT:-0}"
echo "- Commits ahead: $AHEAD_COUNT"

if [[ "$FAIL" -gt 0 ]]; then
  echo
  echo "**Result: BLOCK** — resolve failures above before opening the PR."
  exit 1
fi

if [[ "${#WARNINGS[@]}" -gt 0 ]]; then
  echo
  echo "**Result: PASS WITH WARNINGS** — review warnings, then proceed."
  exit 0
fi

echo
echo "**Result: PASS** — safe to open the PR."
exit 0
