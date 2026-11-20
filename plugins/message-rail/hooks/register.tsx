import type { Register } from 'claude-code'

const PANE = 'message-rail'
const PANE_COLUMNS = 38
const LONG_CHARS = 240
const LONG_LINES = 4
const CARD_WIDTH = 46
const REPLY_CHARS = 220
const TICK = { rest: '──', here: '───', last: '────' } as const

export type Kind = 'user' | 'assistant'
export type Entry = { id: string; text: string; order: number; reply?: string }
export type Turn = { id: string; text: string; reply?: string }

// The prompts you typed, by the transcript row id the UserMessage site draws under
const entries = new Map<string, Entry>()
let nextOrder = 0
// Prompts whose rows the transcript's viewport shows now
const visible = new Set<string>()
// Per-message collapse choices, keyed `${kind}:${id}`; otherwise the kind's default
const overrides = new Map<string, boolean>()
const defaults: Record<Kind, boolean> = { user: false, assistant: false }
let isRedrawQueued = false

export function isLong(text: string): boolean {
  return text.length > LONG_CHARS || text.split('\n').length > LONG_LINES
}

// One line of the text, whitespace folded, cut to `max` characters
export function preview(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? line.slice(0, Math.max(1, max - 1)) + '…' : line
}

// A prompt the person typed, not a command echo or an injected block
export function isTypedPrompt(text: string): boolean {
  const t = text.trim()
  return t.length > 0 && !t.startsWith('<')
}

// Claude Code names a project's transcript folder after its path, every other character a dash
export function projectSlug(root: string): string {
  return root.replace(/[^a-zA-Z0-9]/g, '-')
}

// The typed prompts of a transcript file, oldest first, each with Claude's last text after it
export function parseTranscript(jsonl: string): Turn[] {
  const out: Turn[] = []
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let row: any
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row?.type === 'assistant' && !row.isSidechain && out.length > 0) {
      const reply = textOf(row.message?.content).trim()
      if (reply) out[out.length - 1].reply = reply
      continue
    }
    if (row?.type !== 'user' || row.isMeta || row.isSidechain || row.isCompactSummary) continue
    if (typeof row.uuid !== 'string') continue
    const content = row.message?.content
    let text = ''
    if (typeof content === 'string') {
      text = content
    } else if (Array.isArray(content)) {
      if (content.some((b: any) => b?.type === 'tool_result')) continue
      text = content
        .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
        .map((b: any) => b.text)
        .join('\n')
    }
    if (isTypedPrompt(text)) out.push({ id: row.uuid, text })
  }
  return out
}

// Adds a prompt; true when the rail changed
function remember(id: string, text: string): boolean {
  const known = entries.get(id)
  if (known) {
    if (known.text === text) return false
    known.text = text
    return true
  }
  entries.set(id, { id, text, order: nextOrder++ })
  return true
}

// The transcript's order wins over the order rows happened to be drawn in
function loadEntries(rows: Turn[]) {
  const late = [...entries.values()].filter(x => !rows.some(r => r.id === x.id))
  entries.clear()
  rows.forEach((r, i) => entries.set(r.id, { id: r.id, text: r.text, order: i, reply: r.reply }))
  late
    .sort((a, b) => a.order - b.order)
    .forEach((x, i) => entries.set(x.id, { ...x, order: rows.length + i }))
  nextOrder = entries.size
}

function sorted(): Entry[] {
  return [...entries.values()].sort((a, b) => a.order - b.order)
}

function isCollapsed(kind: Kind, id: string): boolean {
  return overrides.get(`${kind}:${id}`) ?? defaults[kind]
}

function setAll(kind: Kind, value: boolean) {
  defaults[kind] = value
  for (const key of [...overrides.keys()]) {
    if (key.startsWith(kind + ':')) overrides.delete(key)
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('\n')
}

// A render hook can't redraw in the middle of a draw, so it queues one
function queueRedraw($: any) {
  if (isRedrawQueued) return
  isRedrawQueued = true
  $.clock.after(0, () => {
    isRedrawQueued = false
    $.ui.invalidate('ui.render')
  })
}

async function loadTranscript($: any, path: string) {
  try {
    loadEntries(parseTranscript(await $.fs.read(path)))
  } catch {
    // Missing, or over the 4 MiB read limit: the rail fills from what the transcript draws
  }
}

async function openRail($: any) {
  await $.ui.open({ id: PANE, title: 'Messages', columns: PANE_COLUMNS })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rail',
      description: 'Show or hide the rail of your messages',
      immediate: true,
    })
    try {
      const home = await $.env.get('HOME')
      const root = await $.session.root()
      const id = await $.session.id()
      if (home && root && id) {
        await loadTranscript($, `${home}/.claude/projects/${projectSlug(root)}/${id}.jsonl`)
      }
    } catch {
      // The rail still fills from the rows the transcript draws
    }
    await openRail($)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') {
      entries.clear()
      visible.clear()
      overrides.clear()
      nextOrder = 0
    }
    if (typeof e.transcript_path === 'string' && e.source !== 'clear') {
      await loadTranscript($, e.transcript_path)
    }
    $.ui.invalidate('ui.render')
    return next(e)
  }).catch(async ($, e, next) => next(e))

  // A prompt typed now joins the rail as it's stored
  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    const stored = await next(e)
    const text = textOf(e.message.content)
    if (
      !e.agentId &&
      e.origin.kind === 'composer' &&
      e.message.type === 'user' &&
      !e.message.isMeta &&
      isTypedPrompt(text) &&
      remember(e.uuid, text)
    ) {
      $.ui.invalidate('ui.render')
    }
    return stored
  }).catch(async ($, e, next) => next(e))

  // Claude's latest text becomes the reply shown on the newest prompt's card
  on('session.append', { door: 'response' }, async ($, e, next) => {
    const stored = await next(e)
    const reply = textOf(e.message.content).trim()
    const latest = sorted().at(-1)
    if (!e.agentId && reply && latest && latest.reply !== reply) {
      latest.reply = reply
      $.ui.invalidate('ui.render')
    }
    return stored
  }).catch(async ($, e, next) => next(e))

  on('command.run', { command: 'rail' }, async ($, e, next) => {
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (isOpen) await $.ui.close({ id: PANE })
    else await openRail($)
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(16, e.props.bodyColumns ?? PANE_COLUMNS)
    const list = sorted()
    const redraw = () => $.ui.invalidate('ui.render')
    const cardWidth = Math.min(CARD_WIDTH, width - TICK.last.length - 2)

    const toggleAll = (kind: Kind, hotkey: string, collapse: string, expand: string) => (
      <Button
        key={`all-${kind}`}
        label={defaults[kind] ? expand : collapse}
        hotkey={hotkey}
        plain
        onPress={() => {
          setAll(kind, !defaults[kind])
          redraw()
        }}
      />
    )

    const rows = list.map((entry, i) => {
      const n = i + 1
      const isHere = visible.has(entry.id)
      const isLast = i === list.length - 1
      const tick = isLast ? TICK.last : isHere ? TICK.here : TICK.rest
      // Rows in the lower half open their card upward so the pane doesn't clip it
      const isLower = i >= list.length / 2 && list.length > 4
      return (
        <Box key={`row-${entry.id}`} flexDirection="row" justifyContent="flex-end" width={TICK.last.length}>
          <Button
            key={`jump-${entry.id}`}
            label={`Jump to message ${n}`}
            plain
            onPress={async () => {
              let why: string | undefined
              try {
                why = (await $.ui.scroll({ to: { requestId: entry.id }, block: 'start' })).deny
              } catch (error) {
                why = error instanceof Error ? error.message : String(error)
              }
              if (why) $.ui.toast(`Couldn't jump to message ${n}: ${why}`)
            }}
          >
            <Text color={isLast ? '#ffffff' : isHere ? '#a8b3c4' : '#5c6b80'}>{tick}</Text>
          </Button>
          <Box
            position="absolute"
            {...(isLower ? { bottom: 0 } : { top: 0 })}
            right={TICK.last.length + 1}
            width={cardWidth}
            display="none"
            hover={{ display: 'flex' }}
            flexDirection="column"
            borderStyle="round"
            borderColor="#3d4a5c"
            backgroundColor="#1e2633"
            paddingX={1}
          >
            <Text color="#ffffff" weight="semibold">
              {preview(entry.text, cardWidth - 4)}
            </Text>
            {entry.reply ? <Text color="#9aa5b4">{preview(entry.reply, REPLY_CHARS)}</Text> : null}
          </Box>
        </Box>
      )
    })

    return (
      <Box flexDirection="column" alignItems="flex-end">
        {rows.length > 0 ? rows : [<Text dimColor>No messages yet.</Text>]}
        <Text> </Text>
        <Box flexDirection="row" columnGap={2}>
          {toggleAll('user', 'u', 'Fold mine', 'Unfold mine')}
          {toggleAll('assistant', 'c', 'Fold Claude', 'Unfold Claude')}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin?.kind !== 'composer') return next(e)
    const id = e.requestId
    let changed = isTypedPrompt(e.props.text) ? remember(id, e.props.text) : false
    if ('onScreen' in e.props) {
      const isHere = e.props.onScreen != null
      if (isHere !== visible.has(id)) {
        if (isHere) visible.add(id)
        else visible.delete(id)
        changed = true
      }
    }
    if (changed) queueRedraw($)

    // The ctrl+o transcript shows everything as stored
    if (e.props.isExpanded || !isLong(e.props.text)) return next(e)
    return drawFoldable($, e, next, 'user', 'You')
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if ((e.props as { isSummary?: boolean }).isSummary || !isLong(e.props.text)) return next(e)
    return drawFoldable($, e, next, 'assistant', 'Claude')
  })
}

// A message with a fold button: folded, one line; unfolded, Claude Code's own drawing under the button
async function drawFoldable($: any, e: any, next: any, kind: Kind, who: string) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const id: string = e.requestId
  const text: string = e.props.text
  const toggle = () => {
    overrides.set(`${kind}:${id}`, !isCollapsed(kind, id))
    $.ui.invalidate('ui.render')
  }
  const width = Math.max(20, (e.viewport?.columns ?? 100) - 24)

  if (isCollapsed(kind, id)) {
    const lines = text.split('\n').length
    return (
      <Button key={`fold-${kind}-${id}`} label={`Unfold ${who}'s message`} plain onPress={toggle}>
        <Text color="claude">▸ </Text>
        <Text dimColor>{`${who}: ${preview(text, width)}`}</Text>
        <Text dimColor>{lines > 1 ? ` (${lines} lines)` : ''}</Text>
      </Button>
    )
  }

  const theirs = await next(e)
  return (
    <Box flexDirection="column">
      <Button key={`fold-${kind}-${id}`} label={`Fold ${who}'s message`} plain onPress={toggle}>
        <Text dimColor>{`▾ fold ${who === 'You' ? 'mine' : who}`}</Text>
      </Button>
      {theirs}
    </Box>
  )
}
