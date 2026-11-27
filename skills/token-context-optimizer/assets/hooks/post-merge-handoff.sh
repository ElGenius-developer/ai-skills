#!/bin/bash
exec python3 -I -c '
import json, re, subprocess, sys
try:
    d = json.load(sys.stdin)
    cmd = (d.get("tool_input") or {}).get("command", "")
    r = d.get("tool_response")
    if "gh pr merge" not in cmd:
        sys.exit(0)
    if isinstance(r, dict) and (r.get("interrupted") or r.get("is_error")):
        sys.exit(0)
    # tool_response carries no exit code, so ask GitHub whether the PR is really merged
    m = re.search(r"gh pr merge\s+(?:\S+\s+)*?(\d+)\b", cmd)
    args = ["gh", "pr", "view"] + ([m.group(1)] if m else []) + ["--json", "state", "-q", ".state"]
    out = subprocess.run(args, cwd=d.get("cwd") or None, capture_output=True, text=True, timeout=4).stdout.strip()
    if out != "MERGED":
        sys.exit(0)
except Exception:
    sys.exit(0)
msg = "PR merged. Now: save the session notes, update the project tracker (move the item to done, set the next one), then write the handoff prompt for the next item so the user can /clear and start a fresh session."
print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": msg}}))
'
