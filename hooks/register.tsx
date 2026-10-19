import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChatRecord, SharedPlan, Step, Task, TaskKind, TaskSource, TaskStatus } from '../types'

const PANE = 'chat-tasks'
const ALL_PANE = 'chat-tasks-all'
const KINDS: TaskKind[] = ['required', 'recommended', 'optional']
const STATUSES: TaskStatus[] = ['open', 'done', 'skipped']
const ICON_PREFIX = /^[●◐✓]\s+/
const REFRESH_MS = 4000

const planAtom = atom({ plugin: 'chat-tasks', key: 'plan' } as const, null)
const plansAtom = atom({ plugin: 'chat-tasks', key: 'plans' } as const, [])
const stepsAtom = atom({ plugin: 'chat-tasks', key: 'steps' } as const, [])
const titleAtom = atom({ plugin: 'chat-tasks', key: 'title' } as const, '')
const shownIconAtom = atom({ plugin: 'chat-tasks', key: 'shownIcon' } as const, '')
const showDoneAtom = atom({ plugin: 'chat-tasks', key: 'showDone' } as const, false)
const dismissedAtom = atom({ plugin: 'chat-tasks', key: 'paneDismissed' } as const, false)

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
  if (progress === 'done') return 'Done: nothing left to do'
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

export function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(ICON_PREFIX, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return s === '' ? 'plan' : s
}

function cleanStep(text: string): string {
  const plain = text
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/[:.]\s*$/, '')
    .trim()
  return plain.length > 80 ? `${plain.slice(0, 77).trimEnd()}…` : plain
}

/** The steps of a plan-mode plan: its numbered items, else its top-level bullets. */
export function parsePlan(markdown: string): { title: string; steps: string[] } {
  const lines = markdown.split(/\r?\n/)
  const heading = lines.map(l => /^#{1,3}\s+(.+)$/.exec(l)?.[1]).find(Boolean)
  const title = cleanStep((heading ?? 'Plan').replace(/^plan:\s*/i, ''))
  const numbered = lines
    .map(l => /^\s{0,3}\d+[.)]\s+(.+)$/.exec(l)?.[1])
    .filter((s): s is string => s !== undefined)
  const bullets = lines
    .map(l => /^[-*+]\s+(.+)$/.exec(l)?.[1])
    .filter((s): s is string => s !== undefined)
  const steps = (numbered.length > 0 ? numbered : bullets).map(cleanStep).filter(Boolean)
  return { title, steps: [...new Set(steps)].slice(0, 25) }
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
  source: TaskSource = 'chat',
): { next: Task[]; errors: string[]; ids: string[] } {
  const next = list.map(t => ({ ...t }))
  const errors: string[] = []
  const ids: string[] = []
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
        ids.push(existing.id)
        continue
      }
      seq += 1
      next.push({
        id: `t${seq}`,
        title: text,
        kind: kind ?? 'required',
        status: status ?? 'open',
        source,
        ...(item.note ? { note: item.note } : {}),
      })
      ids.push(`t${seq}`)
      continue
    }

    const target =
      next.find(t => t.id === item.id) ??
      next.find(t => item.title !== undefined && t.title.toLowerCase() === item.title.toLowerCase())
    if (!target) {
      errors.push(`no task ${item.id ?? item.title ?? '(unnamed)'}`)
      continue
    }
    ids.push(target.id)
    if (action === 'remove') {
      next.splice(next.indexOf(target), 1)
      continue
    }
    if (kind) target.kind = kind
    if (status) target.status = status
    if (item.title && item.id) target.title = item.title.trim()
    if (item.note !== undefined) target.note = item.note
  }

  return { next, errors, ids }
}

export function describe(plan: SharedPlan | null): string {
  if (plan === null || plan.tasks.length === 0) return 'No tasks recorded for this chat.'
  const others = Object.keys(plan.members).length - 1
  const head = `Plan "${plan.name}"${others > 0 ? `, shared with ${others} other chat${others > 1 ? 's' : ''}` : ''}`
  const lines = plan.tasks.map(t => `${t.id} [${t.kind}] [${t.status}] ${t.title}`)
  return `${head}\n${lines.join('\n')}\n\nStatus: ${countsLine(plan.tasks)}`
}

const GUIDANCE = `# Chat task list (chat-tasks mod)
This chat keeps a visible task list through the mcp__chat-tasks__tasks tool. The person relies on it to know whether this chat still has work to do, instead of asking you. The list may be a shared plan other chats have joined; their changes show up in it.
- Whenever you identify a step that remains (something you plan to do, something blocked on the person, a follow-up you recommend, an optional nice-to-have), record it with action "add". Pick the kind carefully:
  - "required": part of what the person asked for; the chat is not finished until it is done.
  - "recommended": not asked for, but you advise doing it (tests, cleanup, a fix you noticed).
  - "optional": nice-to-have ideas the person can ignore.
- Steps of an approved plan-mode plan and of the app's step list are added and checked off automatically; do not add them again.
- As you finish a task, mark it "done" (action "update"). If the person declines one or it becomes moot, mark it "skipped".
- If the person asks this chat to work on another chat's plan, use action "join" with that plan's name.
- Before you end a turn, make sure the list matches reality: nothing finished still open, nothing left undone missing.
- Keep titles short and imperative (under ~60 characters). Do not record trivial sub-steps of the current action.`

async function sessionId($: EngineInterface): Promise<string> {
  return $.session.id()
}

async function chatTitle($: EngineInterface): Promise<string> {
  return (await read($, titleAtom)) || 'Untitled chat'
}

async function readPlan($: EngineInterface, name: string): Promise<SharedPlan | undefined> {
  const found = (await $.store.get(`plan:${name}`)) as SharedPlan | undefined
  return found && Array.isArray(found.tasks) ? found : undefined
}

async function writeChatRecord($: EngineInterface, plan: string) {
  const id = await sessionId($)
  const record: ChatRecord = {
    sessionId: id,
    title: await chatTitle($),
    cwd: await $.session.cwd(),
    plan,
    updatedAt: await $.clock.now(),
  }
  await $.store.set(`chat:${id}`, record)
}

/** Status line, and the icon on the chat's title in the desktop app's list. */
async function showStatus($: EngineInterface) {
  const plan = await read($, planAtom)
  const tasks = plan?.tasks ?? []
  const line = countsLine(tasks)
  $.ui.status(line === '' ? undefined : `${ICON[progressOf(tasks)]} ${line}`)
  await syncSidebar($)
  await autoOpen($)
}

/** In the desktop app, keeps the Tasks pane docked while the chat has tasks, unless the person closed it. */
async function autoOpen($: EngineInterface) {
  const plan = await read($, planAtom)
  if (plan === null || plan.tasks.length === 0) return
  if (await read($, dismissedAtom)) return
  if (!(await $.session.surfaces()).includes('desktop')) return
  if ((await $.ui.panes()).some(pane => pane.id === PANE)) return
  await $.ui.open({ id: PANE, title: 'Tasks' })
}

/** Opens the Tasks pane because the person asked, which also lets it auto-open again. */
async function openTasks($: EngineInterface) {
  await update($, dismissedAtom, () => false)
  await $.ui.open({ id: PANE, title: 'Tasks' })
}

/** Renames this chat through the desktop app so its title leads with the icon. */
async function syncSidebar($: EngineInterface) {
  const plan = await read($, planAtom)
  const icon = ICON[progressOf(plan?.tasks ?? [])]
  if (icon === (await read($, shownIconAtom))) return
  try {
    const got = await $.tool.call({ tool: 'mcp__ccd_session_mgmt__get_session', session_id: 'self' } as never)
    if (!('text' in got) || typeof got.text !== 'string' || got.isError) return
    const current = (JSON.parse(got.text) as { title?: string }).title
    if (!current) return
    await update($, titleAtom, () => current.replace(ICON_PREFIX, ''))
    const wanted = withIcon(current, plan?.tasks ?? [])
    if (wanted !== current) {
      const set = await $.tool.call({
        tool: 'mcp__ccd_session_mgmt__set_session_title',
        session_id: 'self',
        title: wanted,
      } as never)
      if ('deny' in set && set.deny !== undefined) return
      if ('isError' in set && set.isError) return
    }
    await update($, shownIconAtom, () => icon)
  } catch {
    // Not the desktop app, or its session tools are unavailable: the band and status line still show it.
  }
}

/** Makes sure this chat is on a plan, creating one named after `title` (or the chat). */
async function ensurePlan($: EngineInterface, title?: string): Promise<SharedPlan> {
  const current = await read($, planAtom)
  if (current !== null) return current
  const id = await sessionId($)
  const label = title || (await read($, titleAtom)) || `chat ${id.replace(/^local_/, '').slice(0, 6)}`
  const base = slug(label)
  let name = base
  for (let n = 2; (await readPlan($, name)) !== undefined; n += 1) name = `${base}-${n}`
  const plan: SharedPlan = {
    name,
    title: label,
    tasks: [],
    members: { [id]: await chatTitle($) },
    updatedAt: await $.clock.now(),
  }
  await $.store.set(`plan:${name}`, plan)
  await update($, planAtom, () => plan)
  await writeChatRecord($, name)
  return plan
}

/** Re-reads this chat's plan from the store, applies `change`, and writes it back. */
async function editPlan($: EngineInterface, change: (tasks: Task[]) => Task[]): Promise<SharedPlan> {
  const mine = await ensurePlan($)
  const fresh = (await readPlan($, mine.name)) ?? mine
  const id = await sessionId($)
  const plan: SharedPlan = {
    ...fresh,
    tasks: change(fresh.tasks),
    members: { ...fresh.members, [id]: await chatTitle($) },
    updatedAt: await $.clock.now(),
  }
  await $.store.set(`plan:${plan.name}`, plan)
  await update($, planAtom, () => plan)
  await showStatus($)
  return plan
}

async function joinPlan($: EngineInterface, name: string): Promise<SharedPlan | undefined> {
  const target = await readPlan($, name)
  if (target === undefined) return undefined
  await leavePlan($)
  const id = await sessionId($)
  const plan: SharedPlan = {
    ...target,
    members: { ...target.members, [id]: await chatTitle($) },
    updatedAt: await $.clock.now(),
  }
  await $.store.set(`plan:${name}`, plan)
  await update($, planAtom, () => plan)
  await update($, stepsAtom, () => [])
  await writeChatRecord($, name)
  await showStatus($)
  return plan
}

async function leavePlan($: EngineInterface) {
  const current = await read($, planAtom)
  if (current === null) return
  const fresh = await readPlan($, current.name)
  if (fresh !== undefined) {
    const members = { ...fresh.members }
    delete members[await sessionId($)]
    await $.store.set(`plan:${fresh.name}`, { ...fresh, members })
  }
  await update($, planAtom, () => null)
  await update($, stepsAtom, () => [])
}

/** Picks up changes other chats made to this chat's plan. */
async function refresh($: EngineInterface) {
  const current = await read($, planAtom)
  if (current === null) return
  const fresh = await readPlan($, current.name)
  if (fresh === undefined || fresh.updatedAt === current.updatedAt) return
  await update($, planAtom, () => fresh)
  await showStatus($)
}

async function loadPlans($: EngineInterface) {
  const keys = await $.store.keys()
  const all: SharedPlan[] = []
  for (const key of keys.filter(k => k.startsWith('plan:'))) {
    const one = await readPlan($, key.slice(5))
    if (one && one.tasks.length > 0) all.push(one)
  }
  all.sort((a, b) => b.updatedAt - a.updatedAt)
  await update($, plansAtom, () => all)
}

/** Restores this chat's plan on start or resume, moving a 0.1 per-chat list into a plan. */
async function restore($: EngineInterface) {
  if ((await read($, planAtom)) !== null) return
  const id = await sessionId($)
  const saved = (await $.store.get(`chat:${id}`)) as
    | (Partial<ChatRecord> & { tasks?: Task[] })
    | undefined
  if (saved?.title) await update($, titleAtom, () => saved.title!.replace(ICON_PREFIX, ''))
  if (saved?.plan) {
    const plan = await readPlan($, saved.plan)
    if (plan) await update($, planAtom, () => plan)
    return
  }
  if (saved?.tasks && saved.tasks.length > 0) {
    const old = saved.tasks
    await editPlan($, () => old)
  }
}

type StepItem = { content?: string; status?: string }
type StepInput = { items?: StepItem[]; advance?: boolean; done?: number[]; start?: number }

/** Mirrors one call of the desktop app's step list onto this chat's plan. */
async function syncSteps($: EngineInterface, input: StepInput) {
  let steps: Step[] = await read($, stepsAtom)

  if (Array.isArray(input.items)) {
    const items = input.items.filter(i => typeof i.content === 'string' && i.content.trim() !== '')
    let ids: string[] = []
    const previous = steps
    await editPlan($, tasks => {
      const added = applyAction(
        tasks,
        'add',
        items.map(i => ({ title: cleanStep(i.content!), kind: 'required' })),
        'steps',
      )
      ids = added.ids
      return added.next.map(t => {
        const at = ids.indexOf(t.id)
        if (at >= 0) return { ...t, status: items[at]!.status === 'completed' ? 'done' : 'open' }
        const dropped = previous.some(s => s.id === t.id) && t.status === 'open'
        return dropped ? { ...t, status: 'skipped' } : t
      })
    })
    steps = ids.map((id, i) => ({
      id,
      phase: items[i]!.status === 'completed' ? 'completed' : items[i]!.status === 'in_progress' ? 'in_progress' : 'pending',
    }))
  } else {
    steps = steps.map(s => ({ ...s }))
    if (input.advance) {
      const at = steps.findIndex(s => s.phase === 'in_progress')
      if (at >= 0) steps[at]!.phase = 'completed'
      const next = steps.findIndex((s, i) => i > at && s.phase === 'pending')
      if (next >= 0) steps[next]!.phase = 'in_progress'
    }
    for (const n of input.done ?? []) if (steps[n - 1]) steps[n - 1]!.phase = 'completed'
    if (typeof input.start === 'number' && steps[input.start - 1]) steps[input.start - 1]!.phase = 'in_progress'
    const finished = new Set(steps.filter(s => s.phase === 'completed').map(s => s.id))
    if (finished.size > 0) {
      await editPlan($, tasks =>
        tasks.map(t => (finished.has(t.id) && t.status === 'open' ? { ...t, status: 'done' } : t)),
      )
    }
  }

  await update($, stepsAtom, () => steps)
}

/** The step list's closing call checks off the step still in progress. */
async function finishSteps($: EngineInterface) {
  const steps = await read($, stepsAtom)
  const running = steps.find(s => s.phase === 'in_progress')
  if (running === undefined) return
  await update($, stepsAtom, list => list.map((s): Step => (s.id === running.id ? { ...s, phase: 'completed' } : s)))
  await editPlan($, tasks => tasks.map(t => (t.id === running.id && t.status === 'open' ? { ...t, status: 'done' } : t)))
}

async function handleCommand($: EngineInterface, args: string): Promise<string> {
  const [verb, ...rest] = args.trim().split(/\s+/)
  if (verb === 'join') {
    const name = rest.join(' ')
    if (!name) return 'Usage: /chat-todo join <plan-name>. /chat-tasks lists the plans.'
    const plan = await joinPlan($, name)
    return plan ? `Joined plan "${name}".\n${describe(plan)}` : `No plan named "${name}". /chat-tasks lists the plans.`
  }
  if (verb === 'leave') {
    await leavePlan($)
    await showStatus($)
    return 'Left the plan. This chat starts a new list the next time a task is added.'
  }
  await openTasks($)
  return describe(await read($, planAtom))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await restore($)

    await $.tool.register({
      name: 'tasks',
      description:
        'Record and update the task list for this chat, shown to the person. ' +
        'action "add" records new tasks (items: [{title, kind}]); "update" changes tasks by id ' +
        '(items: [{id, status?, kind?, title?, note?}]); "remove" deletes tasks by id; "list" returns the list; ' +
        '"join" switches this chat to another chat\'s shared plan (plan: its name); "leave" leaves it. ' +
        'kind is "required" (part of what was asked), "recommended" (advised follow-up) or "optional" (nice-to-have). ' +
        'status is "open", "done" or "skipped".',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'remove', 'list', 'join', 'leave'] },
          plan: { type: 'string', description: 'For "join": the plan name, as /chat-tasks lists it.' },
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
    await $.command.register({
      name: 'chat-todo',
      description: "Show this chat's task list; 'join <plan>' or 'leave' to share one",
      argumentHint: '[join <plan> | leave]',
    })
    await $.command.register({
      name: 'chat-tasks',
      description: 'Show every shared plan and the chats on it',
    })

    $.clock.every(REFRESH_MS, () => void refresh($))
    await showStatus($)

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return {
      sections: [...composed.sections, { id: 'chat-tasks:guidance', text: GUIDANCE, scope: 'session' }],
    }
  })

  on('tool.call', { tool: 'mcp__chat-tasks__tasks' }, async ($, e) => {
    // A call can land before session.start has restored this chat's plan (a reload mid-turn).
    await restore($)
    const input = e as unknown as { action?: string; items?: ItemInput[]; plan?: string }
    const action = input.action ?? 'list'
    if (action === 'list') return { result: describe(await read($, planAtom)) }
    if (action === 'join') {
      const plan = input.plan ? await joinPlan($, input.plan) : undefined
      return { result: plan ? `Joined plan "${plan.name}".\n${describe(plan)}` : `No plan named "${input.plan ?? ''}".` }
    }
    if (action === 'leave') {
      await leavePlan($)
      await showStatus($)
      return { result: 'Left the plan.' }
    }

    let errors: string[] = []
    const plan = await editPlan($, tasks => {
      const applied = applyAction(tasks, action, input.items ?? [])
      errors = applied.errors
      return applied.next
    })
    const summary = describe(plan)
    return { result: errors.length ? `${summary}\n\nProblems: ${errors.join('; ')}` : summary }
  })

  // An approved plan-mode plan: its steps become required tasks.
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    const text = (ran.result as { plan?: string | null } | undefined)?.plan
    if (typeof text !== 'string' || text.trim() === '') return ran
    const parsed = parsePlan(text)
    if (parsed.steps.length === 0) return ran
    const current = await read($, planAtom)
    if (current === null || current.tasks.length === 0) {
      await leavePlan($)
      await ensurePlan($, parsed.title)
    }
    await editPlan($, tasks => applyAction(tasks, 'add', parsed.steps.map(title => ({ title })), 'plan').next)
    return ran
  })

  // The desktop app's step list: each step mirrors a required task.
  on('tool.call', { tool: 'mcp__ccd_turn__update_plan' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    await syncSteps($, e as unknown as StepInput)
    return ran
  })

  on('tool.call', { tool: 'mcp__ccd_turn__wrap_up' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) await finishSteps($)
    return ran
  })

  // Keeps the known chat title current (the terminal shows the title it is given here).
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const answer = await next(e)
    if (!e.session_title) return answer
    await update($, titleAtom, () => e.session_title!.replace(ICON_PREFIX, ''))
    const plan = await read($, planAtom)
    if (plan !== null) await writeChatRecord($, plan.name)
    const titled = withIcon(e.session_title, plan?.tasks ?? [])
    return titled === e.session_title ? answer : { ...answer, sessionTitle: titled }
  })

  on('command.run', { command: 'chat-todo' }, async ($, e) => {
    await restore($)
    return { text: await handleCommand($, e.args) }
  })

  on('command.run', { command: 'chat-tasks' }, async $ => {
    await loadPlans($)
    await $.ui.open({ id: ALL_PANE, title: 'All plans' })
    const all = await read($, plansAtom)
    return {
      text:
        all.length === 0
          ? 'No plans have tasks yet.'
          : all
              .map(p => `${ICON[progressOf(p.tasks)]} ${p.name}: ${countsLine(p.tasks)} (${Object.values(p.members).join(', ') || 'no chats'})`)
              .join('\n'),
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const plan = await read($, planAtom)
    const tasks = plan?.tasks ?? []
    const progress = progressOf(tasks)
    if (e.props.hasSurvey || progress === 'none') return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const shared = plan !== null && Object.keys(plan.members).length > 1

    return (
      <Box>
        <Text color={COLOR[progress]}>{ICON[progress]} </Text>
        <Text dimColor={progress === 'done'}>
          {shared ? `${plan.name}: ` : ''}
          {countsLine(tasks)}{' '}
        </Text>
        <Button key="open-tasks" label="Tasks" onPress={() => openTasks($)} />
      </Box>
    )
  })

  // The person closing the pane keeps it closed for this chat until they open it again.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, dismissedAtom, () => true)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const plan = await read($, planAtom)
    const tasks = plan?.tasks ?? []
    const progress = progressOf(tasks)
    const id = await sessionId($)
    const others = plan === null ? [] : Object.entries(plan.members).filter(([who]) => who !== id).map(([, t]) => t)
    const showDone = await read($, showDoneAtom)
    const open = tasks.filter(t => t.status === 'open')
    const closed = tasks.filter(t => t.status !== 'open')
    // The desktop reveals a row's buttons on hover; a terminal has no pointer to hover with.
    const onHover = e.surface === 'desktop'

    const setStatus = (taskId: string, status: TaskStatus) => () =>
      editPlan($, all => all.map(t => (t.id === taskId ? { ...t, status } : t)))

    const row = (t: Task) => {
      const scope = `chat-tasks-${t.id}`
      return (
        <Box key={`row-${t.id}`} hover={{ scope }}>
          <Text dimColor={t.status !== 'open'} strikethrough={t.status === 'skipped'}>
            {t.status === 'done' ? '✓' : t.status === 'skipped' ? '–' : '○'} {t.title}{' '}
          </Text>
          <Box display={onHover ? 'none' : 'flex'} {...(onHover ? { hover: { scope, display: 'flex' as const } } : {})}>
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
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {progress === 'none' && <Text dimColor>No tasks recorded for this chat yet.</Text>}
        {progress !== 'none' && (
          <Text color={COLOR[progress]} bold>
            {ICON[progress]} {countsLine(tasks)}
          </Text>
        )}
        {plan !== null && (
          <Text dimColor>
            {plan.name}
            {others.length > 0 ? ` · with ${others.join(', ')}` : ''}
          </Text>
        )}
        {KINDS.map(kind => {
          const group = open.filter(t => t.kind === kind)
          if (group.length === 0) return null
          return (
            <Box key={`group-${kind}`} flexDirection="column" marginTop={1}>
              <Text dimColor bold>
                {kind.charAt(0).toUpperCase() + kind.slice(1)}
              </Text>
              {group.map(row)}
            </Box>
          )
        })}
        {closed.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Button
              key="toggle-done"
              plain
              dimColor
              label={showDone ? 'Hide finished' : `Show finished (${closed.length})`}
              onPress={() => update($, showDoneAtom, v => !v)}
            />
            {showDone && closed.map(row)}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: ALL_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const all = await read($, plansAtom)
    const mine = (await read($, planAtom))?.name

    return (
      <Box flexDirection="column">
        {all.length === 0 && <Text dimColor>No plans have tasks yet.</Text>}
        {all.map(plan => {
          const progress = progressOf(plan.tasks)
          return (
            <Box key={`plan-${plan.name}`} flexDirection="column" marginBottom={1}>
              <Box>
                <Text color={COLOR[progress]}>{ICON[progress]} </Text>
                <Text bold>{plan.name} </Text>
                <Text dimColor>{countsLine(plan.tasks)} </Text>
                {plan.name === mine ? (
                  <Text dimColor>(this chat)</Text>
                ) : (
                  <Button
                    key={`join-${plan.name}`}
                    label="join"
                    onPress={async () => {
                      await joinPlan($, plan.name)
                      await loadPlans($)
                    }}
                  />
                )}
                <Text> </Text>
                <Button
                  key={`forget-${plan.name}`}
                  label="forget"
                  plain
                  dimColor
                  onPress={async () => {
                    await $.store.delete(`plan:${plan.name}`)
                    await loadPlans($)
                  }}
                />
              </Box>
              <Text dimColor>  {Object.values(plan.members).join(' · ') || 'no chats'}</Text>
            </Box>
          )
        })}
        <Box>
          <Button key="refresh" label="Refresh" onPress={() => loadPlans($)} />
        </Box>
      </Box>
    )
  })
}
