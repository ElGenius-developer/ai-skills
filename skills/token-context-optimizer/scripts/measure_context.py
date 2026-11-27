#!/usr/bin/env python3
"""Measure context size in tokens.

  measure_context.py transcript [PATH]   last assistant usage of a session JSONL
                                         (default: newest transcript of the current dir's project)
  measure_context.py fresh [--cwd DIR]   run `claude -p "reply with ok"` in DIR and sum usage
Prints one JSON object; context = input + cache_read + cache_creation tokens.
"""
import argparse, glob, json, os, subprocess, sys

KEYS = ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")


def total(u):
    return sum(u.get(k, 0) or 0 for k in KEYS)


def transcript(path):
    last = None
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                m = json.loads(line).get("message") or {}
            except ValueError:
                continue
            if m.get("role") == "assistant" and m.get("usage"):
                last = m["usage"]
    if last is None:
        sys.exit("no assistant usage found in " + path)
    return {"mode": "transcript", "path": path, "context_tokens": total(last), **{k: last.get(k, 0) for k in KEYS}}


def newest_transcript(cwd):
    d = os.path.expanduser("~/.claude/projects/" + os.path.realpath(cwd).replace("/", "-").replace(".", "-"))
    files = glob.glob(d + "/*.jsonl")
    if not files:
        sys.exit("no transcripts in " + d)
    return max(files, key=os.path.getmtime)


def fresh(cwd):
    r = subprocess.run(["claude", "-p", "reply with ok", "--output-format", "json"], cwd=cwd,
                       capture_output=True, text=True, timeout=300)
    try:
        u = json.loads(r.stdout)["usage"]
    except Exception:
        sys.exit("could not parse claude output: " + (r.stdout or r.stderr)[:300])
    return {"mode": "fresh", "cwd": os.path.realpath(cwd), "context_tokens": total(u), **{k: u.get(k, 0) for k in KEYS}}


p = argparse.ArgumentParser()
sub = p.add_subparsers(dest="mode", required=True)
t = sub.add_parser("transcript"); t.add_argument("path", nargs="?")
f = sub.add_parser("fresh"); f.add_argument("--cwd", default=".")
a = p.parse_args()
res = transcript(a.path or newest_transcript(".")) if a.mode == "transcript" else fresh(a.cwd)
print(json.dumps(res))
