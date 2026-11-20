import { test, expect } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const

test('a typed prompt is drawn as a "You" bubble', async ($, on) => {
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'chat-colors',
      surface,
      component: 'UserMessage',
      props: { text: 'hello there', origin: { kind: 'composer' }, isExpanded: false },
    })
    expect((await ui.find({ type: 'Text', text: 'You' }))?.props.color).toBe('cyan')
    expect(await ui.find({ text: 'hello there' })).toBeDefined()
  }
})

test('a plugin beneath still draws inside the "You" bubble, with the prompt in the bubble color', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Button key="fold" label="Fold" onPress={() => undefined} />
        {{ type: 'engine', ref: 0 }}
      </Box>
    )
  })
  const ui = await $.ui.mount({
    plugin: 'chat-colors',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'hello there', origin: { kind: 'composer' }, isExpanded: false },
  })
  expect(await ui.find({ type: 'Text', text: 'You' })).toBeDefined()
  expect(await ui.find({ type: 'Button', label: 'Fold' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: 'hello there' }))?.props.color).toBe('cyan')
})

test('a reply opens with a "Claude" label only on its first block', async ($, on) => {
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  for (const surface of SURFACES) {
    const first = await $.ui.mount({
      plugin: 'chat-colors', surface, component: 'AssistantMessage',
      props: { text: 'Done.', isFirstOfReply: true },
    })
    expect(await first.find({ text: 'Claude' })).toBeDefined()
    const later = await $.ui.mount({
      plugin: 'chat-colors', surface, component: 'AssistantMessage',
      props: { text: 'More.', isFirstOfReply: false },
    })
    expect(await later.find({ text: 'Claude' })).toBeUndefined()
  }
})

test('a reply bubble wraps what the plugins beneath draw', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>code card</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'chat-colors', surface: 'terminal', component: 'AssistantMessage',
    props: { text: '```bash\nls\n```', isFirstOfReply: true },
  })
  expect(await ui.find({ text: 'Claude' })).toBeDefined()
  expect(await ui.find({ text: 'code card' })).toBeDefined()
})

test('a reply with no plugin beneath draws its text inside the bubble, not beside it', async ($, on) => {
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  const ui = await $.ui.mount({
    plugin: 'chat-colors', surface: 'desktop', component: 'AssistantMessage',
    props: { text: 'Your notes are in the plan.', isFirstOfReply: false },
  })
  const bubble = await ui.find({ type: 'Box' })
  expect(JSON.stringify(bubble)).toContain('Your notes are in the plan.')
})

test('VS Code shows the colored box too', async ($, on) => {
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  const ui = await $.ui.mount({
    plugin: 'chat-colors', surface: 'vscode', component: 'AssistantMessage',
    props: { text: 'Done.', isFirstOfReply: true },
  })
  expect((await ui.find({ type: 'Box' }))?.props.borderStyle).toBe('round')
  expect(await ui.find({ text: 'Claude' })).toBeDefined()
})
