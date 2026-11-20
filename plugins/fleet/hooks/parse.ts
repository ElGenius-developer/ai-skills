const RELAY = /([a-z]+)-delegate\/scripts\/relay\.mjs/

function flag(command: string, name: string): string | null {
  const m = command.match(new RegExp(`--${name}[ =](?:"([^"]+)"|'([^']+)'|(\\S+))`))
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null
}

export function relayLaunch(
  command: string,
): { lane: string; cd: string | null; outDir: string | null; briefPath: string } | null {
  const m = command.match(RELAY)
  const briefPath = m ? flag(command, 'brief') : null
  if (!m || !briefPath) return null
  return { lane: m[1]!, cd: flag(command, 'cd'), outDir: flag(command, 'out-dir'), briefPath }
}

/** A relay makes its folder within a second of launch; one with none after this never started. */
export const NEVER_STARTED_MS = 30_000
export const CLOCK_SKEW_MS = 2_000

/** The repo and time in a relay folder name, `<repo>-<ISO time, ':' and '.' as '-'>[-pid]`. */
export function folderName(name: string): { repo: string; madeAt: number } | null {
  const m = name.match(/^(.+)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-\d+)?$/)
  return m ? { repo: m[1]!, madeAt: Date.parse(`${m[2]}T${m[3]}:${m[4]}:${m[5]}.${m[6]}Z`) } : null
}

export type Folder = { path: string; repo: string; madeAt: number; brief: string | null }
export type Launch = { startedAt: number; brief: string | null; repo: string }

/**
 * The out-dir a relay with no --out-dir made for this job: the oldest unclaimed folder made
 * after the launch whose brief.txt holds the job's brief. A relay launched later with the same
 * brief bounds it, so one that never started cannot take its twin's folder. With no brief to
 * compare, the oldest unclaimed folder of the job's repo.
 */
export function pickOutDir(
  folders: readonly Folder[],
  job: Launch,
  others: readonly Launch[],
  claimed: ReadonlySet<string>,
): string | null {
  const laterTwins = job.brief === null ? [] : others.filter(o => o.brief === job.brief && o.startedAt > job.startedAt)
  const fits = folders.filter(
    f =>
      !claimed.has(f.path) &&
      f.madeAt >= job.startedAt - CLOCK_SKEW_MS &&
      (job.brief === null ? f.repo === job.repo : f.brief === job.brief) &&
      !laterTwins.some(o => o.startedAt <= f.madeAt),
  )
  return fits.sort((a, b) => a.madeAt - b.madeAt)[0]?.path ?? null
}

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || 'repo'
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}
