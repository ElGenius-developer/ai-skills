import glob, json, os, re, subprocess, sys

WARN = int(os.environ.get("CONTEXT_WARN_TOKENS", 350_000))
BLOCK = int(os.environ.get("CONTEXT_BLOCK_TOKENS", 450_000))
SESSIONS_GLOB = os.environ.get("HANDOFF_SESSIONS_GLOB", ".claude/sessions/20*.md")
TRACKER = os.environ.get("HANDOFF_TRACKER", "")  # empty = auto-detect


def last_usage(path):
    with open(path, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        chunk = 1 << 20
        while True:
            start = max(0, size - chunk)
            f.seek(start)
            lines = f.read(size - start).split(b"\n")
            if start:
                lines = lines[1:]  # first line may be cut mid-record
            for raw in reversed(lines):
                try:
                    msg = json.loads(raw).get("message") or {}
                except ValueError:
                    continue
                u = msg.get("usage")
                if msg.get("role") == "assistant" and u:
                    return sum(u.get(k, 0) or 0 for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
            if start == 0:
                return None
            chunk *= 4


def run(cmd, cwd, t=4):
    try:
        return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=t).stdout.strip()
    except Exception:
        return ""


def find_tracker(cwd):
    if TRACKER:
        return os.path.join(cwd, TRACKER)
    for rel in ("TRACKER.md", "specs/TRACKER.md", "docs/TRACKER.md", "TODO.md", "ROADMAP.md"):
        if os.path.exists(os.path.join(cwd, rel)):
            return os.path.join(cwd, rel)
    return None


def next_item(path):
    text = open(path, encoding="utf-8").read()
    sec = re.split(r"^#+\s*Next.*$", text, flags=re.M | re.I)[1].split("\n#")[0]
    for line in sec.splitlines():
        if re.match(r"\s*\|\s*#?\d+\s*\|", line):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            return f"{cells[0]} {cells[1][:160]}"
        if re.match(r"\s*([-*]|\d+\.)\s+\S", line):
            return re.sub(r"^\s*([-*]|\d+\.)\s+", "", line)[:160]
    return None


def handoff(cwd):
    out = ["Handoff prompt:"]
    branch = run(["git", "-C", cwd, "branch", "--show-current"], cwd)
    if branch:
        out.append(f"- Branch: {branch}")
    try:
        pr = json.loads(run(["gh", "pr", "view", "--json", "number,url,title"], cwd))
        out.append(f"- PR: #{pr['number']} {pr['title']} {pr['url']}")
    except Exception:
        pass
    files = glob.glob(os.path.join(cwd, SESSIONS_GLOB))
    if files:
        out.append(f"- Latest session file: {max(files, key=os.path.getmtime)}")
    try:
        item = next_item(find_tracker(cwd))
        if item:
            out.append(f"- Next item: {item}")
    except Exception:
        pass
    out.append("Read the session file above (if any), then continue with the next item.")
    return "\n".join(out)


def main():
    try:
        d = json.load(sys.stdin)
        if d.get("prompt", "").lstrip().startswith("!continue"):
            return
        n = last_usage(d["transcript_path"])
    except Exception:
        return
    if n is None or n < WARN:
        return
    if n < BLOCK:
        msg = (f"Context is at {n} tokens. Finish the current step only, then save the session notes and write a "
               "handoff prompt for a fresh session. Do not start new work items.")
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": msg}}))
        return
    reason = (f"Context {n} tokens >= {BLOCK} - start a fresh session (/clear) with the prompt below. "
              "Prefix a prompt with !continue to pass once.\n\n" + handoff(d.get("cwd") or os.getcwd()))
    print(json.dumps({"decision": "block", "reason": reason}))


main()
