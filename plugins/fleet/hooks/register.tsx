import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FleetJob } from '../types'
import { GIVE_UP_MS, NEVER_STARTED_MS, basename, elapsed, relayLaunch, withOutDir } from './parse'

const PANE = 'fleet'
const POLL_MS = 5_000
const jobs = atom({ plugin: 'fleet', key: 'jobs' } as const, [] as FleetJob[])
const now = atom({ plugin: 'fleet', key: 'now' } as const, 0)

const STATUS_COLOR: Record<string, string> = { running: 'warning', completed: 'success' }
// "lost": no out-dir in time. Still polled: a relay held behind an earlier step in its command starts late
const POLLED = new Set(['running', 'lost'])

// Finished, or lost long enough that a late start is unlikely
function isClearable(job: FleetJob, at: number): boolean {
  if (!POLLED.has(job.status)) return true
  return job.status === 'lost' && job.launchedAt !== null && at - job.launchedAt > GIVE_UP_MS
}

async function settle($: EngineInterface, job: FleetJob, at: number): Promise<FleetJob> {
  if (!job.outDir) return job
  if (!(await $.fs.exists(job.outDir))) {
    // A relay that dies on a usage error makes no out-dir. A relative --out-dir can't be checked.
    const waited = job.outDir.startsWith('/') && job.launchedAt !== null ? at - job.launchedAt : 0
    return waited > NEVER_STARTED_MS ? { ...job, status: 'lost' } : job
  }
  if (!(await $.fs.exists(`${job.outDir}/result.json`))) return { ...job, status: 'running' }
  let result: { status?: string; touchedFiles?: unknown[] | null }
  try {
    result = JSON.parse(String(await $.fs.read(`${job.outDir}/result.json`)))
  } catch {
    return { ...job, status: 'running' } // still being written
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
  if (!list.some(j => POLLED.has(j.status))) return
  const t = await $.clock.now()
  await update($, now, () => t)

  const settled = new Map<string, FleetJob>()
  for (const job of list) {
    if (!POLLED.has(job.status)) continue
    const next = await settle($, job, t)
    if (!POLLED.has(next.status)) {
      $.ui.toast(`${next.lane} finished: ${next.status}${next.touched !== null ? `, ${next.touched} files` : ''}`)
    }
    settled.set(job.id, next)
  }
  // Only the fields a poll owns: launchedAt may land from the Bash call while this poll ran
  await update($, jobs, current =>
    current.map(j => {
      const next = settled.get(j.id)
      if (!next || !POLLED.has(j.status)) return j
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
    const command = launch.outDir ? null : withOutDir(e.command, launch.insertAt, ownDir)
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
        return isFailed && POLLED.has(j.status)
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
    const hasFinished = list.some(j => isClearable(j, at))

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
            onPress={() => update($, jobs, l => l.filter(j => !isClearable(j, at)))}
          />
        )}
      </Box>
    )
  })
}
