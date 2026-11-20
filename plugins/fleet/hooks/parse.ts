// What may stand before `node` at the start of a command, read on the masked text
const PREFIX = /^\s*(?:[A-Za-z_]\w*=\S*\s+)*(?:(?:nohup|exec|time)\s+)*node\s+/
// The relay script path, maybe quoted, read on the raw text
const SCRIPT = /^(["']?)[^\s"']*?([a-z]+)-delegate\/scripts\/relay\.mjs\1(?=\s|$)/
const HELP = /(?:^|\s)(--help|-h)(?=\s|$)/
const SAFE_PATH = /^[A-Za-z0-9_./-]+$/
const HEREDOC = /^<<(-?)\s*\\?(["']?)([A-Za-z_][^\s"'<>;&|()]*)\2/

/**
 * The command with quoted text and heredoc bodies blanked to 'x' and backslash-newlines to
 * spaces, offsets kept, so separators and flags count only where the shell sees them.
 */
export function maskShell(command: string): string {
  const out = command.split('')
  let quote: string | null = null
  let heredocs: { tag: string; isTabbed: boolean }[] = []
  let i = 0
  while (i < command.length) {
    const c = command[i]!
    if (quote) {
      if (c === quote.at(-1)) {
        quote = null
      } else {
        out[i] = 'x'
        if (quote !== "'" && c === '\\' && i + 1 < command.length) out[++i] = 'x'
      }
      i++
      continue
    }
    if (c === '\\') {
      if (command[i + 1] === '\n') out[i + 1] = ' '
      i += 2
      continue
    }
    // A word that starts with # is a comment to the end of the line
    if (c === '#' && (i === 0 || /[\s;&|(]/.test(command[i - 1]!))) {
      while (i < command.length && command[i] !== '\n') out[i++] = 'x'
      continue
    }
    if (c === '"' || c === "'") {
      // $'...' takes backslash escapes, as "..." does
      quote = c === "'" && command[i - 1] === '$' ? "$'" : c
      i++
      continue
    }
    const heredoc = c === '<' && command[i - 1] !== '<' ? command.slice(i).match(HEREDOC) : null
    if (heredoc) {
      heredocs = [...heredocs, { tag: heredoc[3]!, isTabbed: heredoc[1] === '-' }]
      i += heredoc[0].length
      continue
    }
    if (c === '\n' && heredocs.length > 0) {
      i = skipBodies(command, out, i + 1, heredocs)
      heredocs = []
      continue
    }
    i++
  }
  return out.join('')
}

// Blanks each heredoc body and its closing tag line from `pos`; returns where the shell reads on
function skipBodies(command: string, out: string[], pos: number, heredocs: { tag: string; isTabbed: boolean }[]): number {
  for (const { tag, isTabbed } of heredocs) {
    while (pos < command.length) {
      const nl = command.indexOf('\n', pos)
      const stop = nl === -1 ? command.length : nl
      const line = command.slice(pos, stop).replace(/\r$/, '')
      for (let k = pos; k < stop; k++) out[k] = 'x'
      pos = stop + 1
      if ((isTabbed ? line.replace(/^\t+/, '') : line) === tag) break
    }
  }
  return pos
}

// The value of the last `--name` the shell sees (the relay keeps the last), read from the raw text
function flag(masked: string, raw: string, name: string): string | null {
  const hit = [...masked.matchAll(new RegExp(`(?:^|\\s)--${name}(?:=|\\s+)`, 'g'))].at(-1)
  if (!hit) return null
  const m = raw.slice(hit.index! + hit[0].length).match(/^(?:"([^"]*)"|'([^']*)'|(\S+))/)
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null
}

export type RelayLaunch = { lane: string; cd: string | null; outDir: string | null; insertAt: number }

/** The first relay the command runs; quoted text, heredoc bodies and other commands don't count. */
export function relayLaunch(command: string): RelayLaunch | null {
  const masked = maskShell(command)
  for (const segment of masked.matchAll(/[^;&|\n]+/g)) {
    const prefix = segment[0].match(PREFIX)
    if (!prefix) continue
    const start = segment.index! + prefix[0].length
    const end = segment.index! + segment[0].length
    const script = command.slice(start, end).match(SCRIPT)
    if (!script) continue
    const at = start + script[0].length
    const [args, raw] = [masked.slice(at, end), command.slice(at, end)]
    if (HELP.test(args)) return null
    return { lane: script[2]!, cd: flag(args, raw, 'cd'), outDir: flag(args, raw, 'out-dir'), insertAt: at }
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
/** A lost relay waiting longer than this can be cleared; it is still polled until then. */
export const GIVE_UP_MS = 15 * 60_000

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || 'repo'
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}
