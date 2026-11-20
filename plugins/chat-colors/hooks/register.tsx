import type { Register, RenderElement } from 'claude-code'

function replaceEngineNode(tree: unknown, replacement: RenderElement): unknown {
  if (typeof tree !== 'object' || tree === null) return tree
  const node = tree as { type?: unknown; children?: unknown }
  if (node.type === 'engine') return replacement
  if (!Array.isArray(node.children)) return tree
  return { ...node, children: node.children.map(child => replaceEngineNode(child, replacement)) }
}

export const register: Register = (on, options) => {
  const userColor = String(options.userColor ?? 'cyan')
  const claudeColor = String(options.claudeColor ?? 'claude')

  // Calls next so plugins beneath (message-rail's fold button and position
  // tracking) still run; only the engine's own node becomes the colored prompt.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    // ctrl+o expands a row: keep the engine's full view there, and leave
    // task notifications and peer messages as the engine draws them.
    if (e.props.isExpanded || e.props.origin.kind !== 'composer') return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const body = replaceEngineNode(await next(e), <Text color={userColor}>{e.props.text}</Text>)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={userColor} paddingX={1} marginTop={1}>
        <Text bold color={userColor}>You</Text>
        {body as RenderElement}
      </Box>
    )
  })

  // Wrap what the plugins beneath draw (code-card's code blocks). The engine's own
  // node is swapped for Markdown: the editor surfaces draw it outside any Box.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)

    const { Box, Text, Markdown } = $.ui.resolve(e)
    const body = replaceEngineNode(await next(e), <Markdown text={e.props.text} />)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={claudeColor} paddingX={1}>
        {e.props.isFirstOfReply && <Text bold color={claudeColor}>Claude</Text>}
        {body as RenderElement}
      </Box>
    )
  })
}
