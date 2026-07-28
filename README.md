# ai-skills

[![skills.sh](https://skills.sh/b/ElGenius-developer/ai-skills)](https://skills.sh/ElGenius-developer/ai-skills)

A small, opinionated set of agent **skills** and **hooks** for day-to-day engineering work: shipping branches safely, resolving merge conflicts without surprises, writing sane T-SQL, and getting answers without the filler.

Every skill here is designed around one principle: **the agent proposes, the human approves.** Nothing merges, commits, pushes, or resolves a conflict without an explicit "yes".

```bash
npx skills add https://github.com/ElGenius-developer/ai-skills --skill '*'
```

Built for [Claude Code](https://claude.com/claude-code), and installable into ~70 other agents via the [`skills`](https://github.com/vercel-labs/skills) CLI.

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

### Skills — via `npx skills` (recommended)

These skills follow the standard `skills/<name>/SKILL.md` layout, so the [`skills`](https://github.com/vercel-labs/skills) CLI installs them directly — no clone needed. It supports Claude Code, Codex, Cursor, Antigravity, Cline, OpenCode, and ~70 other agents.

```bash
# See what's in here
npx skills add https://github.com/ElGenius-developer/ai-skills --list

# Install one
npx skills add https://github.com/ElGenius-developer/ai-skills --skill direct

# Install several
npx skills add https://github.com/ElGenius-developer/ai-skills --skill git-conflict-review --skill git-conflict-resolve --skill git-pr-merge

# Install everything
npx skills add https://github.com/ElGenius-developer/ai-skills --skill '*'
```

Useful flags: `-g` installs globally (`~/.claude/skills/`) instead of into the current project, `-a claude-code` targets a specific agent, `-y` skips prompts for CI.

### Skills — via `install.sh`

If you'd rather not depend on the CLI, the repo ships a plain installer that copies into `~/.claude/skills/`:

```bash
git clone https://github.com/ElGenius-developer/ai-skills.git
cd ai-skills
./install.sh                      # all skills
./install.sh direct git-pr-merge  # a subset
./install.sh --force              # overwrite existing
```

It refuses to clobber an existing skill of the same name unless you pass `--force`.

Or copy by hand — a skill is just a directory:

```bash
cp -R skills/direct ~/.claude/skills/
```

Either way, skills are auto-discovered. Claude Code picks them up on the next session; each skill's `description` frontmatter governs when it triggers.

> **Heads-up on `-g`.** Global install writes into `~/.claude/skills/`. If you also keep hand-edited copies of these skills there, pick one owner for that directory — either let the CLI manage it, or keep editing by hand. Doing both will silently overwrite your local edits on the next `update`.

### Updating and removing

```bash
npx skills list                  # what's installed
npx skills update                # pull latest for all installed skills
npx skills update direct         # just one
npx skills remove direct         # uninstall
```

The CLI records installs in `skills-lock.json` at your project root — commit it if you want the team on the same versions. If you installed with `install.sh` instead, updating is `git pull && ./install.sh --force`, and removing is `rm -rf ~/.claude/skills/<name>`.

### Hooks

Hooks are **not** installed by `npx skills` or by `install.sh` — that CLI installs skills only, and hooks change how your agent behaves globally, so wire them up deliberately.

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

Every hook fails open — if a dependency is missing or the command can't be read, it exits 0 and gets out of your way. `block-push-to-main.sh` blocks only when it can actually read the command and that command targets `main`.

Full per-hook detail — arguments, exit codes, and how to test each one — is in [`hooks/README.md`](hooks/README.md).

---

## Requirements

Skills are Markdown; they need nothing installed. The bundled **scripts** and **hooks** do:

| Component | Needs | Notes |
|---|---|---|
| `direct`, `sql-server-dba` | — | Pure Markdown instructions. |
| `git-conflict-review` script | `bash`, `git` | `git ≥ 2.38` for in-memory `merge-tree`; older git uses a throwaway-worktree fallback. |
| `git-conflict-resolve` | `bash`, `git` | No script — the agent drives `git` directly. |
| `git-pr-merge` script | `bash`, `git`, [`gh`](https://cli.github.com/) | `gh` must be authenticated (`gh auth login`). GitHub only. |
| `block-push-to-main.sh` | `bash`, `git`, `python3` | `python3` parses the hook's JSON stdin. |
| `pr-footprint.sh` | `bash`, `git`, `python3`, `gh` | Posts a PR comment; needs push/comment scope. |
| `proof-of-execution.sh` | `bash`, `jq` | `jq` reads the session transcript. |

Tested on macOS and Linux. Windows users should run these under WSL or Git Bash.

---

## Skill notes

### `git-conflict-review`

Uses `git merge-tree --write-tree` (git ≥ 2.38) to simulate the merge **in memory**. On older git it falls back to a merge inside a throwaway worktree that is destroyed on exit — your primary working tree is never touched.

Exit codes: `0` = no conflicts, `1` = conflicts found, `2` = error.

```bash
bash skills/git-conflict-review/scripts/detect_conflicts.sh <source-ref> <target-ref>
```

**Tuning:** the severity heuristics in `classify_severity()` are tuned for Laravel + TypeScript layouts (`*/Controllers/*`, `*/features/*`, `*.tsx`, …). If your repo looks different, edit that `case` block — it's the one part of this repo you're expected to customize.

### `git-conflict-resolve`

The only skill here with no script — it drives `git` directly, one conflict block at a time. For each block it shows the surrounding context, describes "ours" and "theirs" in a sentence each, proposes a resolution with reasoning, and then stops for an explicit choice: **Accept proposed / Keep ours / Keep theirs / Skip (edit manually)**.

It will not stage, commit, continue a rebase, or push without a separate approval at each step, and it never runs `--abort`, `reset --hard`, or `clean -fd` unless you say "abort".

[`references/resolution-patterns.md`](skills/git-conflict-resolve/references/resolution-patterns.md) carries ten worked patterns — import blocks, route registrations, lockfiles, i18n files, migrations, schema docs, generated API specs, whitespace-only diffs, conflict markers inside strings, and delete-modify — each with a default action and a note on when to escalate to a human instead.

Lockfiles and generated specs are always **regenerate, never hand-merge**.

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

## Troubleshooting

**A skill never triggers.** Triggering is driven entirely by the `description` in each `SKILL.md` frontmatter — these are written narrowly on purpose, so vague prompts won't fire the wrong skill. Either name the skill directly ("use git-conflict-review") or widen the `description` in your own copy. Also confirm it's actually installed: `npx skills list`.

**`detect_conflicts.sh` reports "Already merged"** — the source branch is an ancestor of the target, so there is genuinely nothing to merge. Check you didn't swap the argument order; it's `<source> <target>`, not the reverse.

**Everything lands as MEDIUM severity.** The `classify_severity()` globs didn't match your layout. Edit that `case` block — see the tuning note above.

**`pr_safety_check.sh` blocks on "gh CLI not authenticated"** — run `gh auth login`. The check is deliberately hard-fail because the later steps can't work without it.

**`proof-of-execution.sh` never fires.** It only enforces when the agent already uses the `[STATUS]:` convention; text without that marker passes through untouched. It also silently exits 0 if `jq` is missing or the transcript can't be read.

**`block-push-to-main.sh` blocks a push you actually want** (e.g. the initial push of a brand-new repo). Push a branch and open a PR, or temporarily unregister the hook — the script has no override flag by design.

---

## Verification status

Being explicit about what has and hasn't been exercised:

| Component | Status |
|---|---|
| `detect_conflicts.sh` | **Verified** — synthetic repo covering `content`, `add-add`, and `delete-modify` conflicts. Severity ranking, type detection, exit codes, and read-only guarantee all confirmed. |
| `pr_safety_check.sh` | **Verified** — BLOCK on `.env`, BLOCK on leftover conflict markers, PASS on a clean branch, warnings on debug prints and focused tests. |
| `block-push-to-main.sh` | **Verified** — blocks `origin main` and `HEAD:main`, allows feature branches and non-push commands. |
| `proof-of-execution.sh` | **Verified** — blocks a bare `[STATUS]: done` and an empty `[STDOUT]:` block; allows a real one and allows text with no claim. |
| `install.sh` | **Verified** — all/subset/`--force`/unknown-name/empty-name paths. |
| `git-conflict-resolve` | **Not yet exercised end-to-end.** It has no script, so its per-block approval loop has only been reviewed, not run against a real conflict. Treat it as the least battle-tested skill here. |
| `pr-footprint.sh` | **Not yet exercised** against a live PR. |

## Authorship

Written by [Ahmed Ashraf](https://github.com/ElGenius-developer), authored collaboratively with Claude Code and extracted from real day-to-day use.

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). If you adapt the severity heuristics for a different stack, that's a genuinely useful contribution.

## License

[MIT](LICENSE)
