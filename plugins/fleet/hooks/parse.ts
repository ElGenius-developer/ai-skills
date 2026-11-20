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

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || 'repo'
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}
