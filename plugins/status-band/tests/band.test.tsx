import { test, expect } from 'claude-code/testing'

import { ciOf, contextLine, gitLine, isVerifyCommand } from '../hooks/parse'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { bodyRows: 9, top: 0 } }

test('edits show as unverified until a passing test run clears them', async ($, on) => {
  on('tool.call', () => ({ result: {} as never }))
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.php', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/r/b.php', content: 'x' })

  const band = await $.ui.mount({ plugin: 'status-band', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
  expect(await band.find({ type: 'Text', text: /2 files edited, not verified/ })).toBeDefined()

  await $.tool.call({ tool: 'Bash', command: 'vendor/bin/phpunit' })
  expect(await band.find({ type: 'Text', text: /✓ verified/ })).toBeDefined()
})

test('CI rollup reads failures first, then all-green, else pending', () => {
  expect(ciOf([{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }])).toBe('fail')
  expect(ciOf([{ conclusion: 'SUCCESS' }, { state: 'SUCCESS' }])).toBe('pass')
  expect(ciOf([{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }])).toBe('pending')
})

test('the branch line shows the PR, its CI and how far behind the default branch', () => {
  expect(gitLine({ branch: 'feat/x', base: 'main', behind: 3, pr: { number: 42, ci: 'pass' } })).toBe('⎇ feat/x · PR #42 ✓ CI · 3 behind main')
})

test('only running a check counts as verifying, not reading its config', () => {
  for (const command of ['vendor/bin/phpunit', 'cd front && npx vitest run', 'php artisan test --filter=Visit', 'npm run lint', './vendor/bin/pint --test'])
    expect([command, isVerifyCommand(command)]).toEqual([command, true])
  for (const command of ['cat vitest.config.ts', 'grep -n vitest package.json', 'cat .eslintrc.json', 'cat pytest.ini', 'ls vendor/bin/phpunit'])
    expect([command, isVerifyCommand(command)]).toEqual([command, false])
})

test('a check whose exit code is hidden or that runs nothing does not count as verifying', () => {
  for (const command of ['php artisan test 2>&1 | tail -20', 'npm test || true', 'vendor/bin/phpunit; echo done', 'php artisan test --filter=Foo\nphp artisan test --filter=Bar', 'npm test & wait', 'tsc --version', 'pytest --collect-only', 'pytest --co', 'npx vitest --help'])
    expect([command, isVerifyCommand(command)]).toEqual([command, false])
  expect(isVerifyCommand('php artisan test 2>&1')).toBe(true)
})

test('the context line shows tokens in thousands and the share of the window', () => {
  expect(contextLine({ tokens: 120_400, window: 200_000 })).toBe('ctx 120k · 60%')
  expect(contextLine({ tokens: 800, window: 0 })).toBe('ctx 800')
})

test('a compaction drops the context figure at once, before the next turn', async ($, on) => {
  let tokens = 150_000
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 200_000 }, rateLimits: [], cost: { usd: 3 } } }))
  on('turn.complete', () => ({ text: '' }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] as never, tokensBefore: 150_000, tokensAfter: 20_000 }))
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as never)
  const band = await $.ui.mount({ plugin: 'status-band', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
  expect((await band.find({ type: 'Text', text: /ctx/ }))?.text).toBe('ctx 150k · 75%')

  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  expect((await band.find({ type: 'Text', text: /ctx/ }))?.text).toBe('ctx 20k · 10%')
})
