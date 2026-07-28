---
name: git-conflict-resolve
description: Interactively resolve git merge conflicts with mandatory per-conflict-block user approval before any change is staged or committed. Use when the user asks to "fix conflicts", "resolve merge conflicts", "help me merge X into Y", "solve the rebase conflicts", or is already mid-merge with conflict markers in files. NEVER auto-resolves and NEVER commits without explicit user confirmation — every conflict block is shown to the user with surrounding context, a proposed resolution, and the reasoning, requiring explicit Accept / Keep ours / Keep theirs / Manual choice. Second step of the git-conflict-review → git-conflict-resolve → git-pr-merge workflow; safe to run standalone if the user already started a merge.
---

# Git Conflict Resolve

## Overview

Walks the user through every conflict block in a merge or rebase, one at a time, with a proposed resolution and a mandatory approval prompt before staging anything. The skill never decides on its own. It never commits without the user saying "commit".

## When to Use

- "Resolve these merge conflicts"
- "Help me finish this merge / rebase"
- The repo is in a `MERGING` / `REBASING` state (`.git/MERGE_HEAD` or `.git/REBASE_HEAD` exists)
- After running the **git-conflict-review** skill and the user decided to proceed

## Non-Negotiable Rules

1. **One conflict block at a time.** Never bulk-resolve, never commit unseen changes.
2. **Always present the proposal first**, then wait for explicit user approval before writing.
3. **Never run `git checkout --ours/--theirs <file>` silently.** If the user picks a side, show what's being kept and discarded first.
4. **Never run `git merge --continue`, `git rebase --continue`, or `git commit` without an explicit user "yes / continue / commit".**
5. **Never run `git push`.** That's the **git-pr-merge** skill's job.
6. **If a build/test script exists, offer to run it** after resolution and before commit — do not skip silently.
7. **If at any point the user says "abort"**, run `git merge --abort` (or `git rebase --abort`) and confirm the working tree is clean again.

## Workflow

### Step 1 — Sanity Check the State

Before touching anything:

```bash
git status --porcelain=v2 --branch
git rev-parse --git-dir
```

Determine which of these the user is in:

| State | Signal | Continue command |
|-------|--------|------------------|
| Mid-merge | `.git/MERGE_HEAD` exists | `git merge --continue` |
| Mid-rebase | `.git/rebase-merge/` or `.git/rebase-apply/` exists | `git rebase --continue` |
| Mid-cherry-pick | `.git/CHERRY_PICK_HEAD` exists | `git cherry-pick --continue` |
| Clean, no merge | Neither exists | The user wants to **start** a merge — see Step 2 |

If clean but conflicts are expected, **first** ask which direction:
```
Merge <source> into <target>, or rebase <source> onto <target>?
```
Default to a merge (`git merge --no-ff --no-commit <source>`) unless the user prefers rebase. `--no-commit` is mandatory — never let git auto-commit a clean merge before the user has reviewed.

### Step 2 — Initiate the Merge (only if starting fresh)

```bash
git fetch --all --prune
git switch <target>
git pull --ff-only
git switch <source>
git merge --no-ff --no-commit <target>
# or
git rebase <target>
```

If git reports conflicts, proceed to Step 3. If clean, stop and tell the user there's nothing to resolve — they can commit directly (with their approval) or hand off to **git-pr-merge**.

### Step 3 — Enumerate the Conflicted Files

```bash
git diff --name-only --diff-filter=U
```

For each file, also note its rough conflict-block count:
```bash
grep -c '^<<<<<<<' <file>
```

Tell the user: "N files have conflicts, totalling M conflict blocks. I will walk you through one block at a time."

### Step 4 — For Each File, Walk Each Conflict Block

For every conflict block, follow this exact loop:

1. **Show the block in context** — read the file and print the conflict markers plus ~10 lines above and below.

2. **Describe each side in one sentence:**
   - `<<<<<<< HEAD` / `=======` → "Ours" — what's currently on the branch being merged into.
   - `=======` / `>>>>>>> <ref>` → "Theirs" — what's being merged in.

3. **Propose a resolution** with one short paragraph of reasoning. Pick from:
   - **Accept ours** (discard theirs) — when ours has the newer/correct logic.
   - **Accept theirs** (discard ours) — when theirs supersedes.
   - **Combine** — write the merged version explicitly.
   - **Need user judgment** — when both sides have legitimate intent and you can't tell which wins.

4. **Show the proposed final state of that block** (no markers, real code).

5. **Ask for approval via [AskUserQuestion](#approval-prompt-shape)** — see shape below. Wait. Never act until the user picks.

6. **Apply the chosen resolution** with the `Edit` tool — replace only the marked block. Do **not** stage yet.

7. **Move to the next block.** If the file has more conflict markers, repeat for the next block. Otherwise move to the next file.

### Step 5 — After Each File Is Clean

Once a file has no more `<<<<<<<` markers:

```bash
git diff --check <file>          # warns about trailing whitespace + leftover markers
grep -n '^<<<<<<<\|^=======\|^>>>>>>>' <file>   # belt-and-braces check
```

If clean, propose staging:
> "File `<path>` is fully resolved. Stage it? (yes / no)"

Only after approval:
```bash
git add <file>
```

### Step 6 — After All Files Are Resolved

Show a summary:
```bash
git status
git diff --cached --stat
```

Offer to run project verification before the commit. Detect by file presence:

| Detected | Suggest |
|----------|---------|
| `composer.json` + `phpunit.xml` | `php artisan test --filter=...` or full suite |
| `package.json` with `test` script | `npm run test:ci` or `npm run lint` |
| `Cargo.toml` | `cargo test --no-run` then `cargo test` |
| `go.mod` | `go build ./...` then `go test ./...` |

Run only what the user approves. If something fails, surface the failure verbatim and ask the user how to proceed — do **not** silently re-edit.

### Step 7 — Compose the Commit Message and Commit

Suggest a commit message body. For a merge:
```
Merge branch '<source>' into <target>

- Resolved N conflicts across M files
- Key decisions: <one-line summary of non-trivial choices>
```

For a rebase, no explicit commit is needed — just `git rebase --continue` (each commit is replayed).

Show the proposed message and ask for approval. After explicit user "yes":

```bash
# Merge
git commit -m "$(cat <<'EOF'
<message>
EOF
)"

# Rebase
git rebase --continue
```

**Never** add Co-Authored-By trailers or any signature unless the user explicitly asks.

### Step 8 — Verify Cleanliness and Hand Off

```bash
git status
git log --oneline -5
```

Confirm:
- Working tree clean
- No merge/rebase state files left in `.git/`
- The latest commit is the expected merge commit (or rebased tip)

Tell the user:
> "Resolved and committed locally. Next step: run the **git-pr-merge** skill to push, open a PR, review it, and squash-merge."

## Approval Prompt Shape

Use the `AskUserQuestion` tool. Standard four options:

```
Question: How should we resolve this conflict in <file> at line <N>?
Header:   Conflict <i>/<total>
Options:
 1. Accept proposed (combined)  — Use the merged version I just showed.
 2. Keep ours                   — Discard the incoming changes for this block.
 3. Keep theirs                 — Discard our changes for this block.
 4. Skip — I'll edit manually   — Pause so the user can edit the file directly.
```

If the user picks "Skip", wait for the user to confirm they've edited the file before re-checking the block.

## What This Skill Does NOT Do

- Does **not** start a merge without the user's explicit choice of source/target.
- Does **not** stage, commit, or push without per-step user approval.
- Does **not** run `--abort`, `reset --hard`, `clean -fd`, or any destructive recovery unless the user types "abort".
- Does **not** decide whether the merge was a good idea — escalates philosophical questions back to the user.
- Does **not** open the PR (→ git-pr-merge).

## Edge Cases

- **Binary conflicts**: `Edit` tool cannot fix these. Offer Keep ours / Keep theirs explicitly via `git checkout --ours <file>` or `--theirs <file>` and require approval before running.
- **Delete-modify**: Ask the user whether the file should still exist. If keep → use `git add <file>`. If delete → use `git rm <file>`.
- **Renamed files**: If git tracks a rename and the other side modified the old path, present the rename context and ask whether to apply changes to the new path.
- **Generated files (lockfiles, OpenAPI specs, codegen output)**: Recommend regenerating instead of hand-editing. Show the regenerate command (`composer update --lock`, `npm install`, the project's codegen script, etc.) and require approval.
- **Submodules**: Outside scope. Tell the user to handle submodule pointer manually.

## Resources

See [references/resolution-patterns.md](references/resolution-patterns.md) for concrete worked examples of common conflict shapes (import-block conflicts, route conflicts, lockfile conflicts, translation-file conflicts).
