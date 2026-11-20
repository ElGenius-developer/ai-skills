import type { EngineInterface, Register } from 'claude-code'

function toSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>|~]/g, ' ')
    .replace(/^\s*[-:]{3,}\s*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function stop($: EngineInterface): Promise<void> {
  await $.process.run(['pkill', '-f', 'speak-reply/bin/speak.py']).catch(() => undefined)
  await $.process.run(['killall', 'afplay']).catch(() => undefined)
}

async function speak($: EngineInterface, markdown: string): Promise<void> {
  const text = toSpeech(markdown)
  if (!text) {
    return
  }
  await stop($)
  const root = $.plugin.root
  void (async () => {
    const child = $.process.spawn({ argv: [`${root}/.venv/bin/python`, `${root}/bin/speak.py`], input: text })
    let isWarned = false
    for await (const { text: output } of child) {
      if (!isWarned && output.includes('FALLBACK')) {
        isWarned = true
        $.ui.toast(
          output.includes('ZeroGPU')
            ? 'Egyptian voice: free daily quota used up, reading with Salma instead.'
            : 'Egyptian voice unavailable, reading with Salma instead.',
        )
      }
    }
  })().catch(() => $.ui.toast('Speech failed to start.'))
}

export const register: Register = on => {
  let lastAnswer = ''

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'speak', description: 'Read the last reply aloud' })
    await $.command.register({ name: 'stop-speak', description: 'Stop reading aloud' })

    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.answer) {
      lastAnswer = e.answer
    }

    return next(e)
  })

  on('command.run', { command: 'speak' }, async $ => {
    if (!lastAnswer) {
      return { text: 'No reply to read yet.' }
    }
    await speak($, lastAnswer)

    return { text: 'Reading the last reply aloud. /stop-speak to stop.' }
  })

  on('command.run', { command: 'stop-speak' }, async $ => {
    await stop($)

    return { text: 'Stopped.' }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const row = await next(e)
    if (e.props.isSummary || !e.props.text.trim()) {
      return row
    }
    const { Box, Button } = $.ui.resolve(e)
    const id = String(e.props.text.length) + e.props.text.slice(0, 24)

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Button key={`speak-${id}`} label={'\u{1F50A}'} plain dimColor onPress={() => void speak($, e.props.text)} />
          <Button key={`stop-${id}`} label={'\u{23F9}'} plain dimColor onPress={() => void stop($)} />
        </Box>
        {row}
      </Box>
    )
  })
}
