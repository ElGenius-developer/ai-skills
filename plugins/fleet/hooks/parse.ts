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

/**
 * The out-dir a relay with no --out-dir made for this job: `<root>/<repo>-<ISO timestamp>`,
 * made after the launch and not claimed by another job. Jobs settle oldest first, so each
 * takes the oldest such folder; a sibling repo like `<repo>-admin` never matches.
 */
export function pickOutDir(
  root: string,
  entries: readonly DirEntry[],
  repo: string,
  startedAt: number,
  claimed: ReadonlySet<string>,
): string | null {
  const own = new RegExp(`^${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{4}-\\d{2}-\\d{2}T`)
  const candidates = entries
    .filter(d => d.kind === 'dir' && own.test(d.name) && d.mtimeMs >= startedAt - 5_000)
    .map(d => `${root}/${d.name}`)
    .filter(path => !claimed.has(path))
  return candidates.sort()[0] ?? null
}

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || 'repo'
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}
