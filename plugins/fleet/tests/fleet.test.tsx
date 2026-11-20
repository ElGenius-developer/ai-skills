import { test, expect, mock } from 'claude-code/testing'
import type { TestOn } from 'claude-code/testing'

import { relayLaunch, withOutDir } from '../hooks/parse'

type Engine = Parameters<Parameters<typeof test>[1]>[0]
type Clock = ReturnType<typeof mock.clock>

// A disk the plugin reads through $.fs: every key is a file path
function disk(on: TestOn, files: Map<string, string>) {
  const isDir = (path: string) => [...files.keys()].some(f => f.startsWith(`${path}/`))
  on('fs.exists', (_, e) => ({ value: files.has(e.path) || isDir(e.path) }))
  on('fs.read', (_, e) => (files.has(e.path) ? { value: files.get(e.path)! } : { deny: `ENOENT: ${e.path}` }))
}

/** A session whose Bash calls are recorded as the shell would get them; `run` stands for the shell. */
async function startSession(
  $: Engine,
  on: TestOn,
  run: (clock: Clock) => () => unknown = () => () => ({ result: {} as never }),
) {
  const clock = mock.clock(on, { now: 0 })
  const files = new Map<string, string>()
  const commands: string[] = []
  const shell = run(clock)
  on('tool.call', async (_, e) => {
    commands.push((e as { command: string }).command)
    return shell() as never
  })
  mock.env(on, { TMPDIR: '/t' })
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
  return { clock, files, commands, toasts }
}

const RELAY = (lane: string) => `node ~/.agents/skills/${lane}-delegate/scripts/relay.mjs`
const outDirOf = (command: string) => command.match(/--out-dir (\S+)/)?.[1]
const openPane = ($: Engine) =>
  $.ui.mount({ plugin: 'fleet', surface: 'terminal', component: 'Pane', requestId: 'fleet', props: { bodyColumns: 80 } as never })

test('a relay launch is read for its lane, repo and out-dir; help and other commands are not', () => {
  expect(relayLaunch(`${RELAY('codex')} --brief b.txt --cd /r/my-app --out-dir "/tmp/x y"`))
    .toEqual({ lane: 'codex', cd: '/r/my-app', outDir: '/tmp/x y' })
  expect(relayLaunch(`cat b.txt | ${RELAY('kimi')}`)).toEqual({ lane: 'kimi', cd: null, outDir: null })
  expect(relayLaunch(`${RELAY('agy')} --help`)).toBeNull()
  expect(relayLaunch('npm test')).toBeNull()
})

test('the out-dir goes right after the relay script, and only where it needs no quoting', () => {
  expect(withOutDir(`${RELAY('agy')} --brief b.md && echo ok`, '/t/d'))
    .toBe(`${RELAY('agy')} --out-dir /t/d --brief b.md && echo ok`)
  expect(withOutDir(`${RELAY('agy')}`, '/t/d')).toBe(`${RELAY('agy')} --out-dir /t/d`)
  expect(withOutDir(`${RELAY('agy')} --brief b.md`, '/t/my dir')).toBeNull()
  expect(withOutDir(`bash -c 'node x/agy-delegate/scripts/relay.mjs' --brief b`, '/t/d')).toBeNull()
})

test('each relay runs with an out-dir of its own, and an explicit one is left alone', async ($, on) => {
  const { commands } = await startSession($, on)
  await $.tool.call({ tool: 'Bash', command: `${RELAY('agy')} --brief /b/same.md`, run_in_background: true })
  await $.tool.call({ tool: 'Bash', command: `${RELAY('codex')} --brief /b/same.md`, run_in_background: true })
  await $.tool.call({ tool: 'Bash', command: `${RELAY('kimi')} --brief /b/same.md --out-dir /o/mine` })

  const [agy, codex] = commands.map(outDirOf)
  expect(agy).toMatch(/^\/t\/delegate-relay\/fleet-/)
  expect(codex).toMatch(/^\/t\/delegate-relay\/fleet-/)
  expect(agy).not.toBe(codex)
  expect(commands[2]).toBe(`${RELAY('kimi')} --brief /b/same.md --out-dir /o/mine`)
})

test('two relays launched together with one brief each report on their own run', async ($, on) => {
  const { clock, files, commands, toasts } = await startSession($, on)
  await $.tool.call({ tool: 'Bash', command: `${RELAY('agy')} --brief /b/same.md`, run_in_background: true })
  await $.tool.call({ tool: 'Bash', command: `${RELAY('codex')} --brief /b/same.md`, run_in_background: true })
  const [agyDir, codexDir] = commands.map(outDirOf)

  // agy is mid-write of its result; codex finished
  files.set(`${agyDir}/result.json`, '{"status":')
  files.set(`${codexDir}/result.json`, JSON.stringify({ status: 'completed', touchedFiles: ['a', 'b'] }))
  await clock.advance(5_000)

  expect(toasts).toEqual(['codex finished: completed, 2 files'])
  const pane = await openPane($)
  expect(await pane.find({ type: 'Text', text: /running/ })).toBeDefined()
})

test('a relay waiting on a permission prompt stays running past the never-started wait', async ($, on) => {
  const { clock } = await startSession($, on, clock => async () => {
    await clock.sleep(40_000)
    return { result: {} as never }
  })
  const call = $.tool.call({ tool: 'Bash', command: `${RELAY('agy')} --brief /b/one.md`, run_in_background: true })
  await clock.advance(35_000)

  const pane = await openPane($)
  expect(await pane.find({ type: 'Text', text: /running/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /failed/ })).toBeUndefined()
  await clock.advance(10_000)
  await call
})

test('a brief written in the same command as the launch is not taken for a failure', async ($, on) => {
  const { clock, files, commands } = await startSession($, on)
  await $.tool.call({
    tool: 'Bash',
    command: `cat > /b/new.md <<'EOF'\nfix it\nEOF\n${RELAY('agy')} --brief /b/new.md`,
    run_in_background: true,
  })
  files.set(`${outDirOf(commands[0]!)}/brief.txt`, 'fix it')
  await clock.advance(35_000)

  const pane = await openPane($)
  expect(await pane.find({ type: 'Text', text: /running/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /failed/ })).toBeUndefined()
})

test('a background relay that never makes its out-dir is marked failed', async ($, on) => {
  const { clock, toasts } = await startSession($, on)
  await $.tool.call({ tool: 'Bash', command: `${RELAY('agy')} --brief /b/missing.md --bad-flag`, run_in_background: true })
  await clock.advance(25_000)
  expect(toasts).toEqual([])
  await clock.advance(10_000)

  expect(toasts).toEqual(['agy finished: failed'])
  const pane = await openPane($)
  expect(await pane.find({ type: 'Text', text: /failed/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /running/ })).toBeUndefined()
})

test('a relay that errors in the foreground is marked failed, not left running', async ($, on) => {
  await startSession($, on, () => () => ({ result: {} as never, isError: true }))
  await $.tool.call({ tool: 'Bash', command: `${RELAY('codex')} --brief missing.txt --cd /r/app` })

  const pane = await openPane($)
  expect(await pane.find({ type: 'Text', text: /failed/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /running/ })).toBeUndefined()
})
