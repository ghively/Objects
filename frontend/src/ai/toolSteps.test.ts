// M16 T6: tool steps — the one-line summaries and the merge of `tool` events by id.
import { describe, expect, test } from 'vitest'
import type { AiEvent } from '@/api/types'
import { TOOL_STEP_TEXT, applyEvent, stopSteps, toolStepLine, type ChatPart, type ToolStepState } from './toolSteps'

function step(name: string, input: Record<string, unknown> | null, over: Partial<ToolStepState> = {}): ToolStepState {
  return { id: 't', name, input, result: null, isError: false, done: true, ...over }
}

const line = (name: string, input: Record<string, unknown> | null = {}) => toolStepLine(step(name, input))

describe('toolStepLine', () => {
  test("test lines for Object's tools", () => {
    expect(line('search', { query: 'rack' })).toBe("Searched notes for 'rack'")
    expect(line('set_properties', { path: 'Servers/Alpha.md' })).toBe('Edited Servers/Alpha.md')
    expect(line('read', { path: 'A.md' })).toBe('Read A.md')
    expect(line('create_task', { title: 'Call' })).toBe("Created 'Call'")
    expect(line('create_object', { title: 'Note' })).toBe("Created 'Note'")
    expect(line('query')).toBe('Queried notes')
    expect(line('run_saved_query')).toBe('Ran a saved query')
    expect(line('peek', { path: 'B.md' })).toBe('Looked at B.md')
    expect(line('backlinks', { path: 'B.md' })).toBe('Found links to B.md')
    expect(line('daily_note', { date: '2026-11-05' })).toBe('Opened the daily note for 2026-11-05')
    expect(line('changes_since')).toBe('Checked recent changes')
    expect(line('schema')).toBe("Read the space's types")
    for (const n of ['add_tags', 'add_to_collection', 'append_to_section', 'replace_section']) {
      expect(line(n, { path: 'C.md' })).toBe('Edited C.md')
    }
    expect(line('rename', { path: 'C.md', title: 'D' })).toBe("Renamed C.md to 'D'")
    expect(line('move_to_trash', { path: 'C.md' })).toBe('Moved C.md to the Trash')
  })

  test("test the learning tools' lines", () => {
    // M18's table.
    expect(line('memory', { action: 'add', target: 'memory', content: 'x' })).toBe('Saved a memory')
    expect(line('memory', { action: 'replace', target: 'memory' })).toBe('Changed a memory')
    expect(line('memory', { action: 'remove', target: 'memory' })).toBe('Removed a memory')
    expect(line('memory', { action: 'add', target: 'user' })).toBe('Saved a memory about you')
    expect(line('memory', { action: 'replace', target: 'user' })).toBe('Changed a memory about you')
    expect(line('memory', { action: 'remove', target: 'user' })).toBe('Removed a memory about you')
    expect(line('skills_list')).toBe('Listed skills')
    expect(line('skill_view', { name: 'rack-labels' })).toBe("Read the skill 'rack-labels'")
    expect(line('skill_manage', { action: 'create', name: 'rack-labels' })).toBe("Created the skill 'rack-labels'")
    for (const a of ['patch', 'edit', 'write_file', 'remove_file']) {
      expect(line('skill_manage', { action: a, name: 'rack-labels' })).toBe("Updated the skill 'rack-labels'")
    }
    expect(line('skill_manage', { action: 'archive', name: 'rack-labels' })).toBe("Archived the skill 'rack-labels'")
    expect(line('session_search', { query: 'rack' })).toBe("Searched past chats for 'rack'")
    expect(line('session_search', { chat_id: '01JCHAT' })).toBe('Read a past chat')
    expect(line('Skill', { skill: 'rack-labels' })).toBe("Used the skill 'rack-labels'")
    // A failed call gets the suffix.
    expect(toolStepLine(step('skill_view', { name: 'rack-labels' }, { isError: true }))).toBe("Read the skill 'rack-labels' (failed)")
    // An unshortened name gets the same line.
    expect(line('mcp__object-agent__skills_list')).toBe('Listed skills')
  })

  test('test a missing value drops the clause', () => {
    expect(line('search', {})).toBe('Searched notes')
    expect(line('search', null)).toBe('Searched notes')
    expect(line('search', { query: '' })).toBe('Searched notes')
    expect(line('read', {})).toBe('Read')
  })

  test('test lines for built-ins and other servers', () => {
    expect(line('Grep', { pattern: 'rack' })).toBe("Searched files for 'rack'")
    expect(line('Glob', { pattern: '*.md' })).toBe("Listed files matching '*.md'")
    expect(line('Read', { file_path: 'C:/x.md' })).toBe('Read C:/x.md')
    expect(line('Write', { file_path: 'C:/x.md' })).toBe('Wrote C:/x.md')
    expect(line('Edit', { file_path: 'C:/x.md' })).toBe('Edited C:/x.md')
    expect(line('NotebookEdit', { notebook_path: 'n.ipynb' })).toBe('Edited n.ipynb')
    expect(line('WebSearch', { query: 'katex' })).toBe("Searched the web for 'katex'")
    expect(line('WebFetch', { url: 'https://example.org' })).toBe('Fetched https://example.org')
    expect(line('Bash', { command: 'ls\nrm x' })).toBe('Ran ls')
    expect(line('PowerShell', { command: 'Get-ChildItem' })).toBe('Ran Get-ChildItem')
    expect(line('Task')).toBe('Ran a subagent')
    expect(line('Agent')).toBe('Ran a subagent')
    expect(line('mcp__docs__search')).toBe('Used search (docs)')
    expect(line('Mystery')).toBe('Used Mystery')
  })

  test("test the new tools' lines", () => {
    // M17: the expanded Object tools and the agent tools.
    for (const n of ['write_body', 'remove_tags', 'remove_from_collection', 'link_mention']) {
      expect(line(n, { path: 'C.md' })).toBe('Edited C.md')
    }
    expect(line('open_daily_note', { date: '2026-11-06' })).toBe('Opened the daily note for 2026-11-06')
    expect(line('duplicate', { path: 'C.md' })).toBe('Duplicated C.md')
    expect(line('change_type', { path: 'C.md' })).toBe('Changed the type of C.md')
    expect(line('merge', { source: 'A.md', target: 'B.md' })).toBe('Merged A.md into B.md')
    for (const n of ['create_tag', 'create_type', 'create_collection', 'create_query', 'create_automation']) {
      expect(line(n, { name: 'Rack' })).toBe("Created 'Rack'")
    }
    expect(line('create_whiteboard', { title: 'Plan' })).toBe("Created 'Plan'")
    for (const n of ['edit_type', 'edit_collection', 'edit_query', 'edit_whiteboard', 'change_property_kind']) {
      expect(line(n, { path: 'W.md' })).toBe('Edited a definition')
    }
    for (const n of ['delete_type', 'delete_collection', 'delete_query']) {
      expect(line(n)).toBe('Moved a definition to the Trash')
    }
    for (const n of ['type_definition', 'collection', 'saved_query']) {
      expect(line(n)).toBe("Read the space's types")
    }
    expect(line('read_whiteboard', { path: 'W.md' })).toBe('Read W.md')
    expect(line('version_history', { path: 'C.md' })).toBe('Looked at the history of C.md')
    expect(line('read_version', { path: 'C.md', version_id: 'v1' })).toBe('Looked at the history of C.md')
    expect(line('restore_version', { path: 'C.md' })).toBe('Restored a version of C.md')
    expect(line('unlinked_mentions', { path: 'C.md' })).toBe('Found mentions of C.md')
    expect(line('trash')).toBe('Looked in the Trash')
    expect(line('restore_from_trash', { trash_id: 'x' })).toBe('Restored from the Trash')
    expect(line('automations')).toBe('Listed automations')
    expect(line('run_automation', { rule_id: 'r' })).toBe('Ran an automation')
    expect(line('import_preview', { path: '/x' })).toBe('Previewed an import')
    expect(line('start_import', { preview_id: 'p' })).toBe('Started an import')
    expect(line('import_status', { job_id: 'j' })).toBe('Checked an import')
    expect(line('agent_info')).toBe('Looked up this agent')
  })

  test("test the A2A tools' lines", () => {
    // M20: the three agent tools that reach other agents.
    expect(line('remote_agents_list')).toBe('Listed remote agents')
    expect(line('remote_agent_call', { agent: 'Fake Planner', message: 'Hi' })).toBe('Asked Fake Planner')
    expect(line('delegate', { agent: 'Researcher', goal: 'List rack pages' })).toBe('Handed a task to Researcher')
  })

  test('test schedule_manage lines', () => {
    // M21's table.
    expect(line('schedule_manage', { action: 'list' })).toBe('Listed schedules')
    expect(line('schedule_manage', { action: 'create', name: 'Weekly review', prompt: 'x', repeat: 'every day' })).toBe(
      "Created the schedule 'Weekly review'",
    )
    expect(line('schedule_manage', { action: 'update', schedule_id: 'r1', enabled: false })).toBe('Changed a schedule')
    expect(line('schedule_manage', { action: 'delete', schedule_id: 'r1' })).toBe('Moved a schedule to the Trash')
    expect(line('mcp__object-agent__schedule_manage', { action: 'list' })).toBe('Listed schedules')
  })

  test('test long values are cut at 60 characters', () => {
    const q = 'x'.repeat(61)
    expect(line('search', { query: q })).toBe(`Searched notes for '${'x'.repeat(60)}…'`)
    expect(line('search', { query: 'y'.repeat(60) })).toBe(`Searched notes for '${'y'.repeat(60)}'`)
  })

  test('test failed and stopped suffixes', () => {
    expect(toolStepLine(step('search', { query: 'rack' }, { isError: true, result: 'boom' }))).toBe(
      "Searched notes for 'rack' (failed)",
    )
    expect(toolStepLine(step('search', { query: 'rack' }, { done: false, stopped: true }))).toBe(
      "Searched notes for 'rack' (stopped)",
    )
    expect(toolStepLine(step('search', { query: 'rack' }, { done: false }))).toBe("Searched notes for 'rack'")
    expect(TOOL_STEP_TEXT.input).toBe('Input')
    expect(TOOL_STEP_TEXT.result).toBe('Result')
    expect(TOOL_STEP_TEXT.noResult).toBe('No result')
  })
})

const call = (id: string, name = 'search', input: Record<string, unknown> | null = { query: 'rack' }): AiEvent => ({
  type: 'tool',
  id,
  name,
  input,
})
const result = (id: string, text: string, isError = false): AiEvent => ({
  type: 'tool',
  id,
  name: 'search',
  input: null,
  result: text,
  isError,
})
const text = (t: string): AiEvent => ({ type: 'text', text: t })

function run(events: AiEvent[], start: ChatPart[] = []): ChatPart[] {
  return events.reduce(applyEvent, start)
}

describe('applyEvent', () => {
  test('test applyEvent keeps stream order', () => {
    const parts = run([text('Let me look.'), call('t1'), text('Found it.')])
    expect(parts.map((p) => p.kind)).toEqual(['text', 'tool', 'text'])
    expect(parts[0]).toEqual({ kind: 'text', text: 'Let me look.' })
    expect(parts[2]).toEqual({ kind: 'text', text: 'Found it.' })
    const pending = parts[1]
    expect(pending.kind === 'tool' && pending.step).toEqual({
      id: 't1',
      name: 'search',
      input: { query: 'rack' },
      result: null,
      isError: false,
      done: false,
    })
    const joined = run([text('a'), text('b')])
    expect(joined).toEqual([{ kind: 'text', text: 'ab' }])
  })

  test('test a result fills the step with its id', () => {
    const parts = run([call('t1'), call('t2', 'read', { path: 'A.md' }), result('t2', 'body', true), result('t1', '[]')])
    expect(parts).toHaveLength(2)
    const [a, b] = parts
    expect(a.kind === 'tool' && a.step).toEqual({
      id: 't1',
      name: 'search',
      input: { query: 'rack' },
      result: '[]',
      isError: false,
      done: true,
    })
    expect(b.kind === 'tool' && b.step).toMatchObject({ id: 't2', name: 'read', input: { path: 'A.md' }, result: 'body', isError: true, done: true })
  })

  test('test an unknown id changes nothing', () => {
    const before = run([text('x'), call('t1')])
    const after = applyEvent(before, result('t9', 'nope'))
    expect(after).toBe(before)
    expect(after).toEqual(run([text('x'), call('t1')]))
    // Other events are not parts.
    expect(applyEvent(before, { type: 'session', sessionId: 's' })).toBe(before)
  })

  test('test applyEvent does not change its input', () => {
    const before = run([text('a'), call('t1')])
    const copy = JSON.parse(JSON.stringify(before)) as ChatPart[]
    run([text('b'), result('t1', 'r')], before)
    expect(before).toEqual(copy)
  })

  test('test stopSteps marks only pending steps', () => {
    const parts = run([call('t1'), result('t1', 'r'), text('a'), call('t2')])
    const stopped = stopSteps(parts)
    const steps = stopped.flatMap((p) => (p.kind === 'tool' ? [p.step] : []))
    expect(steps.map((s) => !!s.stopped)).toEqual([false, true])
    expect(stopped[1]).toEqual({ kind: 'text', text: 'a' })
    expect(toolStepLine(steps[1])).toBe("Searched notes for 'rack' (stopped)")
  })
})
