# Review Report Template

Write the report to the report path (default `.claude/PRPs/reviews/pr-<N>-review.md`).
Sections in this order; omit a severity heading only if a lens ran and found nothing
(state "None."). Never omit the Validation table.

```markdown
# PR Review: #<N> — <PR title>

**Reviewed**: <date>
**Author**: <author>
**Branch**: <head> → <base>
**Decision**: APPROVE | APPROVE (with comments) | BLOCK

## Summary

3–6 sentences: what the PR does, the overall risk picture, finding counts
(x CRITICAL / y HIGH / z MEDIUM / w LOW), and whether anything blocks.

## Findings

### CRITICAL
None. | 1. **<title>** — `file:line`. <defect>. <failure scenario>. <fix direction>.

### HIGH
...

### MEDIUM
...

### LOW
...

## Lens results

- **security**: <one-line verdict + what was checked>. PASS/FAIL.
- **code review**: ...
- **clean code**: ...
- **test quality**: ... (or "not run — no test changes")
- **project gates**: ... (or "no project layer")
- **secret scan**: ...

## Validation Results

| Check | Result |
|---|---|
| Formatter/linter (<n> files) | Pass/Fail |
| <PR's own tests> | Pass — N passed (M assertions) |
| <Affected suite> | Pass — ... |
| CI checks (`gh pr checks`) | All green / <detail> |
| Mergeable / conflicts | Clean / <detail> |

## Files Reviewed

- `path/one.ext` — Added/Modified/Deleted
- ...
```

Rules:

- Every finding cites a real `file:line` from the PR head, not the diff hunk offset.
- Validation rows paste the substance of real command output (counts, not "ok").
- The Decision line must be consistent with the severity policy: any open
  CRITICAL/HIGH ⇒ BLOCK.
