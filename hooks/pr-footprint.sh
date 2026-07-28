#!/usr/bin/env bash
# PostToolUse(Bash) — after `gh pr create`, auto-post an objective "PR Footprint"
# comment computed from git: lines added/removed, files added/modified/deleted,
# and newly-added dependencies in composer.json / package.json.
#
# Honesty rule: only measurable, git-derived numbers — NEVER a fabricated
# baseline or a "% saved" figure,
# because a real PR has no counterfactual "bloated version" to measure against.
#
# Decision-ladder notes are NOT machine-generable (they require the author's
# intent: which rung an addition stopped at and what existing code it reused),
# so they are authored by hand in the PR body under the `<!-- pr-footprint:ladder -->`
# heading. This hook never blocks and never edits the body; it always exits 0.
set -uo pipefail

CMD="$(python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null || true)"

# Only act on PR creation. `--web` and a not-yet-created PR are handled naturally
# below (`gh pr view` finds no PR -> exit 0); only `--help` needs an explicit skip.
case "$CMD" in
  *"gh pr create"*) ;;
  *) exit 0 ;;
esac
case "$CMD" in
  *"--help"*) exit 0 ;;
esac

command -v gh >/dev/null 2>&1 || exit 0

# Resolve the just-created PR for the current branch — gives the accurate base
# branch with no stdout parsing. Empty (no PR / error / offline) -> exit 0.
PR_JSON="$(gh pr view --json url,baseRefName,headRefName 2>/dev/null || true)"
[ -n "$PR_JSON" ] || exit 0

PR_URL="$(printf '%s' "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('url',''))" 2>/dev/null || true)"
[ -n "$PR_URL" ] || exit 0

# Idempotency: never double-post.
EXISTING="$(gh pr view --json comments --jq '.comments[].body' 2>/dev/null || true)"
case "$EXISTING" in
  *"<!-- pr-footprint -->"*) exit 0 ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

BODY="$(REPO_ROOT="$REPO_ROOT" PR_JSON="$PR_JSON" python3 - <<'PY' 2>/dev/null || true
import json, os, subprocess

root = os.environ["REPO_ROOT"]
pr = json.loads(os.environ["PR_JSON"])
base = pr.get("baseRefName") or "main"

def git(*args):
    return subprocess.run(["git", "-C", root, *args],
                          capture_output=True, text=True).stdout

rng = f"{base}...HEAD"

added = removed = 0
for line in git("diff", "--numstat", rng).splitlines():
    parts = line.split("\t")
    if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
        added += int(parts[0])
        removed += int(parts[1])

A = M = D = 0
for line in git("diff", "--name-status", rng).splitlines():
    s = line[:1]
    if s == "A":
        A += 1
    elif s == "M":
        M += 1
    elif s == "D":
        D += 1
    elif s == "R":
        M += 1

DEP_KEYS = {
    "composer.json": ("require", "require-dev"),
    "package.json": ("dependencies", "devDependencies"),
}

def deps_of(ref, path, keys):
    out = git("show", f"{ref}:{path}")
    if not out.strip():
        return set()
    try:
        data = json.loads(out)
    except Exception:
        return set()
    names = set()
    for k in keys:
        names |= set((data.get(k) or {}).keys())
    return names

new_deps = []
for path in git("diff", "--name-only", rng).splitlines():
    name = path.rsplit("/", 1)[-1]
    keys = DEP_KEYS.get(name)
    if not keys:
        continue
    for dep in sorted(deps_of("HEAD", path, keys) - deps_of(base, path, keys)):
        new_deps.append(dep)

deps_str = ", ".join(f"`{d}`" for d in new_deps) if new_deps else "none"
net = added - removed
net_str = f"{'+' if net >= 0 else '−'}{abs(net)}"

print(f"""<!-- pr-footprint -->
## 📊 PR Footprint

_Auto-generated from `git diff {base}...HEAD` — objective git counts only, no estimated baseline._

| Metric | Value |
|---|---|
| Lines added | +{added} |
| Lines removed | −{removed} |
| Net | {net_str} |
| Files (added / modified / deleted) | {A} / {M} / {D} |
| New dependencies | {deps_str} |

_Decision-ladder notes (why each substantive addition was necessary) are in the PR description under `<!-- pr-footprint:ladder -->`._
""")
PY
)"

[ -n "$BODY" ] || exit 0

gh pr comment "$PR_URL" --body "$BODY" >/dev/null 2>&1 || exit 0
echo "[pr-footprint] posted PR Footprint comment to $PR_URL" >&2
exit 0
