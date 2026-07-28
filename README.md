# ai-skills

A small, opinionated set of [Claude Code](https://claude.com/claude-code) **skills** and **hooks** for day-to-day engineering work: shipping branches safely, resolving merge conflicts without surprises, writing sane T-SQL, and getting answers without the filler.

Every skill here is designed around one principle: **the agent proposes, the human approves.** Nothing merges, commits, pushes, or resolves a conflict without an explicit "yes".

---

## What's inside

### Skills

| Skill | What it does |
|---|---|
| [`direct`](skills/direct) | A persistent terse-communication mode. Strips greetings, hedging, filler, and self-narration while keeping every technical fact intact. Mirrors the user's language. |
| [`git-conflict-review`](skills/git-conflict-review) | Predicts merge conflicts between two branches **without touching the working tree**. Reports each conflicting file, its conflict type, and a risk-ranked resolution order. |
| [`git-conflict-resolve`](skills/git-conflict-resolve) | Walks every conflict block one at a time with a proposed resolution and a mandatory approval prompt. Never auto-resolves, never commits unasked. |
| [`git-pr-merge`](skills/git-pr-merge) | Takes a clean branch from "ready" to "merged": push → open PR → structured diff review → wait for CI → squash-merge, with an approval gate at every state change. |
| [`sql-server-dba`](skills/sql-server-dba) | SQL Server / T-SQL assistant: query optimization, stored-procedure patterns, index design, security review, and DMV-based performance troubleshooting. |

The three `git-*` skills form a pipeline — **review → resolve → merge** — but each works standalone.

```
git-conflict-review  →  git-conflict-resolve  →  git-pr-merge
   (read-only)            (per-block approval)     (PR + squash-merge)
```

### Hooks

| Hook | Event | What it does |
|---|---|---|
| [`block-push-to-main.sh`](hooks/block-push-to-main.sh) | `PreToolUse(Bash)` | Blocks any `git push` that would land on `main` — including a bare `git push` while standing on `main`. Forces changes through a reviewed PR. |
| [`pr-footprint.sh`](hooks/pr-footprint.sh) | `PostToolUse(Bash)` | After `gh pr create`, posts a "PR Footprint" comment with objective git-derived counts (lines, files, new dependencies). Never invents a baseline or a "% saved" figure. |
| [`proof-of-execution.sh`](hooks/proof-of-execution.sh) | `Stop` | Blocks an agent from claiming `[STATUS]: done` unless it pasted real command output in a `[STDOUT]:` block. An anti-silent-failure gate. |

---

## Install

### Skills

```bash
git clone https://github.com/ElGenius-developer/ai-skills.git
cd ai-skills
./install.sh
```

`install.sh` copies each skill into `~/.claude/skills/`. It refuses to clobber an existing skill of the same name unless you pass `--force`.

Install a subset:

```bash
./install.sh direct git-pr-merge
```

Or copy by hand — a skill is just a directory:

```bash
cp -R skills/direct ~/.claude/skills/
```

Skills are auto-discovered. Claude Code picks them up on the next session; each skill's `description` frontmatter governs when it triggers.

### Hooks

Hooks are **not** installed by `install.sh` — they change how your agent behaves globally, so wire them up deliberately.

Copy the ones you want somewhere stable, then reference them from `~/.claude/settings.json` (global) or `.claude/settings.json` (per project):

```jsonc
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "$HOME/.claude/hooks/block-push-to-main.sh" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "$HOME/.claude/hooks/pr-footprint.sh" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "$HOME/.claude/hooks/proof-of-execution.sh" }
        ]
      }
    ]
  }
}
```

Make them executable: `chmod +x ~/.claude/hooks/*.sh`

**Requirements:** `bash`, `git`, `python3`. `pr-footprint.sh` also needs the [`gh`](https://cli.github.com/) CLI; `proof-of-execution.sh` needs `jq`. Every hook fails open — if a dependency is missing or the command can't be read, it exits 0 and gets out of your way. `block-push-to-main.sh` blocks only when it can actually read the command and that command targets `main`.

---

## Skill notes

### `git-conflict-review`

Uses `git merge-tree --write-tree` (git ≥ 2.38) to simulate the merge **in memory**. On older git it falls back to a merge inside a throwaway worktree that is destroyed on exit — your primary working tree is never touched.

Exit codes: `0` = no conflicts, `1` = conflicts found, `2` = error.

```bash
bash skills/git-conflict-review/scripts/detect_conflicts.sh <source-ref> <target-ref>
```

**Tuning:** the severity heuristics in `classify_severity()` are tuned for Laravel + TypeScript layouts (`*/Controllers/*`, `*/features/*`, `*.tsx`, …). If your repo looks different, edit that `case` block — it's the one part of this repo you're expected to customize.

### `git-pr-merge`

The pre-flight script is independently useful:

```bash
bash skills/git-pr-merge/scripts/pr_safety_check.sh main
```

Nine read-only checks: clean tree, ≥1 commit ahead, no leftover conflict markers, no secret-shaped files (`.env`, `*.pem`, `id_rsa`, …), no binaries >5 MB, no debug prints, no focused/skipped tests, remote-tracking state, and `gh` auth. Exits `1` and prints **BLOCK** if anything hard-fails.

Squash-merge is the default and only changes if you name a different strategy in the same turn.

### `sql-server-dba`

Primary target is SQL Server via the `sqlsrv` driver, including Laravel/Eloquent queries that land on it. MySQL/PostgreSQL equivalents live in [`references/cross-db.md`](skills/sql-server-dba/references/cross-db.md); DMV-based performance investigation lives in [`references/performance-dmvs.md`](skills/sql-server-dba/references/performance-dmvs.md).

Examples use a generic `Orders` / `Customers` / `OrderLines` schema with a `Tenant_ID` column, since multi-tenant scoping is where most SQL review findings actually come from.

### `direct`

Turn it on with "be direct", "/direct", "اختصر", or any phrasing asking for brevity. It stays on until you say "stop" / "normal mode" / "ارجع عادي".

It deliberately **relaxes** for destructive actions, security guidance, ordered multi-step sequences, and genuine explanations — terseness that creates ambiguity is a failure, not a win.

---

## Design conventions

Shared rules across these skills, in case you fork or extend them:

- **Approval gates on every state change.** Staging, committing, merging, and pushing each require an explicit user "yes".
- **Read-only steps stay read-only.** Diagnosis never mutates the working tree, index, or refs.
- **Fail loudly, never silently.** Surface the real error verbatim; don't retry blindly or paper over a failure.
- **No unrequested signatures.** Skills never add `Co-Authored-By` or similar trailers unless asked.
- **Measure, don't estimate.** Reported numbers come from `git`, never from a guessed baseline.

---

## Authorship

Written by [Ahmed Ashraf](https://github.com/ElGenius-developer), authored collaboratively with Claude Code and extracted from real day-to-day use. The git-workflow scripts have been smoke-tested against synthetic repos covering content, `add-add`, and `delete-modify` conflicts, plus the block/pass paths of the PR safety check.

Issues and PRs welcome. If you adapt the severity heuristics for a different stack, that's a genuinely useful contribution.

## License

[MIT](LICENSE)
