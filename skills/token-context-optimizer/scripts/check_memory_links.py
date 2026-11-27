#!/usr/bin/env python3
"""Check that every markdown link in MEMORY.md resolves and every note file is reachable from it.

  check_memory_links.py MEMORY_DIR      (the folder holding MEMORY.md and the note files)
Exit 0 if there are no broken links and no orphan .md files.
"""
import os, re, sys

d = sys.argv[1] if len(sys.argv) > 1 else "."
text = open(os.path.join(d, "MEMORY.md"), encoding="utf-8").read()
LINK = r"\]\(([^)#\s]+\.md)\)"
links = re.findall(LINK, text)
broken = [l for l in links if not os.path.exists(os.path.join(d, l))]
reached, frontier = set(links), list(links)
while frontier:  # hubs may link to further notes
    p = os.path.join(d, frontier.pop())
    if os.path.exists(p):
        for l in re.findall(LINK, open(p, encoding="utf-8").read()):
            if l not in reached:
                reached.add(l)
                frontier.append(l)
orphans = sorted(f for f in os.listdir(d) if f.endswith(".md") and f != "MEMORY.md" and f not in reached)
for b in broken:
    print("BROKEN:", b)
for o in orphans:
    print("ORPHAN:", o)
print(f"links: {len(links)} broken: {len(broken)} orphans: {len(orphans)} index_lines: {len(text.splitlines())}")
sys.exit(1 if broken or orphans else 0)
