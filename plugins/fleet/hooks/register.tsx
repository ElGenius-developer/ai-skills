import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FleetJob } from '../types'
import { NEVER_STARTED_MS, basename, elapsed, relayLaunch, withOutDir } from './parse'

const PANE = 'fleet'
const POLL_MS = 5_000
const jobs = atom({ plugin: 'fleet', key: 'jobs' } as const, [] as FleetJob[])
const now = atom({ plugin: 'fleet', key: 'now' } as const, 0)

const STATUS_COLOR: Record<string, string> = { running: 'warning', completed: 'success' }

async function settle($: EngineInterface, job: FleetJob, at: number): Promise<FleetJob> {
  if (!job.outDir) return job
  if (!(await $.fs.exists(job.outDir))) {
    // A relay that dies on a usage error makes no out-dir. A relative --out-dir can't be checked.
    const isDead = job.outDir.startsWith('/') && job.launchedAt !== null && at - job.launchedAt > NEVER_STARTED_MS
    return isDead ? { ...job, status: 'failed', finishedAt: at } : job
  }
  if (!(await $.fs.exists(`${job.outDir}/result.json`))) return job
  let result: { status?: string; touchedFiles?: unknown[] | null }
  try {
    result = JSON.parse(String(await $.fs.read(`${job.outDir}/result.json`)))
  } catch {
    return job // still being written
  }
  return {
    ...job,
    status: result.status ?? 'done',
    touched: Array.isArray(result.touchedFiles) ? result.touchedFiles.length : null,
    finishedAt: at,
  }
}

async function poll($: EngineInterface) {
  const list = await read($, jobs)
  if (!list.some(j => j.status === 'running')) return
  const t = await $.clock.now()
  await update($, now, () => t)

  const settled = new Map<string, FleetJob>()
  for (const job of list) {
    if (job.status !== 'running') continue
    const next = await settle($, job, t)
    if (next.status !== 'running') {
      $.ui.toast(`${next.lane} finished: ${next.status}${next.touched !== null ? `, ${next.touched} files` : ''}`)
    }
    settled.set(job.id, next)
  }
  // Only the fields a poll owns: launchedAt may land from the Bash call while this poll ran
  await update($, jobs, current =>
    current.map(j => {
      const next = settled.get(j.id)
      if (!next || j.status !== 'running') return j
      return { ...j, status: next.status, touched: next.touched, finishedAt: next.finishedAt }
    }),
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'delegations', description: 'Show running and finished delegations in a pane' })
    $.clock.every(POLL_MS, () => void poll($).catch(() => undefined))
    return next(e)
  })

  on('command.run', { command: 'delegations' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Delegations' })
    return { text: 'Delegations pane opened.' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const launch = relayLaunch(e.command)
    if (!launch) return next(e)

    // Each launch gets its own out-dir, so finding its result is no guess
    const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')
    const ownDir = `${tmp}/delegate-relay/fleet-${e.tool_use_id}`
    const command = launch.outDir ? null : withOutDir(e.command, ownDir)
    const job: FleetJob = {
      id: e.tool_use_id,
      lane: launch.lane,
      cd: launch.cd ?? (await $.session.cwd()),
      outDir: launch.outDir ?? (command ? ownDir : null),
      startedAt: await $.clock.now(),
      launchedAt: null,
      status: 'running',
      touched: null,
      finishedAt: null,
    }
    await update($, jobs, list => [...list, job].slice(-30))

    // A relay that dies on a usage error writes no result.json; without this
    // a foreground launch that failed would read "running" forever.
    const ran = await next(command ? { ...e, command } : e)
    const at = await $.clock.now()
    const isFailed = ran.deny !== undefined || ran.isError === true
    await update($, jobs, list =>
      list.map(j => {
        if (j.id !== job.id) return j
        return isFailed && j.status === 'running'
          ? { ...j, launchedAt: at, status: 'failed', finishedAt: at }
          : { ...j, launchedAt: at }
      }),
    )
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, jobs)
    const at = await read($, now)
    const hasFinished = list.some(j => j.status !== 'running')

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No delegations yet this session.</Text>}
        {list.map(job => (
          <Box key={job.id} flexDirection="row" gap={1}>
            <Text bold>{job.lane.padEnd(8)}</Text>
            <Text color={STATUS_COLOR[job.status] ?? 'error'}>{job.status.padEnd(9)}</Text>
            <Text dimColor>{elapsed((job.finishedAt ?? Math.max(at, job.startedAt)) - job.startedAt).padEnd(7)}</Text>
            <Text dimColor>{job.cd ? basename(job.cd) : ''}{job.touched !== null ? ` · ${job.touched} files` : ''}</Text>
          </Box>
        ))}
        {hasFinished && (
          <Button
            key="clear"
            label="Clear finished"
            onPress={() => update($, jobs, l => l.filter(j => j.status === 'running'))}
          />
        )}
      </Box>
    )
  })
}
