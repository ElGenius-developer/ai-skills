import { test, expect, mock } from 'claude-code/testing'

import { pickOutDir, relayLaunch } from '../hooks/parse'

const T = Date.parse('2026-11-20T10:00:00.000Z')
const dir = (name: string) => ({ name, kind: 'dir' as const, mtimeMs: 0 })

test('two relays in one repo each settle on their own out-dir, never a sibling repo', () => {
  const entries = [
    dir('app-2026-11-20T10-00-04-400Z'),
    dir('app-2026-11-20T10-00-00-400Z'),
    dir('app-admin-2026-11-20T10-00-00-200Z'),
  ]
  const claimed = new Set<string>()
  const first = pickOutDir('/t', entries, 'app', T, [T + 4_000], claimed)
  claimed.add(first!)
  const second = pickOutDir('/t', entries, 'app', T + 4_000, [T], claimed)

  expect([first, second]).toEqual(['/t/app-2026-11-20T10-00-00-400Z', '/t/app-2026-11-20T10-00-04-400Z'])
  expect(pickOutDir('/t', entries, 'app', T + 60_000, [], new Set())).toBeNull()
  expect(pickOutDir('/t', [dir('app-admin-2026-11-20T10-00-00-200Z')], 'app', T, [], new Set())).toBeNull()
})

test('a relay that never started does not take the folder of the relay launched after it', () => {
  const entries = [dir('app-2026-11-20T10-00-03-400Z')]

  expect(pickOutDir('/t', entries, 'app', T, [T + 3_000], new Set())).toBeNull()
  expect(pickOutDir('/t', entries, 'app', T + 3_000, [T], new Set())).toBe('/t/app-2026-11-20T10-00-03-400Z')
})

test('a relay launched in the background that never makes its folder is marked failed', async ($, on) => {
  const clock = mock.clock(on, { now: T })
  mock.env(on, { TMPDIR: '/t' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'delegations' } }))
  on('fs.exists', () => ({ value: false }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} as never }))
  await $.session.start({ cwd: '/r/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'Bash',
    command: 'node ~/.agents/skills/agy-delegate/scripts/relay.mjs --brief missing.txt --cd /r/app',
    run_in_background: true,
  })
  await clock.advance(35_000)

  const pane = await $.ui.mount({
    plugin: 'fleet', surface: 'terminal', component: 'Pane', requestId: 'fleet',
    props: { bodyColumns: 80 } as never,
  })
  expect(await pane.find({ type: 'Text', text: /failed/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /running/ })).toBeUndefined()
})

test('a relay launch is read for its lane, repo and out-dir; other commands are not', () => {
  expect(relayLaunch(`node ~/.agents/skills/codex-delegate/scripts/relay.mjs --brief b.txt --cd /r/my-app --out-dir "/tmp/x y"`))
    .toEqual({ lane: 'codex', cd: '/r/my-app', outDir: '/tmp/x y' })
  expect(relayLaunch('node ~/.agents/skills/agy-delegate/scripts/relay.mjs --help')).toBeNull()
  expect(relayLaunch('npm test')).toBeNull()
})

test('a launched delegation shows as running in the pane', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  on('tool.call', () => ({ result: {} as never }))
  await $.tool.call({ tool: 'Bash', command: 'node ~/.agents/skills/agy-delegate/scripts/relay.mjs --brief b.txt --cd /r/app' })

  const pane = await $.ui.mount({
    plugin: 'fleet', surface: 'terminal', component: 'Pane', requestId: 'fleet',
    props: { bodyColumns: 80 } as never,
  })
  expect(await pane.find({ type: 'Text', text: /^agy/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /running/ })).toBeDefined()
})

test('a relay that errors in the foreground is marked failed, not left running', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  on('tool.call', () => ({ result: {} as never, isError: true }))
  await $.tool.call({ tool: 'Bash', command: 'node ~/.agents/skills/codex-delegate/scripts/relay.mjs --brief missing.txt --cd /r/app' })

  const pane = await $.ui.mount({
    plugin: 'fleet', surface: 'terminal', component: 'Pane', requestId: 'fleet',
    props: { bodyColumns: 80 } as never,
  })
  expect(await pane.find({ type: 'Text', text: /failed/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /running/ })).toBeUndefined()
})
