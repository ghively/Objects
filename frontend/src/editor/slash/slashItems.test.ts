import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('../media/upload', async (orig) => ({
  ...(await orig<typeof import('../media/upload')>()),
  pickAndInsert: vi.fn(),
}))

import { api } from '@/api/client'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { pickAndInsert } from '../media/upload'
import { setObjectEmbedPicker } from '../nodes/objectEmbed'
import {
  BLOCK_ITEMS,
  dailyNoteTitle,
  filterSections,
  hasRealMatch,
  slashSections,
  timestampText,
  type SlashContext,
} from './slashItems'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
  setObjectEmbedPicker(null)
})

function headless(body: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)))
  return editor
}

const TYPES = [typeDef({ id: 'page', name: 'Page', basic: true }), typeDef({ id: 'person', name: 'Person' }), typeDef({ id: 'wb', name: 'Whiteboard', basic: true })]
const ctx = (query = '', extra: Partial<SlashContext> = {}): SlashContext => ({ query, types: TYPES, twentyFourHourTime: false, ...extra })

describe('slash items', () => {
  test('slash menu sections and item names match reference', () => {
    const sections = slashSections(ctx())
    expect(sections.map((s) => s.label)).toEqual(['Create a block', 'Create an object', 'Link to a date', 'Reuse any content'])
    expect(sections[0].items.map((i) => [i.name, i.description ?? null])).toEqual([
      ['Text', 'Just text'],
      ['Heading 1', 'Block with a heading level 1'],
      ['Heading 2', 'Block with a heading level 2'],
      ['Heading 3', 'Block with a heading level 3'],
      ['Heading 4', 'Block with a heading level 4'],
      ['Small', 'Turn block into a small text block'],
      ['Bullet list', 'Add a bullet list to this block'],
      ['Numbered list', 'Add a numbered list to this block'],
      ['Alphabetical list', 'Add an alphabetical list to this block'],
      ['Roman list', 'Add a roman list to this block'],
      ['To-do', 'Add a To-do box to this block'],
      ['Toggle', 'Add a toggle to this block'],
      ['Quote block', 'Turn block into a quote block'],
      ['Group', 'A layout element to group multiple blocks into one container'],
      ['Icon', 'Add an icon to this block'],
      ['Text', 'Change the text color of this block'],
      ['Background', 'Change the background color of this block'],
      ['Two Columns', 'Multiple blocks groups next to each other'],
      ['Horizontal line', 'A horizontal line to separate different sections'],
      ['Code', 'A code block'],
      ['Math', 'A display style math block'],
      ['Table', 'A simple block for tabular content'],
      ['Insert image', null],
      ['Insert PDF', null],
      ['Insert audio', null],
      ['Insert video', null],
      ['Insert file', null],
      ['Create bookmark', null],
    ])
    // One item per type (whiteboards are created from "+ New").
    expect(sections[1].items.map((i) => i.name)).toEqual(['Create Page', 'Create Person'])
    expect(slashSections(ctx('Q3 plan'))[1].items.map((i) => i.name)).toEqual([
      'Create Page with title "Q3 plan"',
      'Create Person with title "Q3 plan"',
    ])
    expect(sections[2].items.map((i) => [i.name, i.description])).toEqual([
      ['Today', "Add a link to today's daily note"],
      ['Tomorrow', "Add a link to tomorrow's daily note"],
      ['Yesterday', "Add a link to yesterday's daily note"],
      ['Today - date link', "Add a link to today's date."],
      ['Now – timestamp', 'Add a timestamp with the current time'],
    ])
    expect(sections[3].items.map((i) => i.name)).toEqual(['Reuse any content'])
  })

  test('slash filter matches names and descriptions; no match shows No results', () => {
    const names = (q: string, types = TYPES) =>
      filterSections(slashSections(ctx(q, { types })), q).flatMap((s) => s.items.map((i) => i.name))
    // Best match first: the name hits come before loose description hits.
    expect(names('head', []).slice(0, 4)).toEqual(['Heading 1', 'Heading 2', 'Heading 3', 'Heading 4'])
    expect(names('roman', [])[0]).toBe('Roman list')
    // By description: "A horizontal line to separate different sections".
    expect(names('separate', [])).toContain('Horizontal line')
    expect(names('zzqx', [])).toEqual([])
    // The object items carry the query as the title, so they stay.
    expect(names('zzqx')).toEqual(['Create Page with title "zzqx"', 'Create Person with title "zzqx"'])
    expect(hasRealMatch(slashSections(ctx('zzqx ')), 'zzqx ')).toBe(false)
    expect(hasRealMatch(slashSections(ctx('tab')), 'tab')).toBe(true)
  })
})

describe('each block item runs its command', () => {
  beforeEach(() => vi.mocked(pickAndInsert).mockClear())

  const cases: [string, string | ((e: TiptapEditor, view: unknown) => void)][] = [
    ['text', 'Hello\n\nWorld\n'],
    ['H1', '# Hello\n\nWorld\n'],
    ['H2', '## Hello\n\nWorld\n'],
    ['H3', '### Hello\n\nWorld\n'],
    ['H4', '#### Hello\n\nWorld\n'],
    ['S', '<!-- block: small -->\nHello\n\nWorld\n'],
    ['bullet', '- Hello\n\nWorld\n'],
    ['numerical', '1. Hello\n\nWorld\n'],
    ['alphabetical', '<!-- block: list=alphabetical -->\n1. Hello\n\nWorld\n'],
    ['roman', '<!-- block: list=roman -->\n1. Hello\n\nWorld\n'],
    ['todo', '- [ ] Hello\n\nWorld\n'],
    ['toggle', '<!-- toggle open -->\nHello\n<!-- /toggle -->\n\nWorld\n'],
    ['quote', '> Hello\n\nWorld\n'],
    ['group', '<!-- group -->\nHello\n<!-- /group -->\n\nWorld\n'],
    ['icon', (_e, view) => expect(view).toBe('icon')],
    ['colorText', (_e, view) => expect(view).toBe('colorText')],
    ['colorBg', (_e, view) => expect(view).toBe('colorBg')],
    ['columns', (e) => expect(e.state.doc.child(1).type.name).toBe('columns')],
    ['hr', (e) => expect(serializeBody(e)).toBe('Hello\n\n---\n\nWorld\n')],
    ['code', '```\nHello\n```\n\nWorld\n'],
    ['math', (e) => expect(e.state.doc.child(1).type.name).toBe('mathBlock')],
    ['table', (e) => expect(e.state.doc.child(1).type.name).toBe('table')],
    ['image', () => expect(pickAndInsert).toHaveBeenCalledWith(expect.anything(), 'image')],
    ['pdf', () => expect(pickAndInsert).toHaveBeenCalledWith(expect.anything(), 'pdf')],
    ['audio', () => expect(pickAndInsert).toHaveBeenCalledWith(expect.anything(), 'audio')],
    ['video', () => expect(pickAndInsert).toHaveBeenCalledWith(expect.anything(), 'video')],
    ['file', () => expect(pickAndInsert).toHaveBeenCalledWith(expect.anything(), 'file')],
    ['bookmark', (_e, view) => expect(view).toBe('bookmark')],
  ]

  test('every block item has a case', () => {
    expect(cases.map((c) => c[0])).toEqual(BLOCK_ITEMS.map((i) => i.id))
  })

  test.each(cases)('%s', (id, expected) => {
    const editor = headless('Hello\n\nWorld\n')
    const item = BLOCK_ITEMS.find((i) => i.id === id)!
    const view = item.run(editor)
    if (typeof expected === 'string') expect(serializeBody(editor)).toBe(expected)
    else expected(editor, view)
  })

  test('reuse any content opens the embed picker', () => {
    const picker = vi.fn()
    setObjectEmbedPicker(picker)
    const editor = headless('Hello\n')
    const reuse = slashSections(ctx()).find((s) => s.id === 'reuse')!.items[0]
    reuse.run(editor)
    expect(picker).toHaveBeenCalledTimes(1)
  })
})

describe('object and date items', () => {
  test('create object item creates with the query as title and inserts a link', async () => {
    const createObject = vi.spyOn(api, 'createObject')
    const editor = headless('Hello\n')
    editor.commands.setTextSelection(6)
    const item = slashSections(ctx('Q3 plan'))[1].items[1]
    expect(item.name).toBe('Create Person with title "Q3 plan"')
    await item.run(editor)
    expect(createObject).toHaveBeenCalledWith('person', { title: 'Q3 plan' })
    expect(serializeBody(editor)).toBe('Hello[[Q3 plan]]\n')

    // No query: the new object's file name is the link.
    const empty = slashSections(ctx(''))[1].items[0]
    await empty.run(editor)
    expect(createObject).toHaveBeenLastCalledWith('page', {})
    expect(serializeBody(editor)).toBe('Hello[[Q3 plan]][[Untitled]]\n')
  })

  test('date items insert daily-note links and the timestamp in the chosen time format', () => {
    const now = new Date(2026, 9, 27, 14, 5)
    const run = (id: string, twentyFourHourTime = false) => {
      const editor = headless('Hello\n')
      editor.commands.setTextSelection(6)
      const item = slashSections(ctx('', { now, twentyFourHourTime }))[2].items.find((i) => i.id === id)!
      item.run(editor)
      return serializeBody(editor)
    }
    expect(run('today')).toBe('Hello[[2026-10-27]]\n')
    expect(run('tomorrow')).toBe('Hello[[2026-10-28]]\n')
    expect(run('yesterday')).toBe('Hello[[2026-10-26]]\n')
    expect(run('dateLink')).toBe('Hello[[2026-10-27]]\n')
    expect(run('timestamp')).toBe('Hello2:05 PM\n')
    expect(run('timestamp', true)).toBe('Hello14:05\n')
    expect(dailyNoteTitle(new Date(2026, 0, 3))).toBe('2026-01-03')
    expect(timestampText(new Date(2026, 0, 3, 0, 7), false)).toBe('12:07 AM')
  })
})
