import { Editor as TiptapEditor } from '@tiptap/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, DailyNoteExistsError } from '@/api/client'
import { resetAiStore, useAi } from '@/ai/store'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { addDays, todayYmd } from '@/calendar/dates'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { blockSelectionRange, selectBlocks } from '../extensions/blockSelection'
import { setEditorObject } from '../nodes/blockRef'
import { BAR_EDGE_GAP, BLOCK_BAR_ITEMS, BLOCK_BAR_TEXT, BlockSelectionBar, barCentre } from './BlockSelectionBar'

const editors: TiptapEditor[] = []
afterEach(() => {
  cleanup()
  while (editors.length) editors.pop()!.destroy()
  document.body.innerHTML = ''
  vi.mocked(api.saveBody).mockClear()
})

function mounted(body: string): TiptapEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new TiptapEditor({ element, extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}

function blockPos(editor: TiptapEditor, i: number): number {
  let pos = 0
  for (let k = 0; k < i; k++) pos += editor.state.doc.child(k).nodeSize
  return pos
}

function select(editor: TiptapEditor, first: number, last = first) {
  act(() => {
    selectBlocks(editor, blockPos(editor, first), blockPos(editor, last))
  })
}

const selected = (editor: TiptapEditor) => blockSelectionRange(editor.state)?.blocks.map((b) => b.node.textContent) ?? []

const bar = () => screen.getByRole('toolbar', { name: BLOCK_BAR_TEXT.toolbar })

/** Open the bar's dropdown behind the button named `name` and return the menu. */
async function openMenu(name: string): Promise<HTMLElement> {
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  const trigger = within(bar()).getByRole('button', { name })
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
  return await screen.findByRole('menu')
}

const BODY = 'One two\n\nThree\n\nFour five six\n'

describe('<BlockSelectionBar>', () => {
  test('shows only while blocks are selected, with the block and word count', () => {
    const editor = mounted(BODY)
    render(<BlockSelectionBar editor={editor} />)
    expect(screen.queryByRole('toolbar')).toBeNull()

    select(editor, 0)
    expect(within(bar()).getByRole('button', { name: /^1 block · 2 words$/ })).toBeInTheDocument()
    select(editor, 0, 1)
    expect(within(bar()).getByRole('button', { name: /^2 blocks · 3 words$/ })).toBeInTheDocument()

    act(() => {
      editor.commands.setTextSelection(2)
    })
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  test("buttons in the bar's order: stats, formatting, then turn into, move, delete and close", () => {
    const editor = mounted(BODY)
    render(<BlockSelectionBar editor={editor} />)
    select(editor, 0)
    const names = within(bar())
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(names.slice(1)).toEqual([...BLOCK_BAR_ITEMS])
    expect(BLOCK_BAR_ITEMS).toEqual([
      'Bold',
      'Italic',
      'Strikethrough',
      'Underline',
      'Hierarchy',
      'List',
      'Toggle',
      'Quote',
      'To-do',
      'Icon',
      'Color',
      'Turn blocks into',
      'Move',
      'Delete selected blocks',
      'AI', // M10
      'Clear selection',
    ])
  })

  test('the stats dropdown counts the selected blocks', async () => {
    const editor = mounted('One two. Three.\n\nFour\n')
    render(<BlockSelectionBar editor={editor} />)
    select(editor, 0, 1)
    const menu = await openMenu('2 blocks · 4 words')
    expect(within(menu).getByText('Text stats')).toBeInTheDocument()
    const rows = within(menu)
      .getAllByRole('listitem')
      .map((r) => r.textContent)
    expect(rows).toEqual(['4 words', '3 sentences', '2 paragraphs', '20 characters'])
  })

  test('bold, italic, strikethrough and underline format every selected block and keep the selection', () => {
    const editor = mounted(BODY)
    render(<BlockSelectionBar editor={editor} />)
    select(editor, 0, 1)
    fireEvent.click(within(bar()).getByRole('button', { name: 'Bold' }))
    expect(serializeBody(editor)).toBe('**One two**\n\n**Three**\n\nFour five six\n')
    expect(selected(editor)).toEqual(['One two', 'Three'])
    fireEvent.click(within(bar()).getByRole('button', { name: 'Bold' }))
    expect(serializeBody(editor)).toBe(BODY)
    fireEvent.click(within(bar()).getByRole('button', { name: 'Italic' }))
    fireEvent.click(within(bar()).getByRole('button', { name: 'Strikethrough' }))
    fireEvent.click(within(bar()).getByRole('button', { name: 'Underline' }))
    expect(serializeBody(editor)).toMatch(/^\S*One two\S*\n\n\S*Three\S*\n\nFour five six\n$/)
    expect(editor.getJSON().content![0].content![0].marks!.map((m) => m.type).sort()).toEqual(['italic', 'strike', 'underline'])
    expect(selected(editor)).toEqual(['One two', 'Three'])
  })

  test('hierarchy and list dropdowns, toggle, quote and to-do apply to the selection', async () => {
    const editor = mounted(BODY)
    render(<BlockSelectionBar editor={editor} />)
    select(editor, 0, 1)
    fireEvent.click(within(await openMenu('Hierarchy')).getByRole('menuitem', { name: /^Heading 2/ }))
    expect(serializeBody(editor)).toBe('## One two\n\n## Three\n\nFour five six\n')
    expect(selected(editor)).toEqual(['One two', 'Three'])
    fireEvent.click(within(await openMenu('Hierarchy')).getByRole('menuitem', { name: /^Standard/ }))
    expect(serializeBody(editor)).toBe(BODY)

    fireEvent.click(within(bar()).getByRole('button', { name: 'Quote' }))
    expect(serializeBody(editor)).toBe('> One two\n\n> Three\n\nFour five six\n')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Quote' }))
    expect(serializeBody(editor)).toBe(BODY)

    fireEvent.click(within(await openMenu('List')).getByRole('menuitem', { name: /^Bulleted/ }))
    expect(serializeBody(editor)).toBe('- One two\n- Three\n\nFour five six\n')
    expect(selected(editor)).toEqual(['One twoThree'])
    fireEvent.click(within(await openMenu('List')).getByRole('menuitem', { name: /^No listing/ }))
    expect(serializeBody(editor)).toBe(BODY)

    select(editor, 2)
    fireEvent.click(within(bar()).getByRole('button', { name: 'To-do' }))
    expect(serializeBody(editor)).toBe('One two\n\nThree\n\n- [ ] Four five six\n')
    fireEvent.click(within(bar()).getByRole('button', { name: 'To-do' }))
    expect(serializeBody(editor)).toBe(BODY)
    select(editor, 2)
    fireEvent.click(within(bar()).getByRole('button', { name: 'Toggle' }))
    expect(serializeBody(editor)).toBe('One two\n\nThree\n\n<!-- toggle open -->\nFour five six\n<!-- /toggle -->\n')
  })

  test('the color dropdown sets and removes a block colour', async () => {
    const editor = mounted(BODY)
    render(<BlockSelectionBar editor={editor} />)
    select(editor, 1)
    const menu = await openMenu('Color')
    expect(within(menu).getByText('Text')).toBeInTheDocument()
    expect(within(menu).getByText('Background')).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Blue background' }))
    expect(serializeBody(editor)).toBe('One two\n\n<!-- block: color=bg-blue -->\nThree\n\nFour five six\n')
    fireEvent.click(within(await openMenu('Color')).getByRole('menuitem', { name: 'Remove background color' }))
    expect(serializeBody(editor)).toBe(BODY)
  })

  test('the color dropdown sets a text colour on the file (acceptance M7#5)', async () => {
    const editor = mounted(BODY)
    render(<BlockSelectionBar editor={editor} />)
    select(editor, 1)
    const menu = await openMenu('Color')
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Red text$/ }))
    expect(serializeBody(editor)).toBe('One two\n\n<!-- block: color=text-red -->\nThree\n\nFour five six\n')
  })

  test('the icon dropdown sets the block icon', async () => {
    const editor = mounted(BODY)
    render(<BlockSelectionBar editor={editor} />)
    select(editor, 0)
    const trigger = within(bar()).getByRole('button', { name: 'Icon' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    const picker = await screen.findByRole('tab', { name: 'Emoji' })
    fireEvent.click(picker)
    fireEvent.click((await screen.findAllByRole('button')).find((b) => b.textContent === '⭐')!)
    expect(serializeBody(editor)).toBe('<!-- block: icon="⭐" -->\nOne two\n\nThree\n\nFour five six\n')
  })

  test('delete removes the selected blocks; close ends the selection', () => {
    const editor = mounted(BODY)
    render(<BlockSelectionBar editor={editor} />)
    select(editor, 1)
    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete selected blocks' }))
    expect(serializeBody(editor)).toBe('One two\n\nFour five six\n')

    select(editor, 0)
    fireEvent.click(within(bar()).getByRole('button', { name: 'Clear selection' }))
    expect(blockSelectionRange(editor.state)).toBeNull()
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  test("move to today's and tomorrow's daily note appends the blocks there and removes them here", async () => {
    const editor = mounted(BODY)
    render(<BlockSelectionBar editor={editor} />)
    select(editor, 0, 1)
    const menu = await openMenu('Move')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Today', 'Tomorrow', 'New note'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Today' }))
    await waitFor(() => expect(serializeBody(editor)).toBe('Four five six\n'))
    const today = todayYmd()
    expect(api.createDailyNote).toHaveBeenCalledWith(today)
    expect(vi.mocked(api.saveBody).mock.calls[0][0]).toBe(`DailyNotes/${today}.md`)
    expect(vi.mocked(api.saveBody).mock.calls[0][1]).toContain('One two\n\nThree\n')

    select(editor, 0)
    fireEvent.click(within(await openMenu('Move')).getByRole('menuitem', { name: 'Tomorrow' }))
    await waitFor(() => expect(api.createDailyNote).toHaveBeenCalledWith(addDays(today, 1)))
  })

  test("moving to today's note from today's note itself moves the blocks to the end here, with no write", async () => {
    const today = todayYmd()
    const editor = mounted(BODY)
    setEditorObject(editor, { path: `DailyNotes/${today}.md` })
    vi.mocked(api.createDailyNote).mockRejectedValueOnce(new DailyNoteExistsError('exists', `DailyNotes/${today}.md`))
    render(<BlockSelectionBar editor={editor} />)
    select(editor, 0)
    fireEvent.click(within(await openMenu('Move')).getByRole('menuitem', { name: 'Today' }))
    await waitFor(() => expect(serializeBody(editor)).toBe('Three\n\nFour five six\n\nOne two\n'))
    await act(async () => {})
    expect(api.saveBody).not.toHaveBeenCalled()
  })

  test("the last blocks of today's note stay where they are", async () => {
    const today = todayYmd()
    const editor = mounted(BODY)
    setEditorObject(editor, { path: `DailyNotes/${today}.md` })
    vi.mocked(api.createDailyNote).mockClear()
    vi.mocked(api.createDailyNote).mockRejectedValueOnce(new DailyNoteExistsError('exists', `DailyNotes/${today}.md`))
    render(<BlockSelectionBar editor={editor} />)
    select(editor, 1, 2)
    fireEvent.click(within(await openMenu('Move')).getByRole('menuitem', { name: 'Today' }))
    await waitFor(() => expect(api.createDailyNote).toHaveBeenCalled())
    await act(async () => {})
    expect(serializeBody(editor)).toBe(BODY)
    expect(api.saveBody).not.toHaveBeenCalled()
  })

  test("moving to another note saves this note's pending edits first", async () => {
    const editor = mounted(BODY)
    const order: string[] = []
    const flush = vi.fn(async () => {
      order.push('flush')
    })
    setEditorObject(editor, { path: 'Pages/Source.md', flush })
    vi.mocked(api.saveBody).mockImplementationOnce(async (path: string) => {
      order.push(`save ${path}`)
      return { version: 'v2' } as never
    })
    render(<BlockSelectionBar editor={editor} />)
    select(editor, 0)
    fireEvent.click(within(await openMenu('Move')).getByRole('menuitem', { name: 'Today' }))
    await waitFor(() => expect(serializeBody(editor)).toBe('Three\n\nFour five six\n'))
    expect(order).toEqual(['flush', `save DailyNotes/${todayYmd()}.md`])
  })

  test('move to a new page creates the page with the blocks in one write', async () => {
    // M14: the text rides in the creating write, so a creation rule's write can't come between
    // the page and its text (a separate save would meet a 409 and leave the page empty).
    const editor = mounted(BODY)
    vi.mocked(api.createObject).mockResolvedValueOnce({ path: 'Pages/Untitled.md', version: 'v1' })
    render(<BlockSelectionBar editor={editor} />)
    select(editor, 0, 1)
    fireEvent.click(within(await openMenu('Move')).getByRole('menuitem', { name: 'New note' }))
    await waitFor(() => expect(serializeBody(editor)).toBe('Four five six\n'))
    expect(api.createObject).toHaveBeenCalledWith(expect.any(String), { templateId: 'none', body: 'One two\n\nThree\n' })
    expect(api.saveBody).not.toHaveBeenCalled()
  })

  test('a failed move keeps the blocks', async () => {
    const editor = mounted(BODY)
    render(<BlockSelectionBar editor={editor} />)
    vi.mocked(api.saveBody).mockRejectedValueOnce(new Error('disk full'))
    select(editor, 0)
    fireEvent.click(within(await openMenu('Move')).getByRole('menuitem', { name: 'Today' }))
    await waitFor(() => expect(api.saveBody).toHaveBeenCalled())
    await act(async () => {})
    expect(serializeBody(editor)).toBe(BODY)
  })

  test('m10: AI opens the chat about the selected blocks; accepting replaces them', () => {
    resetAiStore()
    const editor = mounted(BODY)
    setEditorObject(editor, { path: 'Pages/Note.md' })
    render(<BlockSelectionBar editor={editor} />)
    select(editor, 0, 1)
    fireEvent.click(within(bar()).getByRole('button', { name: 'AI' }))
    const seed = useAi.getState().pending!.seed
    expect(seed).toMatchObject({ mode: 'askBlock', block: 'One two\n\nThree', contextPaths: ['Pages/Note.md'] })
    act(() => seed.onReplace!('# Merged'))
    expect(serializeBody(editor)).toBe('# Merged\n\nFour five six\n')
    resetAiStore()
  })

  test('m10: no AI button while AI features are hidden', () => {
    useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } })
    try {
      const editor = mounted(BODY)
      render(<BlockSelectionBar editor={editor} />)
      select(editor, 0)
      expect(within(bar()).queryByRole('button', { name: 'AI' })).toBeNull()
    } finally {
      useSettings.setState({ settings: settingsDefaults })
    }
  })
})

// M32 item 4: the bar stays inside the window at 1440 px and narrower.
describe('the block toolbar stays inside the window (M32)', () => {
  test('test the centre is the text column\'s while the bar fits there', () => {
    expect(barCentre(700, 800, 1440)).toBe(700)
  })

  test('test the centre moves left when the bar would pass the right edge', () => {
    // A text column on the right (sidebar open, properties closed): centred there, 1000 px would end at 1500.
    expect(barCentre(1000, 1000, 1440)).toBe(1440 - BAR_EDGE_GAP - 500)
    expect(barCentre(700, 900, 1024)).toBe(1024 - BAR_EDGE_GAP - 450)
  })

  test('test the centre moves right when the bar would pass the left edge', () => {
    expect(barCentre(300, 900, 1440)).toBe(BAR_EDGE_GAP + 450)
  })

  test('test a bar as wide as the window allows sits in the middle', () => {
    expect(barCentre(900, 1024 - 2 * BAR_EDGE_GAP, 1024)).toBe(512)
    expect(barCentre(900, 2000, 1024)).toBe(512) // wider than the window: its own scroll takes over
  })

  test('test the bar is placed by its measured width at 1440 px and at 1024 px', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('block-selection-bar') ? 1000 : 0
    })
    const inner = window.innerWidth
    try {
      const editor = mounted(BODY)
      // The text column: from 760 to 1440 (its centre 1100).
      editor.view.dom.getBoundingClientRect = () => ({ left: 760, width: 680, top: 0, height: 400, right: 1440, bottom: 400, x: 760, y: 0, toJSON: () => ({}) })
      Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
      render(<BlockSelectionBar editor={editor} />)
      select(editor, 0)
      // 1100 would put its right end at 1600: it is moved to end 16 px inside the window.
      expect(bar().style.left).toBe(`${1440 - BAR_EDGE_GAP - 500}px`)
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })
      // 1000 px no longer fit between the gaps (the CSS caps the bar at 992): it sits in the middle.
      expect(bar().style.left).toBe('512px')
    } finally {
      width.mockRestore()
      Object.defineProperty(window, 'innerWidth', { value: inner, configurable: true })
    }
  })
})
