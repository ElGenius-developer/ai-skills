# Hooks

Three [Claude Code hooks](https://docs.claude.com/en/docs/claude-code/hooks). Unlike the skills in this repo, hooks are **not** installed by `npx skills` or `install.sh` — they run on every matching tool call, so you wire them up yourself.

All three read the hook event as JSON on **stdin** and communicate through their **exit code**:

| Exit | Meaning |
|---|---|
| `0` | Allow — proceed normally |
| `2` | Block — the tool call is refused and stderr is shown to the agent |

Every hook here fails open: missing dependency, unreadable input, or an unexpected shape all result in exit 0. A hook that can't do its job gets out of the way rather than wedging your session.

## Setup

```bash
mkdir -p ~/.claude/hooks
cp hooks/*.sh ~/.claude/hooks/
chmod +x ~/.claude/hooks/*.sh
```

Then register in `~/.claude/settings.json` (all projects) or `.claude/settings.json` (one project) — see the JSON block in the [main README](../README.md#hooks). Register only the ones you want; they're independent.

---

## `block-push-to-main.sh`

**Event:** `PreToolUse`, matcher `Bash` · **Needs:** `bash`, `git`, `python3`

Refuses any `git push` that would land on `main`, so changes reach the default branch only through a reviewed PR.

Blocks:
- `git push origin main`
- `git push origin HEAD:main`
- `git push origin anything:main`
- a bare `git push` while the current branch is `main`

Allows everything else, including `git push -u origin my-feature`.

**No override flag** — that's deliberate. If you genuinely need a direct push (the first push of a brand-new repo, for instance), unregister the hook for that moment rather than teaching it a bypass. Guarding a differently-named default branch means editing the two `grep -E` patterns in the script.

```bash
# Test it
echo '{"tool_input":{"command":"git push origin main"}}' | ./block-push-to-main.sh   # exit 2
echo '{"tool_input":{"command":"git push -u origin feat"}}' | ./block-push-to-main.sh # exit 0
```

---

## `pr-footprint.sh`

**Event:** `PostToolUse`, matcher `Bash` · **Needs:** `bash`, `git`, `python3`, `gh`

After a successful `gh pr create`, posts one comment on the new PR with objective, git-derived numbers:

- lines added / removed / net
- files added / modified / deleted
- newly-added dependencies parsed out of `composer.json` and `package.json`

**It reports only what `git` can measure.** No "% bloat saved", no estimated baseline — a real PR has no counterfactual version to compare against, and inventing one would be dishonest. Qualitative reasoning about *why* each addition was necessary is left for you to write in the PR body under a `<!-- pr-footprint:ladder -->` marker.

Idempotent (it looks for its own `<!-- pr-footprint -->` marker and won't double-post), never blocks, and always exits 0 — offline, unauthenticated, or no-PR-found all just exit quietly.

To extend dependency detection to other ecosystems, add to the `DEP_KEYS` map in the embedded Python (e.g. `"Cargo.toml"`, `"go.mod"`).

---

## `proof-of-execution.sh`

**Event:** `Stop` · **Needs:** `bash`, `jq`

An anti-silent-failure gate. If the agent's final message claims `[STATUS]: done`, this hook requires a non-empty `[STDOUT]:` block above it containing real command output. Otherwise it blocks with instructions to either paste actual output or downgrade the claim to `implemented-pending-verification`.

It only enforces when the agent already uses the `[STATUS]:` convention — ordinary responses pass through untouched. For it to be useful you need a corresponding instruction in your `CLAUDE.md` telling the agent to use that format; the hook is the enforcement half of that contract, not the whole thing.

```bash
# Test it — fixture transcript is JSONL of assistant messages
printf '{"transcript_path":"/path/to/transcript.jsonl"}' | ./proof-of-execution.sh
```

A transcript whose last assistant message is `[STATUS]: done` with no `[STDOUT]:` exits 2; one with real output above the claim exits 0.
