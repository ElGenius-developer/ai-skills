import type { StatusBandContext, StatusBandGit } from '../types'

const VERIFY_TOOL =
  /^(?:(?:npx|pnpm|yarn|bunx?|php)\s+)?(?:\.\/)?(vendor\/bin\/(pint|phpunit|pest)|artisan test|vitest|(npm|pnpm|yarn) (run )?(test|lint)|eslint|flutter (test|analyze)|dart analyze|tsc|composer test|pytest)\b/

const RUNS_NO_CHECK = /\s--(version|help|collect-only)\b/

/**
 * True when one segment of the command runs a test, lint or type check, not merely mentions one.
 * A pipe, `||` or `;` lets a later command set the exit code, so such a chain proves nothing.
 */
export function isVerifyCommand(command: string): boolean {
  if (/[|;]/.test(command)) return false
  return command
    .split('&&')
    .map(segment => segment.trim())
    .some(segment => VERIFY_TOOL.test(segment) && !RUNS_NO_CHECK.test(segment))
}

export type Check = { conclusion?: string | null; status?: string | null; state?: string | null }

export function ciOf(checks: readonly Check[]): 'pass' | 'fail' | 'pending' | null {
  if (checks.length === 0) return null
  const outcomes = checks.map(c => (c.conclusion || c.state || c.status || '').toUpperCase())
  if (outcomes.some(o => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(o))) return 'fail'
  if (outcomes.every(o => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(o))) return 'pass'
  return 'pending'
}

const CI_MARK = { pass: '✓ CI', fail: '✗ CI', pending: '… CI' } as const

export function gitLine(git: StatusBandGit): string {
  const parts = [`⎇ ${git.branch}`]
  if (git.pr) parts.push(`PR #${git.pr.number}${git.pr.ci ? ` ${CI_MARK[git.pr.ci]}` : ''}`)
  if (git.base && git.behind) parts.push(`${git.behind} behind ${git.base}`)
  return parts.join(' · ')
}

export function contextLine({ tokens, window }: StatusBandContext): string {
  const k = tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
  return window > 0 ? `ctx ${k} · ${Math.round((tokens / window) * 100)}%` : `ctx ${k}`
}
