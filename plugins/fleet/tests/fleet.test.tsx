import { test, expect, mock } from 'claude-code/testing'

import { pickOutDir, relayLaunch } from '../hooks/parse'

test('two relays in one repo each settle on their own out-dir, never a sibling repo', () => {
  const dir = (name: string, mtimeMs: number) => ({ name, kind: 'dir' as const, mtimeMs })
  const entries = [
    dir('app-2026-11-20T10-00-05-000Z', 10_005),
    dir('app-2026-11-20T10-00-01-000Z', 10_001),
    dir('app-admin-2026-11-20T10-00-00-000Z', 10_000),
  ]
  const claimed = new Set<string>()
  const first = pickOutDir('/t', entries, 'app', 10_000, claimed)
  claimed.add(first!)
  const second = pickOutDir('/t', entries, 'app', 10_004, claimed)

  expect([first, second]).toEqual(['/t/app-2026-11-20T10-00-01-000Z', '/t/app-2026-11-20T10-00-05-000Z'])
  expect(pickOutDir('/t', entries, 'app', 20_000, new Set())).toBeNull()
  expect(pickOutDir('/t', [dir('app-admin-2026-11-20T10-00-00-000Z', 10_000)], 'app', 10_000, new Set())).toBeNull()
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
