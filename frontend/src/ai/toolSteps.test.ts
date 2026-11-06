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
