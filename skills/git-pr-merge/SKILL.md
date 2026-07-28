---
name: git-pr-merge
description: Push the current branch, create a GitHub Pull Request with auto-generated title and body, run a structured review of the diff, wait for CI checks, and squash-merge with explicit user confirmation. Use when the user asks to "open a PR", "create a pull request and merge", "ship this branch", "merge this branch into main", or wants the full push-to-merge workflow. Uses the `gh` CLI; squash-merges by default; never merges without explicit user "yes"; deletes the source branch and switches back to the base branch after merge. Third step of the git-conflict-review → git-conflict-resolve → git-pr-merge workflow; safe to run standalone if the branch is already conflict-free.
---

# Git PR Merge

## Overview

Takes a clean local branch from "ready to ship" to "merged on main". The skill pushes, creates a PR, reviews the diff for common issues, waits for CI, and squash-merges — with explicit user approval at every state-changing step.

## When to Use

- "Open a PR for this branch"
- "Push this and create a pull request, then merge it"
- "Ship this branch"
- After running **git-conflict-resolve** and the merge commit (or rebased branch) is local and clean

## Non-Negotiable Rules

1. **Never merge without explicit user "yes" / "merge it" / "approved"** after the diff review.
2. **Never force-push to `main`/`master`**, regardless of how the user phrases the request. If the user asks for it, refuse and explain why.
3. **Never force-push** at all unless the user explicitly types `force` or `--force-with-lease`. Prefer `--force-with-lease` over plain `--force`.
4. **Default merge strategy is squash.** Only switch if the user names a different strategy in this turn.
5. **Never skip CI** unless the user explicitly says so. If CI is failing or pending, surface the state and ask.
6. **Never delete branches** other than the just-merged source branch, and only after confirming the merge succeeded.
7. **Never commit** while inside this skill — committing is the resolve-skill's job. If there are uncommitted changes, refuse and tell the user.

## Prerequisites

Before starting, verify:

```bash
git status --porcelain                      # must be empty
git rev-parse --abbrev-ref HEAD             # source branch
git rev-parse --abbrev-ref origin/HEAD      # base branch (usually main)
gh --version                                # gh CLI present
gh auth status                              # authenticated
git remote -v | grep -i github              # repo lives on GitHub
```

If any of these fail, stop and tell the user what's missing.

## Workflow

### Step 1 — Establish Source and Base

- `<source>` = current branch (must not be `main`/`master`).
- `<base>` = `main` if it exists on the remote, else `master`, else ask.
- Fail loudly if `<source> == <base>` — there is nothing to PR.

### Step 2 — Run the Safety Check Script

```bash
bash <skill-dir>/scripts/pr_safety_check.sh <base>
```

This script runs read-only checks and prints a structured pre-flight report:

- Working tree clean
- Branch ahead of base by ≥1 commit
- No new files that look like secrets (`.env`, `*.pem`, `id_rsa`, `*.key`, `credentials.json`)
- No accidentally committed binaries >5 MB
- No conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) left in tracked files
- No `console.log` / `dd(` / `var_dump(` / `dump(` / `print_r(` in diff
- No `.only` / `.skip` / `xfail` left in test files
- Commits are signed off if the repo policy requires it (check `.github/CODEOWNERS` for hints)

If any check fails, surface the failure and ask the user whether to abort or proceed anyway.

### Step 3 — Push the Branch

If the branch is not on the remote, or local is ahead of remote:

```bash
git push -u origin <source>
```

If remote is ahead (someone else pushed) — stop and tell the user. Do **not** auto-pull/rebase here; that's the conflict-resolve skill's job.

### Step 4 — Compose PR Title and Body

Look at commits on the branch since the merge base:

```bash
git log --pretty=format:'%s%n%n%b' "$(git merge-base <source> origin/<base>)..HEAD"
```

Compose:

- **Title** — short, imperative, under 70 chars. If there's a single commit, reuse its subject. Otherwise summarize the theme.
- **Body** — three sections (omit any that don't apply):
  ```
  ## Summary
  - <1-3 bullets describing what changed and why>

  ## Changes
  - <key file groups touched>

  ## Test plan
  - [ ] <how to verify each change>
  ```

Show the proposed title and body to the user. Ask:
> "Open the PR with this title and body? (yes / edit / abort)"

If "edit", let the user dictate changes and re-show. If "abort", stop without pushing further state.

### Step 5 — Create the PR

```bash
gh pr create \
  --base <base> \
  --head <source> \
  --title "<title>" \
  --body "$(cat <<'EOF'
<body>
EOF
)"
```

Capture the returned PR URL and number for later steps.

If a PR already exists for `<source>` → `<base>`, skip creation and use the existing PR:
```bash
gh pr view --json number,url,state
```

### Step 6 — Review the Diff

Pull the diff and produce a structured review the user can scan in 30 seconds:

```bash
gh pr diff <number>
gh pr view <number> --json files,additions,deletions,commits,statusCheckRollup
```

Produce a single Markdown report with:

- File-count and lines-changed totals
- A list of files grouped by area (backend, frontend, db, tests, docs)
- Risk flags (re-using the severity heuristics from **git-conflict-review**)
- 3–8 bullets of "what changed" derived from the diff (not the commit messages)
- "Things to double-check before merging" — bullets surfaced from the safety check + diff scan

Do **not** auto-approve. Ask the user:
> "Diff review done. Approve and proceed to wait for CI? (yes / request changes / abort)"

### Step 7 — Wait for CI

```bash
gh pr checks <number> --watch --interval 30
```

If CI is **green** → continue.

If CI is **failing** → surface the failing job log:
```bash
gh run view <run-id> --log-failed
```
Then ask:
> "CI is failing on <job>. Investigate, retry, or abort? (do not merge with red CI unless the user explicitly overrides.)"

If CI is **not configured** → tell the user explicitly and ask whether to proceed without CI signal.

### Step 8 — Final Merge Approval

Before merging, fetch the PR's current state:
```bash
gh pr view <number> --json state,mergeable,mergeStateStatus,reviewDecision
```

Surface:
- `state` — should be `OPEN`
- `mergeable` — should be `MERGEABLE`
- `mergeStateStatus` — should be `CLEAN`
- `reviewDecision` — `APPROVED` / `REVIEW_REQUIRED` / `CHANGES_REQUESTED` / null

If `reviewDecision` is `CHANGES_REQUESTED` → refuse to merge. Ask the user to address comments first.

Ask the user explicitly:
> "Ready to squash-merge PR #<number> into `<base>` and delete the source branch `<source>`? (yes / no)"

Do not proceed without a clear "yes".

### Step 9 — Squash-Merge

```bash
gh pr merge <number> --squash --delete-branch
```

(Other strategies, only if the user names one: `--merge` for a true merge commit, `--rebase` for rebase-and-merge. Never substitute on your own.)

### Step 10 — Sync Local

After a successful merge:

```bash
git switch <base>
git pull --ff-only
git remote prune origin
git branch -d <source>      # safe-delete; refuses if local has unmerged work
```

Show the user:
- New tip of `<base>`
- Confirmation the source branch is gone locally and remotely
- The merged PR URL for their records

End with one sentence: "Merged PR #<n>; local `<base>` is up to date. Branch `<source>` has been deleted."

## Edge Cases

- **Detached HEAD**: Refuse, tell the user to switch to a named branch.
- **PR already merged**: If `gh pr view --json state` returns `MERGED`, tell the user, skip Steps 5–9, and just run Step 10 to sync local.
- **PR already closed without merge**: Ask whether to reopen or open a new PR.
- **Force-push needed mid-flow**: If the safety check finds a problem and the user fixes it by amending the last commit, prefer `git push --force-with-lease origin <source>` over `--force`. Require user approval.
- **No `gh` CLI installed**: Fall back to printing the PR URL the user can open manually (e.g. `https://github.com/<owner>/<repo>/compare/<base>...<source>`), and stop there — do not attempt to API-call directly.
- **Repo is not on GitHub**: This skill only supports GitHub. Tell the user.
- **`gh auth status` not authenticated**: Tell the user to run `gh auth login` and re-invoke.
- **Branch protection rejects squash-merge**: Surface the GitHub error verbatim, do not retry blindly.

## What This Skill Does NOT Do

- Does **not** resolve conflicts (→ git-conflict-resolve).
- Does **not** start a merge or rebase locally — only handles the PR side.
- Does **not** modify code or test files; if the safety check finds issues, it surfaces them and asks the user to fix.
- Does **not** add Co-Authored-By or signature trailers unless the user explicitly asks.
- Does **not** auto-approve reviews or dismiss other reviewers' change requests.
