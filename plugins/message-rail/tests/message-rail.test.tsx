import { expect, mock, test } from 'claude-code/testing'
import { isLong, parseTranscript, preview, projectSlug } from '../hooks/register.tsx'

const LONG = Array.from({ length: 8 }, (_, i) => `line ${i + 1} of a long message`).join('\n')

const pane = (surface: 'terminal' | 'desktop' | 'vscode') =>
  ({
    plugin: 'message-rail',
    component: 'Pane',
    requestId: 'message-rail',
    surface,
    viewport: { columns: 160, rows: 40, isFullscreen: true },
    props: {
      title: 'Messages',
      isFocused: false,
      bodyColumns: 36,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  }) as const

const userRow = (id: string, text: string, onScreen: unknown = null) =>
  ({
    plugin: 'message-rail',
    component: 'UserMessage',
    requestId: id,
    surface: 'terminal',
    viewport: { columns: 120, rows: 40, isFullscreen: true },
    props: { text, origin: { kind: 'composer' }, isExpanded: false, onScreen },
  }) as const

const engine = { type: 'Text', props: {}, children: ['drawn by Claude Code'] }

test('parseTranscript keeps typed prompts in order and skips tool results, meta rows and command echoes', () => {
  const jsonl = [
    { type: 'user', uuid: 'a', message: { role: 'user', content: [{ type: 'text', text: 'first' }] } },
    { type: 'assistant', uuid: 'b', message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }] } },
    { type: 'user', uuid: 'c', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } },
    { type: 'user', uuid: 'd', isMeta: true, message: { role: 'user', content: 'reminder' } },
    { type: 'user', uuid: 'e', message: { role: 'user', content: '<command-name>/clear</command-name>' } },
    { type: 'user', uuid: 'f', message: { role: 'user', content: 'second' } },
  ]
    .map(r => JSON.stringify(r))
    .join('\n')
  expect(parseTranscript(jsonl + '\nnot json\n')).toEqual([
    { id: 'a', text: 'first', reply: 'reply' },
    { id: 'f', text: 'second' },
  ])
})

test('helpers fold text, judge length and name the project folder', () => {
  expect(preview('a\n  b   c', 10)).toBe('a b c')
  expect(preview('abcdefghij', 5)).toBe('abcd…')
  expect(isLong('short')).toBe(false)
  expect(isLong(LONG)).toBe(true)
  expect(projectSlug('/Users/me/my.app')).toBe('-Users-me-my-app')
})

test('the rail lists each typed prompt, and each dot jumps to its own message', async ($, on) => {
  mock.clock(on)
  // The test kit has no transcript to scroll, so the jump reports why in a toast
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => engine)

  const first = await $.ui.mount(userRow('m1', 'Fix the login bug', { first: 0, last: 1 }))
  await first.unmount()
  const second = await $.ui.mount(userRow('m2', 'Now add tests'))
  await second.unmount()

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount(pane(surface))
    // m1 is on screen, m2 is the newest: each gets its own tick, and its card names the prompt
    expect(await ui.find({ type: 'Text', text: '───' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '────' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Fix the login bug/ })).toBeDefined()
    await ui.press({ key: 'jump-m2' })
    await ui.unmount()
  }
  expect(toasts.length).toBe(3)
  expect(toasts[0]).toMatch(/^Couldn't jump to message 2: .*ui\.scroll/)
})

test('the newest prompt\'s card shows Claude\'s latest reply', async ($, on) => {
  mock.clock(on)
  on('ui.render', () => engine)
  const row = await $.ui.mount(userRow('m1', 'Retake the screenshots'))
  await row.unmount()
  await $.session.append({
    door: 'response',
    origin: { kind: 'model', model: 'claude-opus-5-5' },
    uuid: 'r1',
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'agy is now retaking the 10 screens' }] },
  })
  const ui = await $.ui.mount(pane('vscode'))
  expect(await ui.find({ type: 'Text', text: /agy is now retaking/ })).toBeDefined()
  await ui.unmount()
})

test('a long message folds to one line and unfolds back to Claude Code\'s drawing', async ($, on) => {
  mock.clock(on)
  on('ui.render', () => engine)

  const ui = await $.ui.mount(userRow('m1', LONG))
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  await ui.press({ key: 'fold-user-m1' })
  await ui.unmount()

  const folded = await $.ui.mount(userRow('m1', LONG))
  expect(await folded.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeUndefined()
  expect(await folded.find({ type: 'Text', text: /\(8 lines\)/ })).toBeDefined()
  await folded.press({ key: 'fold-user-m1' })
  await folded.unmount()

  const back = await $.ui.mount(userRow('m1', LONG))
  expect(await back.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  await back.unmount()
})

test('"Fold Claude" in the rail folds every long reply', async ($, on) => {
  mock.clock(on)
  on('ui.render', () => engine)

  const rail = await $.ui.mount(pane('terminal'))
  await rail.press({ key: 'all-assistant' })
  await rail.unmount()

  const reply = await $.ui.mount({
    plugin: 'message-rail',
    component: 'AssistantMessage',
    requestId: 'r1',
    surface: 'terminal',
    viewport: { columns: 120, rows: 40, isFullscreen: true },
    props: { text: LONG, isFirstOfReply: true },
  })
  expect(await reply.find({ type: 'Text', text: /Claude: line 1/ })).toBeDefined()
  expect(await reply.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeUndefined()
  await reply.unmount()
})

test('a short message is left to Claude Code', async ($, on) => {
  mock.clock(on)
  on('ui.render', () => engine)
  const ui = await $.ui.mount(userRow('m1', 'hi'))
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  expect(await ui.find({ key: 'fold-user-m1' })).toBeUndefined()
  await ui.unmount()
})
