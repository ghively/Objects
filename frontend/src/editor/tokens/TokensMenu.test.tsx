import { Editor as TiptapEditor } from '@tiptap/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetAiStore, useAi } from '@/ai/store'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { setEditorObject } from '../nodes/blockRef'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { THEME_COLORS } from '@/theme/palette'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { keysFor } from '@/lib/shortcuts'
import { COLOR_MENU_TEXT } from './ColorMenu'
import { setLastUsedHighlightColor } from '../nodes/textStyle'
import { TOKENS_MENU_ITEMS, TOKENS_MENU_TEXT, TokensMenu } from './TokensMenu'

const mocked = vi.mocked(api)
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
const PERSON = typeDef({ id: 'person', name: 'Person', pluralName: 'People', basic: true })

const editors: TiptapEditor[] = []
beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE, PERSON] })
  mocked.objects.mockResolvedValue([objectSummary({ path: 'People/Ada Lovelace.md', type: 'person', title: 'Ada Lovelace' })])
  useLinkIndex.setState({
    types: [PAGE, PERSON],
    objects: [objectSummary({ path: 'People/Ada Lovelace.md', type: 'person', title: 'Ada Lovelace' })],
    loaded: true,
  })
})
afterEach(() => {
  cleanup()
  while (editors.length) editors.pop()!.destroy()
  document.body.innerHTML = ''
})

function mounted(body: string): TiptapEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new TiptapEditor({ element, extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}

/** Select `text` (its first occurrence) and focus the editor. */
function select(editor: TiptapEditor, text: string) {
  let from = -1
  editor.state.doc.descendants((node, pos) => {
    if (from < 0 && node.isText && node.text!.includes(text)) from = pos + node.text!.indexOf(text)
  })
  act(() => {
    editor.view.dom.focus()
    editor.commands.setTextSelection({ from, to: from + text.length })
  })
}

function setup(body: string, text: string) {
  const editor = mounted(body)
  render(<TokensMenu editor={editor} path="Pages/Note.md" />)
  select(editor, text)
  return editor
}

function bar() {
  return screen.getByRole('toolbar', { name: TOKENS_MENU_TEXT.toolbar })
}

describe('TokensMenu', () => {
  test('test tokens menu items and colour names', () => {
    setup('Hello brave world\n', 'brave')
    const names = within(bar())
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(TOKENS_MENU_ITEMS)
    // The catalogued order and strings (catalog section 6).
    expect(TOKENS_MENU_ITEMS).toEqual([
      'Bold',
      'Italic',
      'Strikethrough',
      'Underline',
      'Bullet list',
      'To-do',
      'Link',
      'Code',
      'Formula',
      'Highlight text',
      'Make a new object out of the selected text.',
      'Point the selected text at an object you already have.',
      'AI', // M10
    ])

    fireEvent.click(within(bar()).getByRole('button', { name: 'Highlight text' }))
    const menu = screen.getByRole('menu', { name: 'Highlight text' })
    const text = within(menu).getByRole('group', { name: 'Text color' })
    const bg = within(menu).getByRole('group', { name: 'Background color' })
    expect(within(text).getAllByRole('menuitem')[0]).toHaveTextContent('No color')
    expect(within(bg).getAllByRole('menuitem')[0]).toHaveTextContent('No color')
    const textNames = within(text)
      .getAllByRole('menuitem')
      .slice(1)
      .map((b) => b.getAttribute('aria-label'))
    const bgNames = within(bg)
      .getAllByRole('menuitem')
      .slice(1)
      .map((b) => b.getAttribute('aria-label'))
    expect(textNames).toHaveLength(18)
    expect(bgNames).toHaveLength(18)
    // "<C> text" / "<C> background", in palette order.
    expect(textNames[0]).toBe('Gray text')
    expect(textNames).toContain('Sky text')
    expect(bgNames[THEME_COLORS.indexOf('yellow')]).toBe('Yellow background')
    expect(bgNames[17]).toBe('Red background')
    expect(COLOR_MENU_TEXT).toEqual({
      title: 'Highlight text',
      text: 'Text color',
      background: 'Background color',
      without: 'No color',
    })
  })

  test('test text colour and background apply as marks', () => {
    const editor = setup('Hello brave world\n', 'brave')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Highlight text' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Red text' }))
    expect(serializeBody(editor)).toBe('Hello <span data-color="text-red">brave</span> world\n')

    select(editor, 'brave')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Highlight text' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Blue background' }))
    expect(serializeBody(editor)).toBe('Hello <span data-color="text-red"><mark data-color="bg-blue">brave</mark></span> world\n')
    const mark = editor.view.dom.querySelector('mark')!
    expect(mark.getAttribute('style')).toContain('var(--label-bg-blue)')
  })

  test('test no color removes the mark', () => {
    const editor = setup('Hello <span data-color="text-red">brave</span> <mark>world</mark>\n', 'brave')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Highlight text' }))
    const text = screen.getByRole('group', { name: 'Text color' })
    // The current colour is checked.
    expect(within(text).getByRole('menuitem', { name: 'Red text' })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(within(text).getByRole('menuitem', { name: 'No color' }))
    expect(serializeBody(editor)).toBe('Hello brave <mark>world</mark>\n')

    select(editor, 'world')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Highlight text' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Background color' })).getByRole('menuitem', { name: 'No color' }))
    expect(serializeBody(editor)).toBe('Hello brave world\n')
  })

  test('test create object from selection links it', async () => {
    const editor = setup('Met Grace Hopper today\n', 'Grace Hopper')
    fireEvent.click(within(bar()).getByRole('button', { name: TOKENS_MENU_TEXT.create }))
    expect(screen.getByRole('textbox', { name: 'Search Object Types' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Person/ }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('person', { title: 'Grace Hopper' }))
    expect(serializeBody(editor)).toBe('Met [[Grace Hopper]] today\n')
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: expect.stringContaining('Grace Hopper') }))
  })

  test('test link existing object keeps the words as label', () => {
    const editor = setup('Thanks to Ada for the notes\n', 'Ada')
    fireEvent.click(within(bar()).getByRole('button', { name: TOKENS_MENU_TEXT.reuse }))
    expect(screen.getByRole('textbox', { name: 'Search objects' })).toHaveValue('Ada')
    fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/ }))
    expect(serializeBody(editor)).toBe('Thanks to [[Ada Lovelace|Ada]] for the notes\n')
  })

  test('bullet list and to-do turn the block and back to text', () => {
    const editor = setup('Buy milk today\n', 'milk')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Bullet list' }))
    expect(serializeBody(editor)).toBe('- Buy milk today\n')
    select(editor, 'milk')
    expect(within(bar()).getByRole('button', { name: 'Bullet list' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Bullet list' }))
    expect(serializeBody(editor)).toBe('Buy milk today\n')

    select(editor, 'milk')
    fireEvent.click(within(bar()).getByRole('button', { name: 'To-do' }))
    expect(serializeBody(editor)).toBe('- [ ] Buy milk today\n')
    select(editor, 'milk')
    fireEvent.click(within(bar()).getByRole('button', { name: 'To-do' }))
    expect(serializeBody(editor)).toBe('Buy milk today\n')
  })

  test('marks toggle and formula wraps the selection', () => {
    const editor = setup('Sum a+b here\n', 'a+b')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Bold' }))
    expect(serializeBody(editor)).toBe('Sum **a+b** here\n')
    select(editor, 'a+b')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Bold' }))
    fireEvent.click(within(bar()).getByRole('button', { name: 'Formula' }))
    expect(editor.state.doc.firstChild!.child(1).type.name).toBe('inlineMath')
  })

  test('hidden without a selection and inside code', () => {
    const editor = mounted('Hello world\n\n```\ncode here\n```\n')
    render(<TokensMenu editor={editor} path="Pages/Note.md" />)
    act(() => {
      editor.view.dom.focus()
      editor.commands.setTextSelection(3)
    })
    expect(screen.queryByRole('toolbar')).toBeNull()
    select(editor, 'code here')
    expect(screen.queryByRole('toolbar')).toBeNull()
    select(editor, 'Hello')
    expect(screen.getByRole('toolbar')).toBeInTheDocument()
  })

  test('the highlight shortcut toggles the last-used colour, bg-amber at first', () => {
    setLastUsedHighlightColor(null)
    const editor = setup('Hello brave world\n', 'brave')
    const key = keysFor('highlightText')[0]
    const [mod, shift, letter] = key.split('-')
    expect([mod, shift]).toEqual(['Mod', 'Shift'])
    const press = () =>
      act(() => {
        editor.view.dom.dispatchEvent(
          new KeyboardEvent('keydown', { key: letter, ctrlKey: true, metaKey: false, shiftKey: true, bubbles: true }),
        )
      })
    press()
    expect(serializeBody(editor)).toBe('Hello <mark data-color="bg-amber">brave</mark> world\n')
    expect(screen.queryByRole('menu', { name: 'Highlight text' })).toBeNull()
    press()
    expect(serializeBody(editor)).toBe('Hello brave world\n')
    // A colour picked in the panel becomes the last-used one, text colours too.
    fireEvent.click(within(bar()).getByRole('button', { name: 'Highlight text' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Highlight text' })).getByRole('menuitem', { name: 'Red text' }))
    expect(serializeBody(editor)).toBe('Hello <span data-color="text-red">brave</span> world\n')
    press()
    expect(serializeBody(editor)).toBe('Hello brave world\n')
    press()
    expect(serializeBody(editor)).toBe('Hello <span data-color="text-red">brave</span> world\n')
    setLastUsedHighlightColor(null)
  })

  test('m10: the AI sparkle opens the chat about the selection; accepting replaces it', () => {
    resetAiStore()
    const editor = setup('Hello brave world\n', 'brave')
    setEditorObject(editor, { path: 'Pages/Note.md' })
    fireEvent.click(within(bar()).getByRole('button', { name: 'AI' }))
    const seed = useAi.getState().pending!.seed
    expect(seed).toMatchObject({ mode: 'chat', block: 'brave', contextPaths: ['Pages/Note.md'] })
    // The panel takes the focus; the editor moves on before the answer is accepted.
    act(() => {
      editor.commands.setTextSelection(1)
    })
    act(() => seed.onReplace!('bold'))
    expect(serializeBody(editor)).toBe('Hello bold world\n')
    act(() => seed.onInsertBelow!('More'))
    expect(serializeBody(editor)).toBe('Hello bold world\n\nMore\n')
    resetAiStore()
  })

  test('m10: no AI sparkle while AI features are hidden', () => {
    useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } })
    try {
      setup('Hello brave world\n', 'brave')
      expect(within(bar()).queryByRole('button', { name: 'AI' })).toBeNull()
    } finally {
      useSettings.setState({ settings: settingsDefaults })
    }
  })
})
