import { test, expect, mock } from 'claude-code/testing'
import type { TestOn } from 'claude-code/testing'

import { folderName, pickOutDir, relayLaunch } from '../hooks/parse'

const T = Date.parse('2026-11-20T10:00:00.000Z')
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[:.]/g, '-')
const folder = (repo: string, ms: number, brief: string | null) =>
  ({ path: `/t/${repo}-${stamp(ms)}`, repo, madeAt: ms, brief })
const launch = (startedAt: number, brief: string | null, repo = 'app') => ({ startedAt, brief, repo })

// A disk the plugin reads through $.fs: every key is a file path
function disk(on: TestOn, files: Map<string, string>) {
  const isDir = (path: string) => [...files.keys()].some(f => f.startsWith(`${path}/`))
  on('fs.exists', (_, e) => ({ value: files.has(e.path) || isDir(e.path) }))
  on('fs.read', (_, e) => (files.has(e.path) ? { value: files.get(e.path)! } : { deny: `ENOENT: ${e.path}` }))
  on('fs.list', (_, e) => {
    const names = new Set([...files.keys()].filter(f => f.startsWith(`${e.path}/`)).map(f => f.slice(e.path.length + 1).split('/')[0]!))
    return { value: [...names].map(name => ({ name, kind: 'dir' as const, size: 0, isLink: false })) }
  })
}

type Clock = ReturnType<typeof mock.clock>
type ToolCall = (clock: Clock) => Parameters<TestOn>[1]

async function startSession(
  $: Parameters<Parameters<typeof test>[1]>[0],
  on: TestOn,
  files: Map<string, string>,
  toolCall: ToolCall = () => () => ({ result: {} as never }),
) {
  const clock = mock.clock(on, { now: T })
  on('tool.call', toolCall(clock))
  mock.env(on, { TMPDIR: '/t', HOME: '/h' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/r/app' }))
  on('command.register', () => ({ value: { command: 'delegations' } }))
  disk(on, files)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/r/app', surface: 'terminal', isInteractive: true })
  return { clock, toasts }
}

const relay = (lane: string, args: string) => `node ~/.agents/skills/${lane}-delegate/scripts/relay.mjs ${args}`
const openPane = ($: Parameters<Parameters<typeof test>[1]>[0]) =>
  $.ui.mount({ plugin: 'fleet', surface: 'terminal', component: 'Pane', requestId: 'fleet', props: { bodyColumns: 80 } as never })

test('a relay folder name gives its repo and the time it was made, with or without a pid', () => {
  expect(folderName(`app-admin-${stamp(T)}`)).toEqual({ repo: 'app-admin', madeAt: T })
  expect(folderName(`app-${stamp(T)}-4242`)).toEqual({ repo: 'app', madeAt: T })
  expect(folderName('notes')).toBeNull()
})

test('each relay takes the folder holding its own brief, whatever order the folders were made in', () => {
  const folders = [folder('app', T + 900, 'one'), folder('app', T + 400, 'two'), folder('..', T + 600, 'three')]
  const jobs = [launch(T, 'one'), launch(T + 100, 'two'), launch(T + 200, 'three', '..')]
  const claimed = new Set<string>()

  const picked = jobs.map(job => pickOutDir(folders, job, jobs.filter(o => o !== job), claimed))
  expect(picked).toEqual([folders[0]!.path, folders[1]!.path, folders[2]!.path])
})

test('of two relays with the same brief, the first never takes a folder made after the second launched', () => {
  const folders = [folder('app', T + 3_400, 'same')]
  const first = launch(T, 'same')
  const second = launch(T + 3_000, 'same')

  expect(pickOutDir(folders, first, [second], new Set())).toBeNull()
  expect(pickOutDir(folders, second, [first], new Set())).toBe(folders[0]!.path)
})

test('a relay whose brief could not be read takes the oldest unclaimed folder of its repo', () => {
  const folders = [folder('app-admin', T + 200, null), folder('app', T + 900, null), folder('app', T + 400, null)]
  expect(pickOutDir(folders, launch(T, null), [], new Set([folders[2]!.path]))).toBe(folders[1]!.path)
  expect(pickOutDir(folders, launch(T + 60_000, null), [], new Set())).toBeNull()
})

test('a relay launch is read for its lane, repo, out-dir and brief; other commands are not', () => {
  expect(relayLaunch(relay('codex', `--brief b.txt --cd /r/my-app --out-dir "/tmp/x y"`)))
    .toEqual({ lane: 'codex', cd: '/r/my-app', outDir: '/tmp/x y', briefPath: 'b.txt' })
  expect(relayLaunch(relay('agy', '--help'))).toBeNull()
  expect(relayLaunch('npm test')).toBeNull()
})

test('two background relays launched together each report on their own folder', async ($, on) => {
  const files = new Map([['/b/one.txt', 'fix the login'], ['/b/two.txt', 'add the tests']])
  const { clock, toasts } = await startSession($, on, files)
  await $.tool.call({ tool: 'Bash', command: relay('agy', '--brief /b/one.txt --cd /r/app'), run_in_background: true })
  await $.tool.call({ tool: 'Bash', command: relay('codex', '--brief /b/two.txt --cd /r/app'), run_in_background: true })

  // codex's relay made its folder first, and finished
  const codexDir = `/t/delegate-relay/app-${stamp(T + 300)}`
  files.set(`${codexDir}/brief.txt`, 'add the tests')
  files.set(`${codexDir}/result.json`, JSON.stringify({ status: 'completed', touchedFiles: ['a', 'b'] }))
  files.set(`/t/delegate-relay/app-${stamp(T + 700)}/brief.txt`, 'fix the login')
  await clock.advance(5_000)

  expect(toasts).toEqual(['codex finished: completed, 2 files'])
  const pane = await openPane($)
  expect(await pane.find({ type: 'Text', text: /running/ })).toBeDefined()
})

test('a relay waiting on a permission prompt stays running past the never-started wait', async ($, on) => {
  const { clock } = await startSession($, on, new Map([['/b/one.txt', 'fix the login']]), clock => async () => {
    await clock.sleep(40_000)
    return { result: {} as never }
  })
  const call = $.tool.call({ tool: 'Bash', command: relay('agy', '--brief /b/one.txt --cd /r/app'), run_in_background: true })
  await clock.advance(35_000)

  const pane = await openPane($)
  expect(await pane.find({ type: 'Text', text: /running/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /lost/ })).toBeUndefined()
  await clock.advance(10_000)
  await call
})

test('a relay given a brief file that does not exist is marked failed at once', async ($, on) => {
  await startSession($, on, new Map())
  await $.tool.call({ tool: 'Bash', command: relay('agy', '--brief /b/missing.txt --cd /r/app'), run_in_background: true })

  const pane = await openPane($)
  expect(await pane.find({ type: 'Text', text: /failed/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /running/ })).toBeUndefined()
})

test('a relay with no folder after the wait reads lost, and comes back when its folder shows up', async ($, on) => {
  const files = new Map([['/b/one.txt', 'fix the login']])
  const { clock, toasts } = await startSession($, on, files)
  await $.tool.call({ tool: 'Bash', command: relay('agy', '--brief /b/one.txt --cd ..'), run_in_background: true })
  await clock.advance(35_000)

  const lost = await openPane($)
  expect(await lost.find({ type: 'Text', text: /lost/ })).toBeDefined()
  await lost.unmount()

  // `--cd ..` names the folder after the parent repo, not '..'; the brief still finds it
  const dir = `/t/delegate-relay/r-${stamp(T + 36_000)}`
  files.set(`${dir}/brief.txt`, 'fix the login')
  files.set(`${dir}/result.json`, JSON.stringify({ status: 'completed', touchedFiles: [] }))
  await clock.advance(5_000)

  expect(toasts).toEqual(['agy finished: completed, 0 files'])
})

test('a relay that errors in the foreground is marked failed, not left running', async ($, on) => {
  await startSession($, on, new Map(), () => () => ({ result: {} as never, isError: true }))
  await $.tool.call({ tool: 'Bash', command: relay('codex', '--brief missing.txt --cd /r/app') })

  const pane = await openPane($)
  expect(await pane.find({ type: 'Text', text: /failed/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /running/ })).toBeUndefined()
})
