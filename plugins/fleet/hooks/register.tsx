import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FleetJob } from '../types'
import { CLOCK_SKEW_MS, NEVER_STARTED_MS, basename, elapsed, folderName, pickOutDir, relayLaunch } from './parse'
import type { Folder } from './parse'

const PANE = 'fleet'
const POLL_MS = 5_000
const jobs = atom({ plugin: 'fleet', key: 'jobs' } as const, [] as FleetJob[])
const now = atom({ plugin: 'fleet', key: 'now' } as const, 0)

// "lost": no folder yet after the wait; still polled, so a folder that shows up later revives it
const ACTIVE = new Set(['running', 'lost'])
const STATUS_COLOR: Record<string, string> = { running: 'warning', completed: 'success' }
const CD_FIRST = /(^|[;&|(]\s*)cd\s/
// A folder's brief.txt never changes once written
const folderBriefs = new Map<string, string>()

function repoOf(job: FleetJob): string {
  return job.cd ? basename(job.cd) : 'repo'
}

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    return (await $.fs.exists(path)) ? String(await $.fs.read(path)) : null
  } catch {
    return null
  }
}

/**
 * The brief the relay reads. It resolves a relative --brief against the shell's cwd, which is
 * only known when the command does not cd first; `missing` only for a fixed path that is gone.
 */
async function launchBrief(
  $: EngineInterface,
  command: string,
  briefPath: string,
): Promise<{ brief: string | null; missing: boolean }> {
  const home = await $.env.get('HOME')
  const fixed = briefPath.startsWith('/') ? briefPath : home && briefPath.startsWith('~/') ? home + briefPath.slice(1) : null
  if (fixed) {
    const brief = await readText($, fixed)
    return { brief, missing: brief === null }
  }
  if (CD_FIRST.test(command)) return { brief: null, missing: false }
  const cwd = (await $.session.cwd()).replace(/\/+$/, '')
  return { brief: await readText($, `${cwd}/${briefPath}`), missing: false }
}

// A relay given no --out-dir writes to $TMPDIR/delegate-relay/<repo>-<timestamp>.
async function scanFolders($: EngineInterface, active: readonly FleetJob[]): Promise<Folder[]> {
  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')
  const root = `${tmp}/delegate-relay`
  if (!(await $.fs.exists(root))) return []
  const since = Math.min(...active.map(j => j.startedAt)) - CLOCK_SKEW_MS
  const folders: Folder[] = []
  for (const d of await $.fs.list(root)) {
    const name = d.kind === 'dir' ? folderName(d.name) : null
    if (!name || name.madeAt < since) continue
    const path = `${root}/${d.name}`
    const brief = folderBriefs.get(path) ?? (await readText($, `${path}/brief.txt`))
    if (brief !== null) folderBriefs.set(path, brief)
    folders.push({ path, ...name, brief })
  }
  return folders
}

async function settle($: EngineInterface, job: FleetJob, outDir: string | null, at: number): Promise<FleetJob> {
  // A background launch that dies on a usage error returns no error and makes no folder.
  if (!outDir || !(await $.fs.exists(outDir))) {
    const isLost = job.launchedAt !== null && at - job.launchedAt > NEVER_STARTED_MS
    return { ...job, status: isLost ? 'lost' : job.status }
  }
  const resultText = await readText($, `${outDir}/result.json`)
  if (resultText === null) return { ...job, outDir, status: 'running' }
  const result = JSON.parse(resultText) as { status?: string; touchedFiles?: unknown[] | null }
  return {
    ...job,
    outDir,
    status: result.status ?? 'done',
    touched: Array.isArray(result.touchedFiles) ? result.touchedFiles.length : null,
    finishedAt: at,
  }
}

async function poll($: EngineInterface) {
  const list = await read($, jobs)
  const active = list.filter(j => ACTIVE.has(j.status))
  if (active.length === 0) return
  const t = await $.clock.now()
  await update($, now, () => t)

  const folders = await scanFolders($, active)
  const launches = new Map(list.map(j => [j.id, { startedAt: j.startedAt, brief: j.brief, repo: repoOf(j) }]))
  const claimed = new Set(list.flatMap(j => (j.outDir ? [j.outDir] : [])))
  const settled = new Map<string, FleetJob>()
  // Jobs that know their brief claim first, so a job matched by repo alone can't take their folder
  for (const job of [...active].sort((a, b) => Number(a.brief === null) - Number(b.brief === null))) {
    const others = list.filter(o => o.id !== job.id).map(o => launches.get(o.id)!)
    const outDir = job.outDir ?? pickOutDir(folders, launches.get(job.id)!, others, claimed)
    if (outDir) claimed.add(outDir)
    const next = await settle($, job, outDir, t)
    if (!ACTIVE.has(next.status)) {
      $.ui.toast(`${next.lane} finished: ${next.status}${next.touched !== null ? `, ${next.touched} files` : ''}`)
    }
    settled.set(job.id, next)
  }
  // Only the fields a poll owns: launchedAt may land from the Bash call while this poll ran
  await update($, jobs, current =>
    current.map(j => {
      const next = settled.get(j.id)
      if (!next || !ACTIVE.has(j.status)) return j
      return { ...j, outDir: next.outDir, status: next.status, touched: next.touched, finishedAt: next.finishedAt }
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

    const { briefPath, ...where } = launch
    const { brief, missing } = await launchBrief($, e.command, briefPath)
    const startedAt = await $.clock.now()
    const job: FleetJob = {
      id: e.tool_use_id,
      ...where,
      cd: where.cd ?? (await $.session.cwd()),
      brief,
      startedAt,
      launchedAt: null,
      // The relay exits on a missing brief before making its folder
      status: missing ? 'failed' : 'running',
      touched: null,
      finishedAt: missing ? startedAt : null,
    }
    await update($, jobs, list => [...list, job].slice(-30))

    // A relay that dies on a usage error writes no result.json; without this
    // a foreground launch that failed would read "running" forever.
    const ran = await next(e)
    const at = await $.clock.now()
    const isFailed = ran.deny !== undefined || ran.isError === true
    await update($, jobs, list =>
      list.map(j => {
        if (j.id !== job.id) return j
        return isFailed && ACTIVE.has(j.status) ? { ...j, launchedAt: at, status: 'failed', finishedAt: at } : { ...j, launchedAt: at }
      }),
    )
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, jobs)
    const at = await read($, now)
    const hasFinished = list.some(j => !ACTIVE.has(j.status))

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
            onPress={() => update($, jobs, l => l.filter(j => ACTIVE.has(j.status)))}
          />
        )}
      </Box>
    )
  })
}
