// `node <path>/<lane>-delegate/scripts/relay.mjs` at the start of a command, the path maybe quoted
const LAUNCH = /^\s*(?:[A-Za-z_]\w*=\S*\s+)*(?:(?:nohup|exec|time)\s+)*node\s+(["']?)[^\s"']*?([a-z]+)-delegate\/scripts\/relay\.mjs\1(?=\s|$)/
const HELP = /\s(--help|-h)(?=\s|$)/
const SAFE_PATH = /^[A-Za-z0-9_./-]+$/

function flag(command: string, name: string): string | null {
  const m = command.match(new RegExp(`--${name}[ =](?:"([^"]+)"|'([^']+)'|(\\S+))`))
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null
}

/** The command with every heredoc body blanked out, newlines and offsets kept. */
export function withoutHeredocs(command: string): string {
  const lines = command.split('\n')
  const out: string[] = []
  let ends: { tag: string; isTabbed: boolean }[] = []
  for (const line of lines) {
    const end = ends[0]
    if (end) {
      out.push(' '.repeat(line.length))
      if ((end.isTabbed ? line.replace(/^\t+/, '') : line) === end.tag) ends = ends.slice(1)
      continue
    }
    out.push(line)
    ends = [...line.matchAll(/(?<!<)<<(?!<)(-?)\s*(["']?)([A-Za-z_]\w*)\2/g)].map(m => ({ tag: m[3]!, isTabbed: m[1] === '-' }))
  }
  return out.join('\n')
}

export type RelayLaunch = { lane: string; cd: string | null; outDir: string | null; insertAt: number }

/** The first relay the command runs, read from its own segment; heredoc text and other commands don't count. */
export function relayLaunch(command: string): RelayLaunch | null {
  const masked = withoutHeredocs(command)
  for (const segment of masked.matchAll(/[^;&|\n]+/g)) {
    const m = segment[0].match(LAUNCH)
    if (!m) continue
    const args = segment[0]
    if (HELP.test(args)) return null
    return { lane: m[2]!, cd: flag(args, 'cd'), outDir: flag(args, 'out-dir'), insertAt: segment.index! + m[0].length }
  }
  return null
}

/**
 * The command with `--out-dir <dir>` right after the relay script, so an allow rule on the
 * command's prefix still matches; null when the path would need quoting.
 */
export function withOutDir(command: string, insertAt: number, dir: string): string | null {
  if (!SAFE_PATH.test(dir)) return null
  return `${command.slice(0, insertAt)} --out-dir ${dir}${command.slice(insertAt)}`
}

/** A relay makes its out-dir within a second of starting; one with none after this likely never started. */
export const NEVER_STARTED_MS = 30_000

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || 'repo'
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}
