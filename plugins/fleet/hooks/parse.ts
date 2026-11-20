const RELAY = /([a-z]+)-delegate\/scripts\/relay\.mjs/

function flag(command: string, name: string): string | null {
  const m = command.match(new RegExp(`--${name}[ =](?:"([^"]+)"|'([^']+)'|(\\S+))`))
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null
}

export function relayLaunch(command: string): { lane: string; cd: string | null; outDir: string | null } | null {
  const m = command.match(RELAY)
  if (!m || !command.includes('--brief')) return null
  return { lane: m[1]!, cd: flag(command, 'cd'), outDir: flag(command, 'out-dir') }
}

export type DirEntry = { name: string; kind: string; mtimeMs: number }

/** A relay makes its folder within a second of launch; one with none after this never started. */
export const NEVER_STARTED_MS = 30_000
const CLOCK_SKEW_MS = 2_000

/** When the relay made `<repo>-<ISO time, ':' and '.' as '-'>[-pid]`, or null for another repo's folder. */
export function folderTime(name: string, repo: string): number | null {
  if (!name.startsWith(`${repo}-`)) return null
  const m = name.slice(repo.length + 1).match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/)
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null
}

/**
 * The out-dir a relay with no --out-dir made for this job: the oldest unclaimed `<repo>-<time>`
 * folder made after the launch and before any later launch in the same repo, so a relay that
 * never started cannot take the next one's folder.
 */
export function pickOutDir(
  root: string,
  entries: readonly DirEntry[],
  repo: string,
  startedAt: number,
  otherStarts: readonly number[],
  claimed: ReadonlySet<string>,
): string | null {
  const candidates = entries.flatMap(d => {
    const madeAt = d.kind === 'dir' ? folderTime(d.name, repo) : null
    if (madeAt === null || madeAt < startedAt - CLOCK_SKEW_MS) return []
    if (otherStarts.some(s => s > startedAt && s <= madeAt)) return []
    const path = `${root}/${d.name}`
    return claimed.has(path) ? [] : [{ path, madeAt }]
  })
  return candidates.sort((a, b) => a.madeAt - b.madeAt)[0]?.path ?? null
}

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || 'repo'
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}
