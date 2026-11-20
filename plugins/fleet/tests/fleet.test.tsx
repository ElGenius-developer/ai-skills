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

const rewrite = (command: string, dir = '/t/d') => {
  const launch = relayLaunch(command)
  return launch && withOutDir(command, launch.insertAt, dir)
}

test('a relay launch is read for its lane, repo and out-dir; help and other commands are not', () => {
  expect(relayLaunch(`${RELAY('codex')} --brief b.txt --cd /r/my-app --out-dir "/tmp/x y"`))
    .toMatchObject({ lane: 'codex', cd: '/r/my-app', outDir: '/tmp/x y' })
  expect(relayLaunch(`cat b.txt | ${RELAY('kimi')}`)).toMatchObject({ lane: 'kimi', cd: null, outDir: null })
  expect(relayLaunch(`${RELAY('agy')} --help`)).toBeNull()
  expect(relayLaunch('npm test')).toBeNull()
})

test('reading or grepping the relay script is not a launch', () => {
  expect(relayLaunch('sed -n 1,50p ~/.agents/skills/agy-delegate/scripts/relay.mjs')).toBeNull()
  expect(relayLaunch('grep -n brief ~/.agents/skills/agy-delegate/scripts/relay.mjs')).toBeNull()
})

test('the out-dir goes right after the relay script, quoted path or not', () => {
  expect(rewrite(`${RELAY('agy')} --brief b.md && echo ok`)).toBe(`${RELAY('agy')} --out-dir /t/d --brief b.md && echo ok`)
  expect(rewrite(`node "/h/.agents/skills/agy-delegate/scripts/relay.mjs" --brief b.md`))
    .toBe(`node "/h/.agents/skills/agy-delegate/scripts/relay.mjs" --out-dir /t/d --brief b.md`)
  expect(rewrite(`cd /r/web && NO_COLOR=1 ${RELAY('codex')} --brief b.md`))
    .toBe(`cd /r/web && NO_COLOR=1 ${RELAY('codex')} --out-dir /t/d --brief b.md`)
  expect(rewrite(`${RELAY('agy')} --brief b.md`, '/t/my dir')).toBeNull()
})

test('a heredoc brief that names the relay or --out-dir is left as written', () => {
  const brief = `cat > /b/new.md <<'EOF'\nRead scripts/relay.mjs first; ignore -h\nnode x/agy-delegate/scripts/relay.mjs --out-dir here\nEOF\n`
  const launch = `${RELAY('agy')} --brief /b/new.md`
  expect(relayLaunch(brief + launch)).toMatchObject({ lane: 'agy', outDir: null })
  expect(rewrite(brief + launch)).toBe(`${brief}${RELAY('agy')} --out-dir /t/d --brief /b/new.md`)
  expect(relayLaunch(`cat <<< "node x/agy-delegate/scripts/relay.mjs"`)).toBeNull()
})

test('a relay named inside quoted text is not a launch', () => {
  expect(relayLaunch(`git commit -m "docs: launch form\n${RELAY('agy')} --brief b.md"`)).toBeNull()
  expect(relayLaunch(`echo "done; ${RELAY('agy')} --brief b.md"`)).toBeNull()
})

test('a quoted separator in an argument does not hide the flags after it', () => {
  expect(relayLaunch(`${RELAY('agy')} --brief "notes & fixes.md" --cd /r/web --out-dir /o/mine`))
    .toMatchObject({ cd: '/r/web', outDir: '/o/mine' })
  expect(relayLaunch(`${RELAY('agy')} --brief "a --out-dir b.md"`)).toMatchObject({ outDir: null })
  expect(rewrite(`FOO="a b" ${RELAY('agy')} --brief b.md`)).toBe(`FOO="a b" ${RELAY('agy')} --out-dir /t/d --brief b.md`)
})

test('a launch split over lines with a backslash keeps its flags', () => {
  expect(relayLaunch(`${RELAY('agy')} \\\n  --cd /r/web`)).toMatchObject({ cd: '/r/web' })
  expect(rewrite(`${RELAY('agy')} \\\n  --brief b.md`)).toBe(`${RELAY('agy')} --out-dir /t/d \\\n  --brief b.md`)
})

test('an apostrophe in a comment or an ANSI-C string opens no quote', () => {
  expect(relayLaunch(`# it's slow\ngc -m "x" && echo 'a; ${RELAY('agy')} --brief b.md'`)).toBeNull()
  expect(relayLaunch(`# Launch agy (it's slow)\n${RELAY('agy')} --brief b.md`)).toMatchObject({ lane: 'agy' })
  expect(relayLaunch(`echo $'it\\'s' && ${RELAY('agy')} --brief b.md`)).toMatchObject({ lane: 'agy' })
  expect(relayLaunch(`echo a#b && ${RELAY('agy')} --brief b.md`)).toMatchObject({ lane: 'agy' })
})

test('a heredoc tag with a dash still hides its body', () => {
  const body = `node x/codex-delegate/scripts/relay.mjs --brief y`
  expect(relayLaunch(`cat > b.md <<'END-X'\n${body}\nEND-X\n${RELAY('agy')} --brief b.md`)).toMatchObject({ lane: 'agy' })
})

test('heredocs opened as <<\\EOF or closed with CRLF are skipped, and a quoted << opens none', () => {
  const body = `node x/agy-delegate/scripts/relay.mjs --out-dir x`
  expect(relayLaunch(`cat > b.md <<\\EOF\n${body}\nEOF\n${RELAY('agy')} --brief b.md`)).toMatchObject({ outDir: null })
  expect(relayLaunch(`cat > b.md <<EOF\r\n${body}\r\nEOF\r\n${RELAY('agy')} --brief b.md`)).toMatchObject({ outDir: null })
  expect(relayLaunch(`echo "a << b"\n${RELAY('agy')} --brief b.md`)).toMatchObject({ lane: 'agy' })
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
    command: `cat > /b/new.md <<'EOF'\nfix it, see relay.mjs\nEOF\n${RELAY('agy')} --brief /b/new.md`,
    run_in_background: true,
  })
  expect(commands[0]).toContain('fix it, see relay.mjs\nEOF')
  files.set(`${outDirOf(commands[0]!)}/brief.txt`, 'fix it, see relay.mjs')
  await clock.advance(35_000)

  const pane = await openPane($)
  expect(await pane.find({ type: 'Text', text: /running/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /failed/ })).toBeUndefined()
})

test('a background relay with no out-dir in time reads lost, and settles if it starts late', async ($, on) => {
  const { clock, files, commands, toasts } = await startSession($, on)
  await $.tool.call({ tool: 'Bash', command: `npm ci && ${RELAY('agy')} --brief /b/one.md`, run_in_background: true })
  await clock.advance(35_000)

  const lost = await openPane($)
  expect(await lost.find({ type: 'Text', text: /lost/ })).toBeDefined()
  expect(await lost.find({ type: 'Text', text: /running/ })).toBeUndefined()
  await lost.unmount()
  expect(toasts).toEqual([])

  files.set(`${outDirOf(commands[0]!)}/result.json`, JSON.stringify({ status: 'completed', touchedFiles: ['a'] }))
  await clock.advance(5_000)
  expect(toasts).toEqual(['agy finished: completed, 1 files'])
})

test('"Clear finished" keeps a lost relay until it has waited long, and a late start still settles', async ($, on) => {
  let isForegroundError = false
  const { clock, files, commands, toasts } = await startSession($, on, () => () => ({ result: {} as never, isError: isForegroundError }))
  await $.tool.call({ tool: 'Bash', command: `npm ci && ${RELAY('agy')} --brief /b/one.md`, run_in_background: true })
  isForegroundError = true
  await $.tool.call({ tool: 'Bash', command: `${RELAY('codex')} --brief /b/two.md` })
  await clock.advance(35_000)

  const early = await openPane($)
  await early.press({ key: 'clear' })
  expect(await early.find({ type: 'Text', text: /lost/ })).toBeDefined()
  expect(await early.find({ type: 'Text', text: /^codex/ })).toBeUndefined()
  await early.unmount()

  // Tests that ran 20 minutes before the relay started
  await clock.advance(20 * 60_000)
  files.set(`${outDirOf(commands[0]!)}/result.json`, JSON.stringify({ status: 'completed', touchedFiles: [] }))
  await clock.advance(5_000)
  expect(toasts).toEqual(['agy finished: completed, 0 files'])
})

test('a relay lost for long can be cleared', async ($, on) => {
  const { clock } = await startSession($, on)
  await $.tool.call({ tool: 'Bash', command: `${RELAY('agy')} --brief /b/one.md --bad-flag`, run_in_background: true })
  await clock.advance(16 * 60_000)

  const pane = await openPane($)
  await pane.press({ key: 'clear' })
  expect(await pane.find({ type: 'Text', text: /lost/ })).toBeUndefined()
})

test('a relay that errors in the foreground is marked failed, not left running', async ($, on) => {
  await startSession($, on, () => () => ({ result: {} as never, isError: true }))
  await $.tool.call({ tool: 'Bash', command: `${RELAY('codex')} --brief missing.txt --cd /r/app` })

  const pane = await openPane($)
  expect(await pane.find({ type: 'Text', text: /failed/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /running/ })).toBeUndefined()
})
