import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

function session(on: On) {
  on('session.id', () => ({ value: 'test-session' }))
  on('session.cwd', () => ({ value: '/work' }))
  mock.clock(on)
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('classic.UserPromptSubmit', () => ({}))
}

const TOOL = 'mcp__chat-tasks__tasks'

test('tasks drive the band from "more to do" to "done"', async ($, on) => {
  session(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const added = await $.tool.call({
      tool: TOOL,
      tool_use_id: `add-${surface}`,
      action: 'add',
      items: [
        { title: 'Ship the fix', kind: 'required' },
        { title: 'Add a regression test', kind: 'recommended' },
        { title: 'Tidy the README', kind: 'optional' },
      ],
    } as never)
    expect(String((added as { result?: unknown }).result)).toContain('1 required, 1 recommended, 1 optional left')

    const band = await $.ui.mount({
      plugin: 'chat-tasks',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never,
    })
    expect(await band.find({ type: 'Text', text: /●/ })).toBeDefined()

    await $.tool.call({
      tool: TOOL,
      tool_use_id: `done-${surface}`,
      action: 'update',
      items: [{ id: 't1', status: 'done' }],
    } as never)
    expect(await band.find({ type: 'Text', text: /◐/ })).toBeDefined()

    const finished = await $.tool.call({
      tool: TOOL,
      tool_use_id: `rest-${surface}`,
      action: 'update',
      items: [
        { id: 't2', status: 'done' },
        { id: 't3', status: 'skipped' },
      ],
    } as never)
    expect(String((finished as { result?: unknown }).result)).toContain('Done')
    expect(await band.find({ type: 'Text', text: /✓/ })).toBeDefined()
    await band.unmount()

    await $.tool.call({
      tool: TOOL,
      tool_use_id: `clear-${surface}`,
      action: 'remove',
      items: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
    } as never)
  }
})

test('the chat title carries the status icon', async ($, on) => {
  session(on)
  await $.tool.call({
    tool: TOOL,
    tool_use_id: 'add',
    action: 'add',
    items: [{ title: 'Deploy', kind: 'required' }],
  } as never)
  const answer = await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Fix login bug' })
  expect(answer.sessionTitle).toBe('● Fix login bug')
})
