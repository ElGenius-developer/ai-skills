#!/usr/bin/env bash
# detect_conflicts.sh — read-only merge conflict preview
#
# Usage:   detect_conflicts.sh <source-ref> <target-ref>
# Example: detect_conflicts.sh feature/x main
#          detect_conflicts.sh HEAD origin/main
#
# Output: human-readable report on stdout. Exit 0 = no conflicts, 1 = conflicts found, 2 = error.
# Side effects: NONE. No working-tree, index, or ref is modified.

set -euo pipefail

SRC="${1:-}"
TGT="${2:-}"

if [[ -z "$SRC" || -z "$TGT" ]]; then
  echo "Usage: $0 <source-ref> <target-ref>" >&2
  exit 2
fi

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git not found in PATH" >&2
  exit 2
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: not inside a git repository" >&2
  exit 2
fi

# Resolve refs to SHAs to detect typos early.
SRC_SHA="$(git rev-parse --verify "$SRC^{commit}" 2>/dev/null || true)"
TGT_SHA="$(git rev-parse --verify "$TGT^{commit}" 2>/dev/null || true)"

if [[ -z "$SRC_SHA" ]]; then echo "ERROR: cannot resolve source ref: $SRC" >&2; exit 2; fi
if [[ -z "$TGT_SHA" ]]; then echo "ERROR: cannot resolve target ref: $TGT" >&2; exit 2; fi

# Already merged?
if git merge-base --is-ancestor "$SRC_SHA" "$TGT_SHA"; then
  echo "## Merge Conflict Preview: \`$SRC\` → \`$TGT\`"
  echo
  echo "**Status:** Already merged. \`$SRC\` is an ancestor of \`$TGT\`. No action needed."
  exit 0
fi

BASE_SHA="$(git merge-base "$SRC_SHA" "$TGT_SHA" 2>/dev/null || true)"
if [[ -z "$BASE_SHA" ]]; then
  echo "ERROR: no common ancestor between $SRC and $TGT" >&2
  exit 2
fi

# Detect git version — git ≥ 2.38 supports `merge-tree --write-tree`.
GIT_VER="$(git --version | awk '{print $3}')"
GIT_MAJ="$(echo "$GIT_VER" | cut -d. -f1)"
GIT_MIN="$(echo "$GIT_VER" | cut -d. -f2)"
HAS_MERGE_TREE_WRITE=0
if [[ "$GIT_MAJ" -gt 2 ]] || { [[ "$GIT_MAJ" -eq 2 ]] && [[ "$GIT_MIN" -ge 38 ]]; }; then
  HAS_MERGE_TREE_WRITE=1
fi

CONFLICT_PATHS=()

if [[ "$HAS_MERGE_TREE_WRITE" -eq 1 ]]; then
  # `git merge-tree --write-tree` simulates a merge in-memory.
  # On conflict, exit is non-zero and the second section of stdout lists conflicted paths.
  set +e
  MT_OUT="$(git merge-tree --write-tree --name-only --no-messages "$TGT_SHA" "$SRC_SHA" 2>/dev/null)"
  MT_EXIT=$?
  set -e

  if [[ "$MT_EXIT" -eq 0 ]]; then
    # Clean merge — no conflicts.
    :
  else
    # First line of MT_OUT is the merged tree SHA; subsequent lines (after blank) are conflicted paths.
    # In practice with --name-only, lines after the first non-blank section are the paths.
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      # Skip the leading tree SHA (40-hex line).
      if [[ "$line" =~ ^[0-9a-f]{40}$ ]]; then continue; fi
      CONFLICT_PATHS+=("$line")
    done <<< "$MT_OUT"
  fi
else
  # Fallback: simulate inside a temporary worktree, then destroy it.
  TMP_WT="$(mktemp -d -t git-conflict-review-XXXXXX)"
  trap 'git worktree remove --force "$TMP_WT" >/dev/null 2>&1 || true; rm -rf "$TMP_WT"' EXIT

  git worktree add --detach "$TMP_WT" "$TGT_SHA" >/dev/null 2>&1

  set +e
  ( cd "$TMP_WT" && git merge --no-commit --no-ff "$SRC_SHA" >/dev/null 2>&1 )
  MERGE_EXIT=$?
  if [[ "$MERGE_EXIT" -ne 0 ]]; then
    while IFS= read -r path; do
      [[ -n "$path" ]] && CONFLICT_PATHS+=("$path")
    done < <( cd "$TMP_WT" && git diff --name-only --diff-filter=U )
  fi
  # Always abort the temp merge to leave the worktree clean before removal.
  ( cd "$TMP_WT" && git merge --abort >/dev/null 2>&1 || true )
  set -e
fi

# ------------------------------------------------------------------------------
# Classify and rank
# ------------------------------------------------------------------------------

classify_severity() {
  local p="$1"
  case "$p" in
    *.sql|*/migrations/*|*/Database/*|*/database/*|.github/*|Dockerfile|docker-compose*.yml|*.env.example)
      echo "CRITICAL" ;;
    package-lock.json|composer.lock|yarn.lock|pnpm-lock.yaml|Cargo.lock|Gemfile.lock|poetry.lock)
      echo "CRITICAL" ;;
    */routes/*|*/Controllers/*|*/Models/*|*/Services/*|*/Middleware/*|*/Repositories/*|*/Requests/*)
      echo "HIGH" ;;
    */features/*|*/components/*|*/hooks/*|*/pages/*|*.tsx|*.jsx|*.ts|*.js|*.vue|*.svelte)
      echo "MEDIUM" ;;
    *Test*.php|*.test.*|*.spec.*|*/tests/*|*/__tests__/*|*.md|*/locales/*|*translations*|*openapi*.json|*swagger*.json|*api-docs*.json)
      echo "LOW" ;;
    *) echo "MEDIUM" ;;
  esac
}

classify_type() {
  local p="$1"
  # Check rename / delete / binary by diffing each side vs merge base.
  local in_src in_tgt in_base
  in_base=$(git cat-file -e "$BASE_SHA:$p" 2>/dev/null && echo 1 || echo 0)
  in_src=$(git cat-file -e "$SRC_SHA:$p" 2>/dev/null && echo 1 || echo 0)
  in_tgt=$(git cat-file -e "$TGT_SHA:$p" 2>/dev/null && echo 1 || echo 0)

  if [[ "$in_base" -eq 1 && "$in_src" -eq 0 && "$in_tgt" -eq 1 ]]; then echo "delete-modify"; return; fi
  if [[ "$in_base" -eq 1 && "$in_src" -eq 1 && "$in_tgt" -eq 0 ]]; then echo "delete-modify"; return; fi
  if [[ "$in_base" -eq 0 && "$in_src" -eq 1 && "$in_tgt" -eq 1 ]]; then echo "add-add"; return; fi

  # Binary detection on the source side.
  if [[ "$in_src" -eq 1 ]]; then
    if git diff --numstat "$BASE_SHA" "$SRC_SHA" -- "$p" 2>/dev/null | grep -qE '^-\s+-\s+'; then
      echo "binary"; return
    fi
  fi

  echo "content"
}

count_lines() {
  local p="$1"
  if git cat-file -e "$SRC_SHA:$p" 2>/dev/null; then
    git show "$SRC_SHA:$p" 2>/dev/null | wc -l | tr -d ' '
  else
    echo "—"
  fi
}

# Sort by severity rank
severity_rank() {
  case "$1" in
    CRITICAL) echo 0 ;;
    HIGH)     echo 1 ;;
    MEDIUM)   echo 2 ;;
    LOW)      echo 3 ;;
    *)        echo 4 ;;
  esac
}

# ------------------------------------------------------------------------------
# Render report
# ------------------------------------------------------------------------------

echo "## Merge Conflict Preview: \`$SRC\` → \`$TGT\`"
echo
echo "- **Source:** \`$SRC\` (\`${SRC_SHA:0:10}\`)"
echo "- **Target:** \`$TGT\` (\`${TGT_SHA:0:10}\`)"
echo "- **Merge base:** \`${BASE_SHA:0:10}\`"
echo

if [[ "${#CONFLICT_PATHS[@]}" -eq 0 ]]; then
  echo "**Status:** No conflicts. Merge would apply cleanly."
  echo
  echo "**Next step:** Proceed directly to the **git-pr-merge** skill."
  exit 0
fi

# Build rows
ROWS=()
COUNT_CRITICAL=0; COUNT_HIGH=0; COUNT_MEDIUM=0; COUNT_LOW=0
for p in "${CONFLICT_PATHS[@]}"; do
  sev="$(classify_severity "$p")"
  typ="$(classify_type "$p")"
  lines="$(count_lines "$p")"
  rank="$(severity_rank "$sev")"
  ROWS+=("$rank|$sev|$p|$typ|$lines")
  case "$sev" in
    CRITICAL) COUNT_CRITICAL=$((COUNT_CRITICAL+1)) ;;
    HIGH)     COUNT_HIGH=$((COUNT_HIGH+1)) ;;
    MEDIUM)   COUNT_MEDIUM=$((COUNT_MEDIUM+1)) ;;
    LOW)      COUNT_LOW=$((COUNT_LOW+1)) ;;
  esac
done

TOTAL=${#CONFLICT_PATHS[@]}
echo "**Summary:** $TOTAL conflicting file(s) — CRITICAL: $COUNT_CRITICAL, HIGH: $COUNT_HIGH, MEDIUM: $COUNT_MEDIUM, LOW: $COUNT_LOW"
echo
echo "| # | Severity | File | Type | Lines |"
echo "|---|----------|------|------|-------|"

# Sort rows by severity rank
IFS=$'\n' SORTED=($(printf '%s\n' "${ROWS[@]}" | sort -t'|' -k1,1n -k3,3))
unset IFS

idx=1
for r in "${SORTED[@]}"; do
  IFS='|' read -r _rank sev path typ lines <<< "$r"
  echo "| $idx | $sev | \`$path\` | $typ | $lines |"
  idx=$((idx+1))
done

echo
echo "**Recommended order:** CRITICAL → HIGH → MEDIUM → LOW. Resolve lockfiles by regenerating, never hand-edit."
echo
echo "**Next step:** Run the **git-conflict-resolve** skill to walk through each conflict with per-block user approval."

exit 1
