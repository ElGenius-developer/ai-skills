#!/usr/bin/env python3
"""Prove a slimming lost nothing: every non-blank line of OLD must exist in NEW or in a detail file.

  check_no_loss.py OLD NEW DETAIL [DETAIL ...]    (DETAIL may be a file or a directory)
Exit 0 and 'missing: 0' on success; otherwise list the missing lines and exit 1.
"""
import os, sys

norm = lambda s: " ".join(s.split())


def lines(path):
    with open(path, encoding="utf-8") as f:
        return {norm(l) for l in f if l.strip()}


def expand(p):
    if os.path.isdir(p):
        return [os.path.join(r, f) for r, _, fs in os.walk(p) for f in fs if f.endswith(".md")]
    return [p]


if len(sys.argv) < 4:
    sys.exit(__doc__)
have = set()
for p in sys.argv[2:]:
    for f in expand(p):
        have |= lines(f)
missing = [l for l in open(sys.argv[1], encoding="utf-8") if l.strip() and norm(l) not in have]
for l in missing:
    print("MISSING:", l.rstrip()[:200])
print(f"missing: {len(missing)}")
sys.exit(1 if missing else 0)
