import type { Register, RenderElement } from 'claude-code'

export type Segment =
  | { kind: 'prose'; text: string }
  | { kind: 'code'; language: string; source: string }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^\n]*\n([\s\S]*?)\n {0,3}\1[`~]*[ \t]*$/gm

export function splitFences(text: string): Segment[] {
  const segments: Segment[] = []
  let cursor = 0

  for (const match of text.matchAll(FENCE)) {
    const start = match.index ?? 0
    const prose = text.slice(cursor, start)
    if (prose.trim()) {
      segments.push({ kind: 'prose', text: prose })
    }
    segments.push({ kind: 'code', language: match[2] ?? '', source: match[3] ?? '' })
    cursor = start + match[0].length
  }

  const rest = text.slice(cursor)
  if (rest.trim()) {
    segments.push({ kind: 'prose', text: rest })
  }

  return segments
}

// Another plugin (chat-colors) may wrap the reply in a bubble, holding either the
// engine's node or a Markdown of the same text; the cards take that spot so the
// bubble survives in either chain order.
export function replaceEngineNode(tree: unknown, cards: RenderElement, text?: string): unknown {
  if (typeof tree !== 'object' || tree === null) return tree
  const node = tree as { type?: unknown; props?: { text?: unknown }; children?: unknown }
  if (node.type === 'engine') return cards
  if (node.type === 'Markdown' && text !== undefined && node.props?.text === text) return cards
  if (!Array.isArray(node.children)) return tree
  return { ...node, children: node.children.map(child => replaceEngineNode(child, cards, text)) }
}

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) {
      return next(e)
    }

    const segments = splitFences(e.props.text)
    if (!segments.some(s => s.kind === 'code')) {
      return next(e)
    }

    const { Box, Text, Button, Code, Markdown } = $.ui.resolve(e)

    const cards = (
      <Box flexDirection="column" gap={1}>
        {segments.map((segment, i) =>
          segment.kind === 'prose' ? (
            <Markdown text={segment.text} />
          ) : (
            <Box flexDirection="column" borderStyle="round" borderColor="permission" paddingX={1}>
              <Box flexDirection="row" justifyContent="space-between">
                <Text dimColor>{segment.language || 'code'}</Text>
                <Button
                  key={`copy-${i}-${segment.source.length}`}
                  label="Copy"
                  onPress={async press => {
                    const { isCopied } = await $.ui.copy({ text: segment.source, surface: press.surface })
                    $.ui.toast(isCopied ? 'Copied' : 'Copy failed')
                  }}
                />
              </Box>
              <Code source={segment.source} language={segment.language || undefined} />
            </Box>
          ),
        )}
      </Box>
    )

    const below = await next(e)
    return replaceEngineNode(below, cards, e.props.text) as RenderElement
  })
}
