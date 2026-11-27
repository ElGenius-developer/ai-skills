#!/usr/bin/env python3
"""Read-only inventory of skills, agents and plugins with real usage counts and duplicates.

  inventory.py [--repo DIR]
Usage counts come from grepping the project's transcripts (never read whole).
"""
import argparse, collections, glob, json, os, subprocess

H = os.path.expanduser("~")
ap = argparse.ArgumentParser()
ap.add_argument("--repo", default=".")
repo = os.path.realpath(ap.parse_args().repo)
tdir = f"{H}/.claude/projects/" + repo.replace("/", "-").replace(".", "-")


def tally(key):
    files = glob.glob(tdir + "/*.jsonl")
    if not files:
        return collections.Counter()
    r = subprocess.run(["grep", "-hoE", f'"{key}":"[^"]+"'] + files, capture_output=True, text=True)
    return collections.Counter(l.split('":"', 1)[1][:-1] for l in r.stdout.splitlines())


skill_uses, agent_uses = tally("skill"), tally("subagent_type")


skills = collections.defaultdict(list)
for d in (f"{H}/.claude/skills/*", f"{repo}/.claude/skills/*", f"{H}/.agents/skills/*", f"{H}/.gemini/skills/*"):
    for p in glob.glob(d + "/SKILL.md"):
        skills[os.path.basename(os.path.dirname(p))].append(os.path.realpath(p))
for p in glob.glob(f"{H}/.claude/plugins/cache/*/*/*/skills/*/SKILL.md"):
    plugin = p.split("/plugins/cache/")[1].split("/")[1]
    skills[f"{plugin}:{os.path.basename(os.path.dirname(p))}"].append(p)

print("## Skills (name | copies | uses in this project)")
for n in sorted(skills):
    uses = skill_uses[n] + (skill_uses[n.split(":")[-1]] if ":" in n else 0)
    print(f"{n} | {len(set(skills[n]))} | {uses}")

agents = set()
for d in (f"{H}/.claude/agents", f"{repo}/.claude/agents"):
    agents |= {os.path.basename(p)[:-3] for p in glob.glob(d + "/*.md")}
print("\n## User/project agents (name | uses)")
for n in sorted(agents):
    print(f"{n} | {agent_uses[n]}")

enabled = {}
try:
    enabled = json.load(open(f"{H}/.claude/settings.json")).get("enabledPlugins", {})
except Exception:
    pass
inst = {}
try:
    inst = json.load(open(f"{H}/.claude/plugins/installed_plugins.json")).get("plugins", {})
except Exception:
    pass
by_name = collections.defaultdict(list)
print("\n## Plugins (id | scope | enabled)")
for pid, entries in inst.items():
    by_name[pid.split("@")[0]].append(pid)
    for e in entries:
        print(f"{pid} | {e.get('scope')} | {enabled.get(pid, 'n/a')}")

print("\n## Duplicates")
dup = False
for n, ps in sorted(skills.items()):
    if len(set(ps)) > 1 and ":" not in n:
        dup = True
        print(f"skill '{n}' in {len(set(ps))} dirs: " + ", ".join(sorted(set(ps))))
for n, ids in sorted(by_name.items()):
    if len(ids) > 1:
        dup = True
        print(f"plugin '{n}' installed from several marketplaces: {', '.join(ids)}")
if not dup:
    print("none")
