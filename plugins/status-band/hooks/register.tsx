import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { StatusBandContext, StatusBandGit, StatusBandVerify } from '../types'
import { ciOf, contextLine, gitLine, isVerifyCommand } from './parse'
import type { Check } from './parse'

const edited = atom({ plugin: 'status-band', key: 'edited' } as const, [] as string[])
const verify = atom({ plugin: 'status-band', key: 'verify' } as const, null as StatusBandVerify)
const costUsd = atom({ plugin: 'status-band', key: 'costUsd' } as const, null as number | null)
const context = atom({ plugin: 'status-band', key: 'context' } as const, null as StatusBandContext | null)
const git = atom({ plugin: 'status-band', key: 'git' } as const, null as StatusBandGit | null)

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const GIT_COMMAND = /\b(git|gh)\s/
const GH_MIN_GAP_MS = 60_000

let hasAlerted = false
let lastGhAt = 0

async function run($: EngineInterface, argv: string[], cwd: string) {
  const r = await $.process.run(argv, { cwd, timeoutMs: 8_000 })
  return r.exitCode === 0 ? r.stdout.trim() : null
}

async function refreshGit($: EngineInterface, withGh: boolean) {
  const cwd = await $.session.cwd()
  const branch = await run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  if (!branch) return update($, git, () => null)

  const head = await run($, ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd)
  const behindText = head ? await run($, ['git', 'rev-list', '--count', `HEAD..${head}`], cwd) : null
  const base = head ? head.replace(/^origin\//, '') : null

  let pr = (await read($, git))?.pr ?? null
  const now = await $.clock.now()
  if (withGh && now - lastGhAt >= GH_MIN_GAP_MS) {
    lastGhAt = now
    const json = await run($, ['gh', 'pr', 'view', '--json', 'number,statusCheckRollup'], cwd)
    const view = json ? (JSON.parse(json) as { number: number; statusCheckRollup?: Check[] }) : null
    pr = view ? { number: view.number, ci: ciOf(view.statusCheckRollup ?? []) } : null
  }

  const next: StatusBandGit = { branch, base, behind: behindText ? Number(behindText) : null, pr }
  return update($, git, () => next)
}

async function refreshCost($: EngineInterface, alertUsd: number) {
  const usd = (await $.session.usage()).cost?.usd ?? null
  await update($, costUsd, () => usd)
  if (usd !== null && usd >= alertUsd && !hasAlerted) {
    hasAlerted = true
    $.ui.toast(`Session cost passed $${alertUsd.toFixed(2)} (now $${usd.toFixed(2)})`)
  }
}

async function refreshContext($: EngineInterface) {
  const { tokens, window } = (await $.session.usage()).context
  await update($, context, () => (tokens === undefined ? null : { tokens, window }))
}

export const register: Register = (on, options) => {
  const alertUsd = Number(options.costAlertUsd ?? 5)
  on('session.start', async ($, e, next) => {
    void refreshGit($, true).catch(() => undefined)
    $.clock.every(120_000, () => void refreshGit($, true).catch(() => undefined))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran

    if (EDIT_TOOLS.has(String(e.tool)) && !ran.isError) {
      const input = e as unknown as { file_path?: string; notebook_path?: string }
      const path = input.file_path ?? input.notebook_path
      if (path) await update($, edited, list => (list.includes(path) ? list : [...list, path]))
    }

    if (e.tool === 'Bash') {
      // A background run returns at once without its outcome, so it proves nothing.
      if (isVerifyCommand(e.command) && !e.run_in_background) {
        await update($, verify, () => (ran.isError ? 'fail' : 'pass'))
        if (!ran.isError) await update($, edited, () => [])
      }
      if (GIT_COMMAND.test(e.command)) void refreshGit($, true).catch(() => undefined)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await refreshCost($, alertUsd).catch(() => undefined)
    await refreshContext($).catch(() => undefined)
    void refreshGit($, false).catch(() => undefined)
    return next(e)
  })

  // usage().context counts the last response's input, so right after a compaction it
  // still shows the old size; tokensAfter is the new one until the next turn.
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.trigger === 'precompute' || compacted.skip !== undefined || compacted.tokensAfter === undefined) return compacted

    const window = (await $.session.usage()).context.window
    const tokens = compacted.tokensAfter
    await update($, context, () => ({ tokens, window }))
    await refreshCost($, alertUsd).catch(() => undefined)
    return compacted
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const files = await read($, edited)
    const lastVerify = await read($, verify)
    const usd = await read($, costUsd)
    const repo = await read($, git)
    const ctx = await read($, context)
    if (files.length === 0 && lastVerify === null && usd === null && repo === null && ctx === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={2} flexWrap="wrap">
        {files.length > 0 && (
          <Text color="warning">● {files.length} file{files.length === 1 ? '' : 's'} edited, not verified</Text>
        )}
        {files.length === 0 && lastVerify === 'fail' && <Text color="error">✗ last check failed</Text>}
        {files.length === 0 && lastVerify === 'pass' && <Text color="success">✓ verified</Text>}
        {repo && <Text dimColor>{gitLine(repo)}</Text>}
        {ctx !== null && <Text dimColor>{contextLine(ctx)}</Text>}
        {usd !== null && <Text dimColor>${usd.toFixed(2)}</Text>}
      </Box>
    )
  })
}
