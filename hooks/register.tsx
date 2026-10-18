import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChatSummary, Task, TaskKind, TaskStatus } from '../types'

const PANE = 'chat-tasks'
const ALL_PANE = 'chat-tasks-all'
const TOOL = 'tasks'
const KINDS: TaskKind[] = ['required', 'recommended', 'optional']
const STATUSES: TaskStatus[] = ['open', 'done', 'skipped']
const ICON_PREFIX = /^[●◐✓]\s+/

const tasks = atom({ plugin: 'chat-tasks', key: 'tasks' } as const, [])
const chats = atom({ plugin: 'chat-tasks', key: 'chats' } as const, [])
const title = atom({ plugin: 'chat-tasks', key: 'title' } as const, '')

type Progress = 'none' | 'todo' | 'extras' | 'done'

export function progressOf(list: readonly Task[]): Progress {
  if (list.length === 0) return 'none'
  const open = list.filter(t => t.status === 'open')
  if (open.some(t => t.kind === 'required')) return 'todo'
  if (open.length > 0) return 'extras'
  return 'done'
}

const ICON: Record<Progress, string> = { none: '', todo: '●', extras: '◐', done: '✓' }
const COLOR: Record<Progress, 'warning' | 'suggestion' | 'success' | 'subtle'> = {
  none: 'subtle',
  todo: 'warning',
  extras: 'suggestion',
  done: 'success',
}

export function countsLine(list: readonly Task[]): string {
  const progress = progressOf(list)
  if (progress === 'none') return ''
  if (progress === 'done') return 'Done: nothing left to do here'
  const left = KINDS.map(kind => {
    const n = list.filter(t => t.kind === kind && t.status === 'open').length
    return n === 0 ? '' : `${n} ${kind}`
  }).filter(Boolean)
  return `${left.join(', ')} left`
}

export function withIcon(raw: string, list: readonly Task[]): string {
  const bare = raw.replace(ICON_PREFIX, '')
  const icon = ICON[progressOf(list)]
  return icon === '' ? bare : `${icon} ${bare}`
}

type ItemInput = {
  id?: string
  title?: string
  kind?: string
  status?: string
  note?: string
}

export function applyAction(
  list: readonly Task[],
  action: string,
  items: readonly ItemInput[],
): { next: Task[]; errors: string[] } {
  const next = list.map(t => ({ ...t }))
  const errors: string[] = []
  let seq = next.reduce((max, t) => Math.max(max, Number(t.id.slice(1)) || 0), 0)

  for (const item of items) {
    const kind = KINDS.includes(item.kind as TaskKind) ? (item.kind as TaskKind) : undefined
    const status = STATUSES.includes(item.status as TaskStatus)
      ? (item.status as TaskStatus)
      : undefined

    if (action === 'add') {
      const text = item.title?.trim()
      if (!text) {
        errors.push('an add item had no title')
        continue
      }
      const existing = next.find(t => t.title.toLowerCase() === text.toLowerCase())
      if (existing) {
        if (kind) existing.kind = kind
        if (status) existing.status = status
        continue
      }
      seq += 1
      next.push({
        id: `t${seq}`,
        title: text,
        kind: kind ?? 'required',
        status: status ?? 'open',
        ...(item.note ? { note: item.note } : {}),
      })
      continue
    }

    const target =
      next.find(t => t.id === item.id) ??
      next.find(t => item.title !== undefined && t.title.toLowerCase() === item.title.toLowerCase())
    if (!target) {
      errors.push(`no task ${item.id ?? item.title ?? '(unnamed)'}`)
      continue
    }
    if (action === 'remove') {
      next.splice(next.indexOf(target), 1)
      continue
    }
    if (kind) target.kind = kind
    if (status) target.status = status
    if (item.title && item.id) target.title = item.title.trim()
    if (item.note !== undefined) target.note = item.note
  }

  return { next, errors }
}

export function describe(list: readonly Task[]): string {
  if (list.length === 0) return 'No tasks recorded for this chat.'
  const lines = list.map(t => `${t.id} [${t.kind}] [${t.status}] ${t.title}`)
  return `${lines.join('\n')}\n\nStatus: ${countsLine(list)}`
}

const GUIDANCE = `# Chat task list (chat-tasks mod)
This chat keeps a visible task list through the mcp__chat-tasks__tasks tool. The person relies on it to know whether this chat still has work to do, instead of asking you.
- Whenever you identify a step that remains (something you plan to do, something blocked on the person, a follow-up you recommend, an optional nice-to-have), record it with action "add". Pick the kind carefully:
  - "required": part of what the person asked for; the chat is not finished until it is done.
  - "recommended": not asked for, but you advise doing it (tests, cleanup, a fix you noticed).
  - "optional": nice-to-have ideas the person can ignore.
- As you finish a task, mark it "done" (action "update"). If the person declines one or it becomes moot, mark it "skipped".
- Before you end a turn, make sure the list matches reality: nothing finished still open, nothing left undone missing.
- Keep titles short and imperative (under ~60 characters). Do not record trivial sub-steps of the current action.`

async function sessionKey($: EngineInterface) {
  return `chat:${await $.session.id()}`
}

async function persist($: EngineInterface) {
  const list = await read($, tasks)
  const key = await sessionKey($)
  const summary: ChatSummary = {
    sessionId: key.slice(5),
    title: (await read($, title)) || 'Untitled chat',
    cwd: await $.session.cwd(),
    tasks: list,
    updatedAt: await $.clock.now(),
  }
  await $.store.set(key, summary)
  const line = countsLine(list)
  $.ui.status(line === '' ? undefined : `${ICON[progressOf(list)]} ${line}`)
}

async function loadChats($: EngineInterface) {
  const keys = await $.store.keys()
  const all: ChatSummary[] = []
  for (const key of keys.filter(k => k.startsWith('chat:'))) {
    const one = (await $.store.get(key)) as ChatSummary | undefined
    if (one && Array.isArray(one.tasks) && one.tasks.length > 0) all.push(one)
  }
  all.sort((a, b) => b.updatedAt - a.updatedAt)
  await update($, chats, () => all)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get(await sessionKey($))) as ChatSummary | undefined
    if (saved && (await read($, tasks)).length === 0) {
      await update($, tasks, () => saved.tasks)
      if (saved.title) await update($, title, () => saved.title)
    }

    await $.tool.register({
      name: TOOL,
      description:
        'Record and update the task list for this chat, shown to the person. ' +
        'action "add" records new tasks (items: [{title, kind}]); "update" changes tasks by id ' +
        '(items: [{id, status?, kind?, title?, note?}]); "remove" deletes tasks by id; "list" returns the list. ' +
        'kind is "required" (part of what was asked), "recommended" (advised follow-up) or "optional" (nice-to-have). ' +
        'status is "open", "done" or "skipped".',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'remove', 'list'] },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                kind: { type: 'string', enum: KINDS },
                status: { type: 'string', enum: STATUSES },
                note: { type: 'string' },
              },
            },
          },
        },
        required: ['action'],
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'chat-todo', description: 'Show this chat\'s task list' })
    await $.command.register({
      name: 'chat-tasks',
      description: 'Show every chat that has tasks, with its status icon',
    })

    const list = await read($, tasks)
    const line = countsLine(list)
    $.ui.status(line === '' ? undefined : `${ICON[progressOf(list)]} ${line}`)

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return {
      sections: [...composed.sections, { id: 'chat-tasks:guidance', text: GUIDANCE, scope: 'session' }],
    }
  })

  on('tool.call', { tool: 'mcp__chat-tasks__tasks' }, async ($, e) => {
    const input = e as unknown as { action?: string; items?: ItemInput[] }
    const action = input.action ?? 'list'
    if (action === 'list') return { result: describe(await read($, tasks)) }

    let errors: string[] = []
    await update($, tasks, list => {
      const applied = applyAction(list, action, input.items ?? [])
      errors = applied.errors
      return applied.next
    })
    await persist($)
    const summary = describe(await read($, tasks))
    return { result: errors.length ? `${summary}\n\nProblems: ${errors.join('; ')}` : summary }
  })

  // Keep the chat's title carrying the status icon, so the chat list shows it.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const answer = await next(e)
    if (!e.session_title) return answer
    await update($, title, () => e.session_title!.replace(ICON_PREFIX, ''))
    const list = await read($, tasks)
    const titled = withIcon(e.session_title, list)
    await persist($)
    return titled === e.session_title ? answer : { ...answer, sessionTitle: titled }
  })

  on('classic.SessionStart', async ($, e, next) => {
    const answer = await next(e)
    if (!e.session_title) return answer
    await update($, title, () => e.session_title!.replace(ICON_PREFIX, ''))
    const titled = withIcon(e.session_title, await read($, tasks))
    return titled === e.session_title ? answer : { ...answer, sessionTitle: titled }
  })

  on('command.run', { command: 'chat-todo' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Tasks' })
    return { text: describe(await read($, tasks)) }
  })

  on('command.run', { command: 'chat-tasks' }, async $ => {
    await loadChats($)
    await $.ui.open({ id: ALL_PANE, title: 'All chats' })
    const all = await read($, chats)
    return {
      text:
        all.length === 0
          ? 'No chats have tasks yet.'
          : all.map(c => `${ICON[progressOf(c.tasks)]} ${c.title}: ${countsLine(c.tasks)}`).join('\n'),
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, tasks)
    const progress = progressOf(list)
    if (e.props.hasSurvey || progress === 'none') return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box>
        <Text color={COLOR[progress]}>{ICON[progress]} </Text>
        <Text dimColor={progress === 'done'}>{countsLine(list)} </Text>
        <Button key="open-tasks" label="Tasks" onPress={() => $.ui.open({ id: PANE, title: 'Tasks' })} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, tasks)
    const progress = progressOf(list)

    const setStatus = (id: string, status: TaskStatus) => async () => {
      await update($, tasks, all => all.map(t => (t.id === id ? { ...t, status } : t)))
      await persist($)
    }

    return (
      <Box flexDirection="column">
        {progress === 'none' && <Text dimColor>No tasks recorded for this chat yet.</Text>}
        {progress !== 'none' && (
          <Text color={COLOR[progress]} bold>
            {ICON[progress]} {countsLine(list)}
          </Text>
        )}
        {KINDS.map(kind => {
          const group = list.filter(t => t.kind === kind)
          if (group.length === 0) return null
          return (
            <Box key={`group-${kind}`} flexDirection="column" marginTop={1}>
              <Text bold>{kind.charAt(0).toUpperCase() + kind.slice(1)}</Text>
              {group.map(t => (
                <Box key={`row-${t.id}`}>
                  <Text dimColor={t.status !== 'open'} strikethrough={t.status === 'skipped'}>
                    {t.status === 'done' ? '✓' : t.status === 'skipped' ? '–' : '○'} {t.title}{' '}
                  </Text>
                  {t.status === 'open' ? (
                    <Box>
                      <Button key={`done-${t.id}`} label="done" onPress={setStatus(t.id, 'done')} />
                      <Text> </Text>
                      <Button key={`skip-${t.id}`} label="skip" onPress={setStatus(t.id, 'skipped')} />
                    </Box>
                  ) : (
                    <Button key={`reopen-${t.id}`} label="reopen" onPress={setStatus(t.id, 'open')} />
                  )}
                </Box>
              ))}
            </Box>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: ALL_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const all = await read($, chats)

    return (
      <Box flexDirection="column">
        {all.length === 0 && <Text dimColor>No chats have tasks yet.</Text>}
        {all.map(chat => {
          const progress = progressOf(chat.tasks)
          return (
            <Box key={`chat-${chat.sessionId}`}>
              <Text color={COLOR[progress]}>{ICON[progress]} </Text>
              <Text>{chat.title} </Text>
              <Text dimColor>{countsLine(chat.tasks)} </Text>
              <Button
                key={`forget-${chat.sessionId}`}
                label="forget"
                plain
                dimColor
                onPress={async () => {
                  await $.store.delete(`chat:${chat.sessionId}`)
                  await loadChats($)
                }}
              />
            </Box>
          )
        })}
        <Box marginTop={1}>
          <Button key="refresh" label="Refresh" onPress={() => loadChats($)} />
        </Box>
      </Box>
    )
  })
}
