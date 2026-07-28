# Contributing

Issues and PRs welcome.

## Adding or changing a skill

A skill is a directory under `skills/` containing a `SKILL.md` with YAML frontmatter:

```markdown
---
name: my-skill
description: One paragraph covering what it does AND the phrases that should trigger it.
---

# My Skill

...instructions for the agent...
```

`name` must match the directory name. `description` is the whole trigger mechanism — an agent decides whether to load a skill from that text alone, so name the concrete phrases a user would actually say. Keep it narrow: an over-broad description fires on the wrong prompts, which is worse than not firing at all.

Optional subdirectories: `scripts/` for executables, `references/` for detail the agent loads only when needed. Keep `SKILL.md` focused and push depth into `references/` — it's read into context every time the skill fires.

## House rules

These are what the existing skills are built around; PRs that break them will get pushback:

- **Approval gates on every state change.** Staging, committing, merging, pushing — each needs an explicit user "yes".
- **Read-only means read-only.** A diagnostic step must not touch the working tree, index, or refs.
- **Fail loudly.** Surface the real error verbatim; don't retry blindly or swallow it.
- **Measure, don't estimate.** Report numbers a tool actually produced, never a guessed baseline.
- **No unrequested signatures** in commits or PR bodies.

## Before opening a PR

- Run `bash -n` on any shell script you touched.
- Actually exercise new script paths — build a throwaway git repo and run against it. The `Verification status` table in the README says what's been exercised; if you add to it, add your row.
- No project-specific content: no real table names, internal paths, company names, hostnames, or absolute `/Users/...` paths. Examples use a generic `Orders` / `Customers` schema.
- Update the README table if you add a skill or hook.

## Reporting a problem

Include your OS, `git --version`, the skill or hook involved, and the exact command plus its full output. For a misfiring conflict report, a minimal repro repo helps enormously.
