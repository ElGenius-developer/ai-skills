import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FleetJob } from '../types'
import { basename, elapsed, relayLaunch } from './parse'

const PANE = 'fleet'
const POLL_MS = 5_000
const jobs = atom({ plugin: 'fleet', key: 'jobs' } as const, [] as FleetJob[])
const now = atom({ plugin: 'fleet', key: 'now' } as const, 0)

const STATUS_COLOR: Record<string, string> = { running: 'warning', completed: 'success' }

// A relay given no --out-dir writes to $TMPDIR/delegate-relay/<repo>-<timestamp>;
// the newest such folder made after the launch, not yet claimed, is this job's.
async function findOutDir($: EngineInterface, job: FleetJob, claimed: ReadonlySet<string>): Promise<string | null> {
  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')
  const root = `${tmp}/delegate-relay`
  if (!(await $.fs.exists(root))) return null
  const prefix = `${job.cd ? basename(job.cd) : 'repo'}-`
  const candidates = (await $.fs.list(root))
    .filter(d => d.kind === 'dir' && d.name.startsWith(prefix) && d.mtimeMs >= job.startedAt - 5_000)
    .map(d => `${root}/${d.name}`)
    .filter(path => !claimed.has(path))
  return candidates.sort().pop() ?? null
}

async function settle($: EngineInterface, job: FleetJob, claimed: ReadonlySet<string>): Promise<FleetJob> {
  const outDir = job.outDir ?? (await findOutDir($, job, claimed))
  if (!outDir || !(await $.fs.exists(`${outDir}/result.json`))) return { ...job, outDir }
  const result = JSON.parse(String(await $.fs.read(`${outDir}/result.json`))) as {
    status?: string
    touchedFiles?: unknown[] | null
  }
  return {
    ...job,
    outDir,
    status: result.status ?? 'done',
    touched: Array.isArray(result.touchedFiles) ? result.touchedFiles.length : null,
    finishedAt: await $.clock.now(),
  }
}

async function poll($: EngineInterface) {
  const list = await read($, jobs)
  if (!list.some(j => j.status === 'running')) return
  const t = await $.clock.now()
  await update($, now, () => t)

  const claimed = new Set(list.flatMap(j => (j.outDir ? [j.outDir] : [])))
  const settled: FleetJob[] = []
  for (const job of list) {
    const next = job.status === 'running' ? await settle($, job, claimed) : job
    if (next.outDir) claimed.add(next.outDir)
    if (job.status === 'running' && next.status !== 'running') {
      $.ui.toast(`${next.lane} finished: ${next.status}${next.touched !== null ? `, ${next.touched} files` : ''}`)
    }
    settled.push(next)
  }
  await update($, jobs, () => settled)
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

    const job: FleetJob = {
      id: e.tool_use_id,
      ...launch,
      cd: launch.cd ?? (await $.session.cwd()),
      startedAt: await $.clock.now(),
      status: 'running',
      touched: null,
      finishedAt: null,
    }
    await update($, jobs, list => [...list, job].slice(-30))

    // A relay that dies on a usage error writes no result.json; without this
    // a foreground launch that failed would read "running" forever.
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) {
      const at = await $.clock.now()
      await update($, jobs, list =>
        list.map(j => (j.id === job.id && j.status === 'running' ? { ...j, status: 'failed', finishedAt: at } : j)),
      )
    }
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
