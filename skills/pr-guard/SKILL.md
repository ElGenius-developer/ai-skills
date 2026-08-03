---
name: pr-guard
description: Full PR review-and-merge gate - orchestrates security review, code review, clean-code and test-quality lenses, runs the tests for real, checks CI/conflicts, then merges ONLY after explicit user approval in the same session. CRITICAL/HIGH findings block the merge automatically. Use when the user asks to "review and merge a PR", "review PR #N", "ship this PR", "راجع الـ PR وادمجه", or wants a gated merge with a written review report. NOT for reviewing local uncommitted changes (use a plain code review) or for creating a PR from scratch.
---

# PR Guard — Review + Permission-Gated Merge

Review a GitHub PR through parallel quality lenses, verify by actually running the
project's tests, write a persistent review report, and merge **only** after the user
explicitly approves in the same session. Never auto-merge. Never merge with open
CRITICAL or HIGH findings.

## Non-negotiable rules

1. **No merge without an explicit user "yes" given in this session**, after the
   verdict was presented. Prior instructions like "review and merge it" authorize the
   *workflow*, not the merge itself — still ask at the gate.
2. **CRITICAL or HIGH findings block the merge path entirely.** Do not offer the
   merge option; offer to fix instead.
3. **Never push to the base branch directly.** The only write to the base branch is
   the merge performed through the PR (`gh pr merge`).
4. **Report what actually ran.** Test results are pasted from real command output.
   If a step was skipped, the report says so and why.

## Phase 0 — Intake

1. Resolve the PR: from the argument (number or URL), or the current branch's PR via
   `gh pr view --json number,title,baseRefName,headRefName,mergeable,url`.
2. Fetch the diff (`gh pr diff <N>`) and the file list (`gh pr view <N> --json files`).
3. Check out the head branch locally (`gh pr checkout <N>`) — required for Phase 3.
4. Classify the diff:
   - **Production code** vs **test code** vs **config/docs** — decides which lenses run.
   - **Security-sensitive?** auth/session code, input handling, DB queries, file
     operations, crypto, payments, secrets/credential handling, new endpoints.
5. Load the **project layer** if one exists (see "Project layer" below).

## Phase 1 — Review lenses

Run the applicable lenses. Prefer parallel subagents (one per lens) when the Agent
tool is available; otherwise run them sequentially in-context. Each lens receives the
diff plus enough surrounding file context to judge it — reviewing the raw diff alone
is not acceptable for correctness claims.

| Lens | When | How |
|---|---|---|
| Security | Always; deep pass if security-sensitive | Use an installed security skill (`owasp-security`, `security-review`, …) if present; else the security section of [references/review-lenses.md](references/review-lenses.md) |
| Code review | Production code changed | Dedicated reviewer agent if available; else the code-review section of review-lenses.md |
| Clean code | Production code changed | `clean-code-guard` skill if installed; else the clean-code section of review-lenses.md |
| Test quality | Diff contains test files | `test-guard` skill if installed; else the test-quality section of review-lenses.md |
| Secret scan | Always | Grep the diff with the patterns in review-lenses.md §Secrets |

Every finding records: severity, `file:line`, one-sentence defect statement, and a
concrete failure scenario (inputs/state → wrong outcome). Findings without a failure
scenario get downgraded or dropped — no vague "consider improving X".

**Severity policy**

| Severity | Meaning | Effect on merge |
|---|---|---|
| CRITICAL | Security vulnerability, data loss/corruption path | Blocks — fix required |
| HIGH | Real bug or broken contract a user will hit | Blocks — fix required |
| MEDIUM | Maintainability / operational concern | Merge allowed; listed as follow-ups |
| LOW | Style, minor suggestion | Merge allowed |

## Phase 2 — Project gates (extension point)

If the repository defines a project layer, run its gates now as an additional lens.
A project layer is discovered in this order:

1. A project skill whose SKILL.md declares it wraps `pr-guard` (e.g. `dc-pr-guard`
   in `.claude/skills/`) — follow its gates and parameter overrides.
2. A checklist in the repo's agent instructions (CLAUDE.md / AGENTS.md) that gates
   merges (architecture rules, mandated patterns, forbidden constructs).

Project-gate violations are scored with the same severity table. A project layer may
also override: test commands, report path, merge style, reviewer models.

## Phase 3 — Verification (proof of execution, not reading)

Run for real, paste real output into the report:

1. **Formatter/linter** on the changed files, using the project's own entrypoint.
2. **The PR's own tests**, then the **affected suite** (the test directory/module
   covering the changed area). Full-repo suite only if the project layer demands it.
3. **CI status**: `gh pr checks <N>` — all required checks green, or the failure is
   explained and accepted by the user.
4. **Mergeability**: `mergeable` is clean, no conflicts, branch not stale against
   base (behind-by is acceptable only if CI ran on a current-enough merge commit —
   when in doubt, say so in the report).

Any red result here is treated as a HIGH finding (blocks) until resolved or the user
explicitly waives it.

## Phase 4 — Report

Write the review to a persistent file — default `.claude/PRPs/reviews/pr-<N>-review.md`
(create the directory if missing; project layer may override the path). Follow
[references/report-template.md](references/report-template.md): Summary, Findings by
severity with file:line + failure scenario, per-lens results, validation table with
real outputs, files reviewed, Decision (APPROVE / APPROVE-WITH-COMMENTS / BLOCK).

## Phase 5 — Merge gate

1. **If any CRITICAL/HIGH is open** → present the findings and stop. Offer to fix
   them on the PR branch; after fixes, re-run the affected lenses and Phase 3.
2. **Otherwise** → present a compact verdict (decision, finding counts, test results,
   CI state) and ask for explicit approval to merge. Use AskUserQuestion when
   available; the merge option must name the PR and the merge style.
3. **On explicit approval only**:
   - **Stacked-PR check first**: `gh pr list --base <headRefName>` — if any open PR
     targets this PR's branch, merge **without** `--delete-branch` (deleting a
     mid-chain branch retargets/closes the stacked PRs).
   - Merge: `gh pr merge <N> --squash` (project layer may override style). Add
     `--delete-branch` only when the stacked-PR check came back empty.
   - Confirm the result: report the merge commit SHA on the base branch.
4. **On decline** → leave the PR open, report where the review artifact lives.

## Project layer authoring (for wrapper skills)

A project wrapper skill should stay thin: declare "Follow the generic `pr-guard`
workflow" and then list only deltas — extra gates (with severities), test/lint
commands, report path, merge style, reviewer-agent/model preferences. Do not
duplicate the phase logic; it lives here.
