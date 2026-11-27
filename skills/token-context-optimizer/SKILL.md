---
name: token-context-optimizer
description: Audit and shrink the tokens an AI coding session burns before the first prompt, and keep long sessions under a budget. Use whenever the user says "reduce tokens", "context too big", "session starts at 100k", "optimize context", "token budget", "why is my context so large", "slim CLAUDE.md", "too many skills/plugins loaded", "hit the weekly limit", or in Arabic "قلل التوكنز" / "الـ context كبير"; also when asked to run a context/token audit on an existing repo. Measures a baseline, installs context-budget hooks, inventories plugins/skills/agents by real usage, slims always-loaded files without losing text, routes review work to the right models, then re-measures. Do NOT use for writing application code or for ordinary prompt-writing questions.
---

# Token Context Optimizer

A fresh Claude Code session pays for everything that is always loaded: CLAUDE.md, MEMORY.md, global rules, skill/agent/plugin descriptions, SessionStart hook output. On a mature repo that was ~100k tokens before the first prompt; the method below got it to ~65k and capped runaway sessions. Every phase is measured, so claims come with numbers.

Scripts live in `scripts/` next to this file (`$SK` = this skill's directory). All are generic and take paths as arguments.

## Ground rules

- **Approval gates.** Nothing is disabled, archived, moved or rewritten until the user approves the inventory (Phase 2) and the slimming plan (Phase 3). Reading and measuring are always free.
- **Move text, never delete it.** Slimming relocates lines verbatim into detail files and proves it with `check_no_loss.py`.
- **Repo changes go through a branch or worktree plus a PR.** Never commit to the branch that is currently checked out. Global files (`~/.claude/...`) are edited in place only after approval, with a backup copied first.
- **Warn before touching tracked files.** `.claude/settings.local.json` is usually untracked; check `git ls-files --error-unmatch` and tell the user if it is tracked.
- Commits and PRs carry no AI attribution lines.

## Phase 0 - Baseline

1. Fresh-session size: `python3 $SK/scripts/measure_context.py fresh --cwd <repo>` (runs `claude -p "reply with ok"` and sums `input + cache_read + cache_creation` tokens; costs one tiny call).
2. Current-session size: `python3 $SK/scripts/measure_context.py transcript` (last assistant usage of the newest transcript for the current directory, or pass a JSONL path).
3. Record both numbers; they are the "before" column of the report.

## Phase 1 - Budget hooks (low risk, high value)

Run `bash $SK/scripts/install_budget_hooks.sh`. It copies three hooks from `assets/hooks/` into `~/.claude/hooks/` and merges them into `~/.claude/settings.json`: back up first, append never replace, skip entries already present, validate with `jq`. Test it first with `CLAUDE_HOME=<tmp> SETTINGS_FILE=<tmp copy>` if the user wants a dry run.

- `context-budget.sh` + `context_budget.py` (UserPromptSubmit): warns at 350k tokens, blocks at 450k with a ready handoff prompt (branch, PR, newest session file, next tracker item). A prompt starting with `!continue` passes once. Thresholds, session-file glob and tracker path are env-configurable (`CONTEXT_WARN_TOKENS`, `CONTEXT_BLOCK_TOKENS`, `HANDOFF_SESSIONS_GLOB`, `HANDOFF_TRACKER`); the tracker is auto-detected (`TRACKER.md`, `specs/`, `docs/`) when unset.
- `post-merge-handoff.sh` (PostToolUse Bash): after a `gh pr merge`, confirms with `gh pr view --json state` that the PR is really MERGED, then reminds: save session notes, update the tracker, write a handoff prompt.

## Phase 2 - Inventory (read-only) then WAIT

Run `python3 $SK/scripts/inventory.py --repo <repo>` (about 30-60s on big transcript histories). It lists skills (all dirs and plugins), user/project agents and plugins with real usage counts from the project's transcripts, plus duplicates (same skill in several dirs, same plugin from two marketplaces). Counts come from one `grep -o` pass over `~/.claude/projects/<project-dir>/*.jsonl`; never read transcripts whole.

Present: zero-use items, duplicates, and a recommendation per item. Counts are per project, so something unused here may matter elsewhere; say so. **Stop and wait for approval.** After approval:

- Skills: set `"<name>": "off"` under `skillOverrides` in the repo's `.claude/settings.local.json` (per-project, reversible).
- User agents: move unused ones to `~/.claude/agents-archive/` (not delete).
- Plugins: `claude plugin disable <id>`.
- Re-measure fresh (Phase 0 step 1) to see the effect.

## Phase 3 - Slim always-loaded files (plan, approve, then do it on a branch)

Show the line/token size of each file first, then propose:

| File | Target shape |
|---|---|
| Repo `CLAUDE.md` | Short index: the pre-work checklist, one line per critical rule, a "where the details live" table. Detail text moves verbatim to `docs/agents/*.md`. |
| `MEMORY.md` | Index of hub files (one line each) plus at most 6 must-see lines. Related notes consolidate into hubs. |
| `~/.claude/rules/**` | Each file <=10 lines of essentials; full text moves to `~/.claude/rules-reference/`. |
| SessionStart hooks | Cap output: newest N index entries, trackers capped by lines and line length, ending with "full file at <path>". |

Verify, do not trust:
- `python3 $SK/scripts/check_no_loss.py <old CLAUDE.md copy> CLAUDE.md docs/agents/` must print `missing: 0` (every non-blank old line exists in the new file or a detail file).
- `python3 $SK/scripts/check_memory_links.py <memory dir>` must report 0 broken links and 0 orphan notes.
- Re-run SessionStart hook scripts by hand and confirm output length.

## Phase 4 - Review routing and session discipline

Add these to the repo's CLAUDE.md (and any PR-review skill):

- In a PR-review skill, security review and code review run on Opus; test-quality, clean-code and project-rule checks run on Sonnet. Dispatch **every** lens through the Agent tool with an explicit `model`: an inline lens runs on the main model and defeats the routing. Multi-model debate only on request (it is the most expensive lens).
- One session per PR or issue. The main session is a lean orchestrator: it delegates reading and implementation to Sonnet subagents. Every Agent call sets `model` explicitly (Sonnet default; Opus for review, planning and genuinely hard tasks, with a one-line reason).

## Phase 5 - Ship and re-measure

1. Repo-side changes (CLAUDE.md, docs/agents, hooks) go on a branch/worktree and one docs PR.
2. After merge or checkout of the branch, run `measure_context.py fresh` again.
3. Report with this template:

```
| Measure                         | Before | After | Change |
|---------------------------------|--------|-------|--------|
| Fresh session context (tokens)  |        |       |        |
| CLAUDE.md lines                 |        |       |        |
| MEMORY.md lines                 |        |       |        |
| Global rules lines              |        |       |        |
| Skills enabled / plugins on     |        |       |        |
| SessionStart hook output (lines)|        |       |        |
```
Add: hooks installed (yes/skipped), items disabled/archived (names), no-loss and link checks (raw output), anything left open.

## Gotchas

- `usage` tokens in a transcript include the cached prefix; that is the number that fills the window, so sum all three fields.
- Skill/agent frontmatter is cached per session; model or description changes need a fresh session to show up in measurements.
- A skill present in `~/.claude/skills`, `~/.agents/skills` and a plugin is loaded more than once; dedupe by keeping one source.
