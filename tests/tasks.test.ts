import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const TOOL = 'mcp__chat-tasks__tasks'

/** The engine beneath the plugin: a session whose id the test can switch, and the desktop app's tools. */
function engine(on: On, opts: { plan?: string; titles?: string[] } = {}) {
  const who = { id: 'local_aaaaaa111' }
  let title = 'Fix login bug'
  on('session.id', () => ({ value: who.id }))
  on('session.cwd', () => ({ value: '/work' }))
  mock.clock(on)
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('classic.UserPromptSubmit', () => ({}))
  on('tool.call', { tool: 'ExitPlanMode' }, () => ({ result: { plan: opts.plan ?? null, isAgent: false } }) as never)
  on('tool.call', { tool: 'mcp__ccd_turn__update_plan' }, () => ({ result: 'ok' }) as never)
  on('tool.call', { tool: 'mcp__ccd_turn__wrap_up' }, () => ({ result: 'ok' }) as never)
  on('tool.call', { tool: 'mcp__ccd_session_mgmt__get_session' }, () =>
    ({ result: 'ok', text: JSON.stringify({ title }) }) as never,
  )
  on('tool.call', { tool: 'mcp__ccd_session_mgmt__set_session_title' }, ($, e) => {
    title = (e as unknown as { title: string }).title
    opts.titles?.push(title)
    return { result: 'ok' } as never
  })
  return who
}

async function call($: { tool: { call: (e: never) => Promise<unknown> } }, input: Record<string, unknown>) {
  const ran = (await $.tool.call({ tool: TOOL, tool_use_id: String(Math.random()), ...input } as never)) as {
    result?: unknown
  }
  return String(ran.result)
}

test('tasks drive the band from "more to do" to "done"', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(
      await call($, {
        action: 'add',
        items: [
          { title: 'Ship the fix', kind: 'required' },
          { title: 'Add a regression test', kind: 'recommended' },
          { title: 'Tidy the README', kind: 'optional' },
        ],
      }),
    ).toContain('1 required, 1 recommended, 1 optional left')

    const band = await $.ui.mount({
      plugin: 'chat-tasks',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never,
    })
    expect(await band.find({ type: 'Text', text: /●/ })).toBeDefined()
    await call($, { action: 'update', items: [{ id: 't1', status: 'done' }] })
    expect(await band.find({ type: 'Text', text: /◐/ })).toBeDefined()
    expect(
      await call($, { action: 'update', items: [{ id: 't2', status: 'done' }, { id: 't3', status: 'skipped' }] }),
    ).toContain('Done')
    expect(await band.find({ type: 'Text', text: /✓/ })).toBeDefined()
    await band.unmount()
    await call($, { action: 'remove', items: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] })
  }
})

test('the sidebar title carries the status icon', async ($, on) => {
  const titles: string[] = []
  engine(on, { titles })
  await call($, { action: 'add', items: [{ title: 'Deploy', kind: 'required' }] })
  await call($, { action: 'add', items: [{ title: 'Write docs', kind: 'optional' }] })
  await call($, { action: 'update', items: [{ id: 't1', status: 'done' }] })
  expect(titles).toEqual(['● Fix login bug', '◐ Fix login bug'])
})

test('an approved plan-mode plan becomes required tasks', async ($, on) => {
  engine(on, {
    plan: '# Plan: Rework login\n\nContext here.\n\n1. **Add** the session table\n2. Wire the `/login` route\n3. Write tests\n\n- a note bullet',
  })
  await $.tool.call({ tool: 'ExitPlanMode', tool_use_id: 'x' } as never)
  const list = await call($, { action: 'list' })
  expect(list).toContain('Plan "rework-login"')
  expect(list).toContain('t1 [required] [open] Add the session table')
  expect(list).toContain('t2 [required] [open] Wire the /login route')
  expect(list).toContain('3 required left')
})

test('the desktop step list is mirrored and checked off', async ($, on) => {
  engine(on)
  const steps = (input: Record<string, unknown>) =>
    $.tool.call({ tool: 'mcp__ccd_turn__update_plan', tool_use_id: String(Math.random()), ...input } as never)
  await steps({
    items: [
      { content: 'Read the config', status: 'in_progress' },
      { content: 'Change the setting', status: 'pending' },
    ],
  })
  expect(await call($, { action: 'list' })).toContain('2 required left')
  await steps({ advance: true })
  expect(await call($, { action: 'list' })).toContain('t1 [required] [done] Read the config')
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', tool_use_id: 'w', recap: 'done' } as never)
  expect(await call($, { action: 'list' })).toContain('Done')
})

test('another chat can join a plan and update it', async ($, on) => {
  const who = engine(on)
  await call($, { action: 'add', items: [{ title: 'Migrate users', kind: 'required' }] })
  const name = /Plan "([^"]+)"/.exec(await call($, { action: 'list' }))![1]!

  who.id = 'local_bbbbbb222'
  expect(await call($, { action: 'join', plan: name })).toContain('shared with 1 other chat')
  await call($, { action: 'update', items: [{ id: 't1', status: 'done' }] })

  who.id = 'local_aaaaaa111'
  expect(await call($, { action: 'join', plan: name })).toContain('[done] Migrate users')
})
