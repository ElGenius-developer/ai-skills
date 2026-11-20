const RELAY = /([a-z]+)-delegate\/scripts\/relay\.mjs/
const HELP = /\s(--help|-h)(?=\s|$)/
const SAFE_PATH = /^[A-Za-z0-9_./-]+$/

function flag(command: string, name: string): string | null {
  const m = command.match(new RegExp(`--${name}[ =](?:"([^"]+)"|'([^']+)'|(\\S+))`))
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null
}

export function relayLaunch(command: string): { lane: string; cd: string | null; outDir: string | null } | null {
  const m = command.match(RELAY)
  if (!m || HELP.test(command)) return null
  return { lane: m[1]!, cd: flag(command, 'cd'), outDir: flag(command, 'out-dir') }
}

/**
 * The command with `--out-dir <dir>` right after the relay script, so an allow rule on the
 * command's prefix still matches; null when it can't go in unquoted.
 */
export function withOutDir(command: string, dir: string): string | null {
  const m = command.match(/relay\.mjs(?=\s|$)/)
  if (!m || m.index === undefined || !SAFE_PATH.test(dir)) return null
  const end = m.index + m[0].length
  return `${command.slice(0, end)} --out-dir ${dir}${command.slice(end)}`
}

/** A relay makes its out-dir within a second of starting; one with none after this never started. */
export const NEVER_STARTED_MS = 30_000

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || 'repo'
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}
