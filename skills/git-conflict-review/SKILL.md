---
name: git-conflict-review
description: Read-only inspection of git branches to predict merge conflicts before they happen. Produces a structured report of files that would conflict, conflict type per file (content / rename-edit / delete-modify / add-add / binary), and a risk-ranked resolution order — without modifying the working tree, index, or creating any merge state. Use when the user asks to "check conflicts before merging", "preview merge conflicts", "see what will conflict", "audit a branch before PR", "is this safe to merge", or wants a dry-run conflict analysis between two branches. First step of the git-conflict-review → git-conflict-resolve → git-pr-merge workflow; safe to run standalone.
---

# Git Conflict Review

## Overview

Predicts merge conflicts between two branches **without touching the working tree**, then reports what would conflict, why, and in what order to resolve. This is a pure diagnostic step — no `git merge` is started, no index is written, no files are modified.

## When to Use

- "Check if my branch will conflict with main"
- "Preview merge conflicts"
- "Will rebasing onto main be painful?"
- "Audit branch X before opening a PR"
- Pre-flight for the **git-conflict-resolve** skill

## Core Rule — Read-Only

This skill **MUST NOT** modify state. Specifically:
- No `git merge`, `git rebase`, `git cherry-pick`, `git reset`, `git checkout <branch>`.
- No `git add`, `git commit`, `git push`.
- No edits to tracked files.
- Use `git merge-tree --write-tree` (git ≥ 2.38) to simulate the merge in-memory.

If the user wants to actually start resolving, hand off to **git-conflict-resolve**.

## Workflow

### Step 1 — Establish Branches

Resolve `<source>` (the branch being merged in, e.g. current feature branch) and `<target>` (the branch being merged into, usually `main`).

Defaults if user doesn't specify:
- `<source>` = current branch (`git rev-parse --abbrev-ref HEAD`)
- `<target>` = `main` if it exists, else `master`, else ask

Always **fetch first** so refs are current:
```bash
git fetch --all --prune
```

If the user is checking against a remote target (e.g. `origin/main`), use the remote ref — local `main` may be stale.

### Step 2 — Run the Detection Script

The script `scripts/detect_conflicts.sh` does everything in one read-only pass. Run it with the two refs:

```bash
bash <skill-dir>/scripts/detect_conflicts.sh <source> <target>
```

Output is a structured report on stdout. It uses `git merge-tree --write-tree --name-only --no-messages` and parses the conflicted-file list, then enriches each entry with conflict type and size hints.

If `git merge-tree --write-tree` is unavailable (git < 2.38), the script falls back to `git merge --no-commit --no-ff` **inside a temporary worktree** that is destroyed before exit — never in the user's primary working tree.

### Step 3 — Categorize Each Conflict

For every conflicting path, classify into one of:

| Type | Signal | Notes |
|------|--------|-------|
| `content` | Both sides modified overlapping hunks of a text file | Most common; usually safe to resolve manually |
| `rename-edit` | One side renamed, the other edited the original path | Verify the rename intent before resolving |
| `delete-modify` | One side deleted, the other modified | Decide if the file should still exist |
| `add-add` | Both sides added the same path with different content | Check if they should be merged or one wins |
| `mode-change` | File mode differs (e.g. exec bit) | Usually pick one and move on |
| `binary` | Conflicting binary file | Cannot auto-resolve; needs human choice |
| `submodule` | Submodule pointer disagreement | Resolve outside this skill |

### Step 4 — Rank Risk

Order the report by risk descending so the user sees the dangerous ones first:

1. **CRITICAL** — Schema/migration files (`*.sql`, `migrations/*`, `Database/`), CI config (`.github/`, `Dockerfile`), lockfiles (`package-lock.json`, `composer.lock`), env templates (`.env.example`).
2. **HIGH** — Backend models, controllers, services, routes, middleware.
3. **MEDIUM** — Frontend components, hooks, pages.
4. **LOW** — Tests, fixtures, generated files (OpenAPI specs, codegen output), translations, markdown docs.

Heuristics:
- Path matches `**/migrations/**` or `*.sql` → CRITICAL.
- Path matches `**/routes/**`, `**/Controllers/**`, `**/Models/**`, `**/Services/**` → HIGH.
- Path is a lockfile → flag as "regenerate, don't hand-edit".
- File >500 lines AND content conflict → bump severity one level.

### Step 5 — Output the Report

Print a single Markdown table the user can scan, plus a 1-line summary. Example shape:

```markdown
## Merge Conflict Preview: `feature-x` → `main`

**Summary:** 7 conflicting files (1 CRITICAL, 2 HIGH, 4 MEDIUM). Resolution est. ~30 min.

| # | Severity | File | Type | Lines |
|---|----------|------|------|-------|
| 1 | CRITICAL | database/migrations/2026_05_15_add_index.sql | content | 42 |
| 2 | HIGH | src/Http/Controllers/OrderController.php | content | 18 |
| 3 | HIGH | routes/api.php | content | 6 |
| 4 | MEDIUM | web/src/features/Order/hooks/useOrder.ts | content | 11 |
| 5 | MEDIUM | web/src/pages/admin/Orders.jsx | rename-edit | — |
| 6 | LOW | web/src/locales/en.json | content | 3 |
| 7 | LOW | tests/Feature/OrderTest.php | content | 8 |

**Recommended order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 (CRITICAL first, lockfiles/generated last).
**Next step:** Run the **git-conflict-resolve** skill to walk the user through each conflict with per-block approval.
```

### Step 6 — Confirm Clean Working Tree

Before suggesting the resolve step, verify:
```bash
git status --porcelain
```
Must be empty. If not, warn the user and recommend they stash or commit first.

## Output Contract

Every run produces:
1. A header with source/target branches and merge-base SHA.
2. A summary line: total conflicts, count by severity, estimated effort.
3. A ranked table.
4. A clear "Next step" pointer (resolve / no action needed / abandon merge).

If there are **zero conflicts**, say so explicitly and recommend proceeding directly to **git-pr-merge**.

## What This Skill Does NOT Do

- Does **not** resolve conflicts (→ git-conflict-resolve).
- Does **not** create PRs (→ git-pr-merge).
- Does **not** run tests.
- Does **not** push or fetch destructively.
- Does **not** decide whether to merge — it only reports what would happen.

## Edge Cases

- **Already merged**: If `git merge-base --is-ancestor <source> <target>` returns 0, the source is already in target. Report "Already merged, no action needed" and exit.
- **Diverged but no conflicts**: Trivial merge — note this and suggest skipping to PR.
- **Detached HEAD**: Refuse and ask the user to switch to a named branch.
- **Source ahead by 1 commit only**: Note that a fast-forward is possible if target's HEAD didn't advance.
- **Git < 2.38**: Use the temp-worktree fallback in the script. Never simulate on the primary worktree.
