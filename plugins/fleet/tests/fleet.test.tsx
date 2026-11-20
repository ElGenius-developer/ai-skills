import { test, expect, mock } from 'claude-code/testing'

import { relayLaunch } from '../hooks/parse'

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
