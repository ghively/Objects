import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('../media/recordAudio', async (orig) => ({
  ...(await orig<typeof import('../media/recordAudio')>()),
  recordAudio: vi.fn(async () => undefined),
}))

import { api } from '@/api/client'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { recordAudio } from '../media/recordAudio'
import { setObjectEmbedPicker } from '../nodes/objectEmbed'
import { resetAiStore, useAi } from '@/ai/store'
import { setEditorObject } from '../nodes/blockRef'
import {
  AI_ITEMS,
  BLOCK_ITEMS,
  COLOR_ITEMS,
  dailyNoteTitle,
  dayLabel,
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
  test('slash menu sections and item names', () => {
    const sections = slashSections(ctx())
    expect(sections.map((s) => s.label)).toEqual(['Create a block', 'Create an object', 'Link to a date', 'Reuse any content'])
    // The menu order (reference check 2026-10-28, 2d).
    expect(sections[0].items.map((i) => [i.name, i.description ?? null])).toEqual([
      ['Standard', 'Show this block as ordinary text'],
      ['Small', 'Show this block in smaller type'],
      ['Heading 1', 'Biggest heading'],
      ['Heading 2', 'Large heading'],
      ['Heading 3', 'Medium heading'],
      ['Heading 4', 'Small heading'],
      ['Bullet list', 'Turn this block into a bulleted item'],
      ['Alphabetical list', 'Turn this block into a lettered item'],
      ['Numbered list', 'Turn this block into a numbered item'],
      ['Roman list', 'Turn this block into a roman-numeral item'],
      ['Quote block', 'Show this block as a quotation'],
      ['To-do', 'Turn this block into a checkbox item'],
      ['Toggle', 'Make this block collapsible'],
      ['Icon', 'Put an icon in front of this block'],
      ['Group', 'Keep several blocks together in one box'],
      ['Ask AI about this block', null], // M10: the AI items, after the (search-only) colour items
      ['Let AI suggest tags for this block', null],
      ['Record audio', 'Record from the microphone and drop the clip here'],
      ['Math', 'An equation on its own line'],
      ['Code', 'A code block'],
      ['Horizontal line', 'A divider line between parts of the page'],
      ['Two Columns', 'Lay groups of blocks out side by side'],
      ['Table', 'Rows and columns of cells'],
      ['Create bookmark', null], // ours: Object's only way to insert a bookmark
      ['Button', 'A button that runs an automation on this object'], // M14 (ours)
    ])
    // The expected icons.
    expect(Object.fromEntries(sections[0].items.map((i) => [i.id, i.icon]))).toMatchObject({
      Base: 'ph-text-t',
      S: 'ph-text-aa',
      H1: 'ph-text-h',
      alphabetical: 'ph-list-numbers',
      toggle: 'ph-caret-right-fill',
      group: 'ph-rectangle',
      math: 'ph-function',
      columns: 'ph-columns',
    })
    // One item per type (whiteboards are created from "+ New").
    expect(sections[1].items.map((i) => i.name)).toEqual(['Create Page', 'Create Person'])
    expect(slashSections(ctx('Q3 plan'))[1].items.map((i) => i.name)).toEqual([
      'Create Page with title "Q3 plan"',
      'Create Person with title "Q3 plan"',
    ])
    // Catalog item 41: Time, Now, Today, Tomorrow, Yesterday, In a week, A week ago.
    expect(sections[2].items.map((i) => [i.name, i.description])).toEqual([
      ['Now - timestamp', 'Insert the time right now'],
      ['Today - date link', "Insert today's date as a link"],
      ['Today', "Link today's daily note here"],
      ['Tomorrow', "Link tomorrow's daily note here"],
      ['Yesterday', "Link yesterday's daily note here"],
      ['In a week', 'Add a link to the daily note a week from today'],
      ['A week ago', 'Add a link to the daily note of a week ago'],
    ])
    // No description ends with a full stop (they are labels, not sentences).
    for (const s of sections) for (const i of s.items) expect(i.description ?? '', i.id).not.toMatch(/\.$/)
    expect(sections[3].items.map((i) => i.name)).toEqual(['Reuse any content'])
  })

  test('slash filter matches names and descriptions; no match shows No results', () => {
    const names = (q: string, types = TYPES) =>
      filterSections(slashSections(ctx(q, { types })), q).flatMap((s) => s.items.map((i) => i.name))
    // Best match first: the name hits come before loose description hits.
    expect(names('head', []).slice(0, 4)).toEqual(['Heading 1', 'Heading 2', 'Heading 3', 'Heading 4'])
    expect(names('roman', [])[0]).toBe('Roman list')
    // By description: "A divider line between parts of the page".
    expect(names('between parts', [])).toContain('Horizontal line')
    expect(names('zzqx', [])).toEqual([])
    // The object items carry the query as the title, so they stay.
    expect(names('zzqx')).toEqual(['Create Page with title "zzqx"', 'Create Person with title "zzqx"'])
    expect(hasRealMatch(slashSections(ctx('zzqx ')), 'zzqx ')).toBe(false)
    expect(hasRealMatch(slashSections(ctx('tab')), 'tab')).toBe(true)
  })
})

describe('each block item runs its command', () => {
  const cases: [string, string | ((e: TiptapEditor, view: unknown) => void)][] = [
    ['Base', 'Hello\n\nWorld\n'],
    ['S', '<!-- block: small -->\nHello\n\nWorld\n'],
    ['H1', '# Hello\n\nWorld\n'],
    ['H2', '## Hello\n\nWorld\n'],
    ['H3', '### Hello\n\nWorld\n'],
    ['H4', '#### Hello\n\nWorld\n'],
    ['bullet', '- Hello\n\nWorld\n'],
    ['alphabetical', '<!-- block: list=alphabetical -->\n1. Hello\n\nWorld\n'],
    ['numerical', '1. Hello\n\nWorld\n'],
    ['roman', '<!-- block: list=roman -->\n1. Hello\n\nWorld\n'],
    ['quote', '> Hello\n\nWorld\n'],
    ['todo', '- [ ] Hello\n\nWorld\n'],
    ['toggle', '<!-- toggle open -->\nHello\n<!-- /toggle -->\n\nWorld\n'],
    ['icon', (_e, view) => expect(view).toBe('icon')],
    ['group', '<!-- group -->\nHello\n<!-- /group -->\n\nWorld\n'],
    ['recordAudio', (e) => expect(recordAudio).toHaveBeenCalledWith(e)],
    ['math', (e) => expect(e.state.doc.child(1).type.name).toBe('mathBlock')],
    ['code', '```\nHello\n```\n\nWorld\n'],
    ['hr', (e) => expect(serializeBody(e)).toBe('Hello\n\n---\n\nWorld\n')],
    ['columns', (e) => expect(e.state.doc.child(1).type.name).toBe('columns')],
    ['table', (e) => expect(e.state.doc.child(1).type.name).toBe('table')],
    ['bookmark', (_e, view) => expect(view).toBe('bookmark')],
    ['button', (_e, view) => expect(view).toBe('button')],
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

  test('sweep 2026-11-08 #6: Table inserts the catalog default, 2 columns by 3 rows with a header row', () => {
    const editor = headless('Hello\n\nWorld\n')
    BLOCK_ITEMS.find((i) => i.id === 'table')!.run(editor)
    const table = editor.state.doc.child(1)
    expect(table.type.name).toBe('table')
    expect(table.childCount).toBe(3)
    const rows: string[][] = []
    table.forEach((row) => {
      const cells: string[] = []
      row.forEach((cell) => cells.push(cell.type.name))
      rows.push(cells)
    })
    expect(rows).toEqual([
      ['tableHeader', 'tableHeader'],
      ['tableCell', 'tableCell'],
      ['tableCell', 'tableCell'],
    ])
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

  test('sweep 2026-11-08 #7: the "Link to a date" section leads with the time items, in one dash style', () => {
    const items = slashSections(ctx())[2].items
    expect(items.slice(0, 2).map((i) => i.id)).toEqual(['timestamp', 'dateLink'])
    expect(items.map((i) => i.id)).toEqual(['timestamp', 'dateLink', 'today', 'tomorrow', 'yesterday', 'inAWeek', 'aWeekAgo'])
    for (const i of items) expect(i.name, i.id).not.toMatch(/[–—]/)
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
    expect(run('inAWeek')).toBe('Hello[[2026-11-03]]\n')
    expect(run('aWeekAgo')).toBe('Hello[[2026-10-20]]\n')
    // M8: "Today - date link" inserts a date token.
    expect(run('dateLink')).toBe('Hello<time datetime="2026-10-27">2026-10-27</time>\n')
    expect(run('timestamp')).toBe('Hello2:05 PM\n')
    expect(run('timestamp', true)).toBe('Hello14:05\n')
    expect(dailyNoteTitle(new Date(2026, 0, 3))).toBe('2026-01-03')
    expect(timestampText(new Date(2026, 0, 3, 0, 7), false)).toBe('12:07 AM')
  })
})

describe('m8 typed dates and reuse items', () => {
  const now = new Date(2026, 9, 27, 9, 0) // Tuesday

  test('a typed date gives a daily-note link and a date token, first in its section', () => {
    const q = 'next friday'
    const sections = filterSections(slashSections(ctx(q, { now })), q)
    const dates = sections.find((s) => s.id === 'dates')!
    expect(dates.items.slice(0, 2).map((i) => [i.name, i.description])).toEqual([
      ['Fri, Oct 30, 2026', 'Add a link to this daily note'],
      ['Fri, Oct 30, 2026 - date link', 'Add a link to this date'],
    ])
    // Sweep 2026-11-08 #7: before filtering, the typed date stays first and the time items lead the fixed ones.
    expect(
      slashSections(ctx(q, { now }))[2]
        .items.slice(0, 4)
        .map((i) => i.id),
    ).toEqual(['date:2026-10-30', 'dateToken:2026-10-30', 'timestamp', 'dateLink'])
    const run = (index: number) => {
      const editor = headless('Hello\n')
      editor.commands.setTextSelection(6)
      dates.items[index].run(editor)
      return serializeBody(editor)
    }
    expect(run(0)).toBe('Hello[[2026-10-30]]\n')
    expect(run(1)).toBe('Hello<time datetime="2026-10-30">2026-10-30</time>\n')
    // ISO days, relative phrases and month names; nothing for other text.
    expect(slashSections(ctx('2026-12-24', { now }))[2].items[0].name).toBe(dayLabel('2026-12-24'))
    expect(slashSections(ctx('in 2 weeks', { now }))[2].items[0].id).toBe('date:2026-11-10')
    expect(slashSections(ctx('march 15', { now }))[2].items[0].id).toBe('date:2026-03-15')
    expect(slashSections(ctx('hello', { now }))[2].items[0].id).toBe('timestamp')
    // A phrase being typed keeps the menu open on a space.
    expect(hasRealMatch(slashSections(ctx('next ', { now })), 'next ', now)).toBe(true)
  })

  test('reuse offers collections and queries as live views', () => {
    const sections = slashSections(
      ctx('', { collections: [{ id: 'reading-list', name: 'Reading list' }], queries: [{ id: 'open-tasks', name: 'Open tasks' }] }),
    )
    const reuse = sections.find((s) => s.id === 'reuse')!
    expect(reuse.items.map((i) => [i.name, i.description ?? null])).toEqual([
      ['Reuse any content', null],
      ['Reading list', 'Embed this collection'],
      ['Open tasks', 'Embed this query'],
    ])
    const editor = headless('Hello\n')
    editor.commands.setTextSelection(6)
    reuse.items[1].run(editor)
    reuse.items[2].run(editor)
    expect(serializeBody(editor)).toBe('Hello\n\n![[collection:reading-list]]\n\n![[query:open-tasks]]\n')
  })
})

describe('search-only items', () => {
  test('colour items and Mermaid Diagram appear only while searching', () => {
    const ids = (q: string) => slashSections(ctx(q))[0].items.map((i) => i.id)
    expect(ids('')).not.toContain('mermaid')
    expect(ids('').some((id) => id.startsWith('color:'))).toBe(false)
    expect(ids('b')).toContain('mermaid')
    // 18 backgrounds, then 18 text colours.
    expect(COLOR_ITEMS).toHaveLength(36)
    expect(COLOR_ITEMS[0].name).toBe('Gray background')
    expect(COLOR_ITEMS[18].name).toBe('Gray text')
    expect(COLOR_ITEMS[7]).toMatchObject({ name: 'Blue background', icon: 'ph-stop' })
    expect(COLOR_ITEMS[25]).toMatchObject({ name: 'Blue text', icon: 'ph-text-aa' })
    const names = (q: string) => filterSections(slashSections(ctx(q, { types: [] })), q).flatMap((s) => s.items.map((i) => i.name))
    expect(names('blue background')[0]).toBe('Blue background')
    // Aliases: `mmd`, `h1`.
    expect(names('mmd')[0]).toBe('Mermaid Diagram')
    expect(names('h1')[0]).toBe('Heading 1')
  })

  test('a colour item sets the block colour; Mermaid Diagram makes a mermaid code block', () => {
    const editor = headless('Hello\n\nWorld\n')
    COLOR_ITEMS.find((i) => i.id === 'color:bg-blue')!.run(editor)
    expect(serializeBody(editor)).toBe('<!-- block: color=bg-blue -->\nHello\n\nWorld\n')
    const mermaid = slashSections(ctx('mmd'))[0].items.find((i) => i.id === 'mermaid')!
    // Sweep 2026-11-08 #7: its own description, not Code's.
    expect(mermaid).toMatchObject({ name: 'Mermaid Diagram', description: 'A Mermaid diagram in a code block', alias: 'mmd' })
    const other = headless('graph TD\n')
    mermaid.run(other)
    expect(serializeBody(other)).toBe('```mermaid\ngraph TD\n```\n')
  })
})

describe('m10 AI items', () => {
  afterEach(() => resetAiStore())

  test('the AI items follow the colour items, before Record audio; hidden with AI features', () => {
    const ids = (q: string, extra: Partial<SlashContext> = {}) => slashSections(ctx(q, extra))[0].items.map((i) => i.id)
    expect(AI_ITEMS.map((i) => [i.name, i.icon])).toEqual([
      ['Ask AI about this block', 'ph-sparkle'],
      ['Let AI suggest tags for this block', 'ph-sparkle'],
    ])
    const plain = ids('')
    expect(plain.slice(plain.indexOf('group'), plain.indexOf('group') + 4)).toEqual(['group', 'ai:askBlock', 'ai:tagBlock', 'recordAudio'])
    const searching = ids('a')
    expect(searching.indexOf('ai:askBlock')).toBe(searching.indexOf(COLOR_ITEMS[COLOR_ITEMS.length - 1].id) + 1)
    expect(searching.indexOf('recordAudio')).toBe(searching.indexOf('ai:tagBlock') + 1)
    expect(ids('', { aiHidden: true }).some((id) => id.startsWith('ai:'))).toBe(false)
    const names = filterSections(slashSections(ctx('ask ai', { types: [] })), 'ask ai').flatMap((s) => s.items.map((i) => i.name))
    expect(names[0]).toBe('Ask AI about this block')
  })

  test.each([
    ['ai:askBlock', 'askBlock'],
    ['ai:tagBlock', 'tagBlock'],
  ] as const)('%s opens the AI chat about the block with the cursor', (id, mode) => {
    const editor = headless('Hello\n\nWorld\n')
    setEditorObject(editor, { path: 'Pages/Hello.md' })
    AI_ITEMS.find((i) => i.id === id)!.run(editor)
    expect(useAi.getState().pending?.seed).toMatchObject({ mode, block: 'Hello', contextPaths: ['Pages/Hello.md'] })
    useAi.getState().pending!.seed.onInsertBelow!('Answer')
    expect(serializeBody(editor)).toBe('Hello\n\nAnswer\n\nWorld\n')
  })
})
