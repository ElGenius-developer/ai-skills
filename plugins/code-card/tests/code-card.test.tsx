import { expect, test } from 'claude-code/testing'

const reply = (text: string) =>
  ({
    plugin: 'code-card',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
  }) as const

test('a fenced block draws in a card whose Copy puts the code on the clipboard', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...reply('Run this:\n\n```bash\nls -la\necho hi\n```\n\nDone.'), surface })
    expect((await ui.find({ type: 'Text', text: /bash/ }))?.text).toBe('bash')
    await ui.press({ key: 'copy-1-14' })
    await ui.unmount()
  }

  expect(copied).toEqual(['ls -la\necho hi', 'ls -la\necho hi', 'ls -la\necho hi', 'ls -la\necho hi'])
})

test('an untagged block keeps its first line in the card and in Copy', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))

  const ui = await $.ui.mount({ ...reply('```\ncd backend\nphp artisan test\n```'), surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^code$/ }))?.text).toBe('code')
  await ui.press({ key: 'copy-0-27' })
  await ui.unmount()

  expect(copied).toEqual(['cd backend\nphp artisan test'])
})

test('a reply without code is left to the engine', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...reply('No code here.'), surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('the cards go inside a bubble another plugin draws around the engine', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box borderStyle="round">
        <Text>Claude</Text>
        {{ type: 'engine', ref: 0 }}
      </Box>
    )
  })

  const ui = await $.ui.mount({ ...reply('```bash\nls\n```'), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Claude/ }))?.text).toBe('Claude')
  expect((await ui.find({ type: 'Text', text: /bash/ }))?.text).toBe('bash')
  await ui.unmount()
})

test('the cards replace a Markdown of the reply that a bubble above it drew', async ($, on) => {
  const text = '```bash\nls\n```'
  on('ui.render', ($, e) => {
    const { Box, Text, Markdown } = $.ui.resolve(e)
    return (
      <Box borderStyle="round">
        <Text>Claude</Text>
        <Markdown text={text} />
      </Box>
    )
  })

  const ui = await $.ui.mount({ ...reply(text), surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /Claude/ }))?.text).toBe('Claude')
  expect((await ui.find({ type: 'Text', text: /bash/ }))?.text).toBe('bash')
  await ui.unmount()
})
