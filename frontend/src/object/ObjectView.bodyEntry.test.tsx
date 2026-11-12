// M33, choice 1: the keyboard reaches the text of an open note. With a note open as the page (or
// as the peek) and nothing focused, Enter puts the caret at the end of the text and ArrowDown at
// its start; a note whose text is empty opens with the caret in the text. Nothing else takes the
// focus by itself, and placing the caret never saves anything.
import type { Editor as TiptapEditor } from '@tiptap/core'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ObjectDetail, SpaceInfo, TypeDef } from '@/api/types'
import { objectDetail, objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api } from '@/api/client'
import { markFresh, resetFresh } from '@/create/freshObjects'
import { serializeBody } from '@/editor/document'
import { setUnsavedSpace } from '@/editor/unsaved'
import { resetLinkIndex } from '@/links/linkIndex'
import { requestBodyFocus, takeBodyFocus } from '@/nav/focusRequest'
import { usePeek, useTabs } from '@/nav/tabs'
import { CommandPalette } from '@/palette/CommandPalette'
import { usePalette } from '@/palette/usePalette'
import { ObjectPeek } from './ObjectPeek'
import { ObjectView } from './ObjectView'

const mocked = vi.mocked(api)
const PAGE: TypeDef = typeDef({
  id: 'page',
  name: 'Page',
  pluralName: 'Pages',
  revision: 'r1',
  basic: true,
  // One property of its own, so the properties pane is open and has a field to stand in.
  propertyDefinitions: [propertyDef({ id: 'p-owner', key: 'owner', name: 'Owner', type: 'text' })],
})
const PATH = 'Pages/Notes.md'
const EMPTY = 'Pages/Blank.md'
const OTHER = 'Pages/Other.md'
const BODY = 'First line.\n\nSecond line.\n'

let files: Record<string, ObjectDetail>

function file(path: string, title: string, body: string, extra: Partial<ObjectDetail['summary']> = {}): ObjectDetail {
  return objectDetail({
    summary: objectSummary({ id: `id-${title}`, path, type: 'page', title, ...extra }),
    frontmatter: { type: 'Page', title },
    body,
    version: 'v1',
  })
}

beforeEach(() => {
  // jsdom lacks scrollIntoView, which the palette's list calls on its selected item.
  Element.prototype.scrollIntoView ??= function () {}
  localStorage.clear()
  setUnsavedSpace('/s')
  useTabs.getState().reset()
  usePeek.getState().close()
  usePalette.setState({ open: false })
  resetLinkIndex()
  resetFresh()
  for (const p of [PATH, EMPTY, OTHER]) takeBodyFocus(p)
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  files = {
    [PATH]: file(PATH, 'Notes', BODY),
    [EMPTY]: file(EMPTY, 'Blank', ''),
    [OTHER]: file(OTHER, 'Other', 'Other text.\n'),
  }
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.objects.mockImplementation(async () => Object.values(files).map((d) => d.summary))
  mocked.object.mockImplementation(async (p: string) => {
    if (!files[p]) throw new Error('Not found')
    return files[p]
  })
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.search.mockResolvedValue({ results: [], total: 0 } as never)
})

function pm(container: ParentNode): TiptapEditor {
  const dom = container.querySelector('.object-body-text .ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null
  if (!dom?.editor) throw new Error('editor not mounted')
  return dom.editor
}

/** The note open as the page (`ObjectView`) or in the peek (`ObjectPeek`, in its dialog frame). */
async function open(mode: 'page' | 'peek', path = PATH, list?: string[]) {
  let container: HTMLElement
  if (mode === 'peek') {
    usePeek.getState().show(path, list)
    render(<ObjectPeek />)
    container = await screen.findByRole('dialog')
  } else {
    container = render(<ObjectView path={path} mode="page" />).container
  }
  const editor = await waitFor(() => pm(container))
  await waitFor(() => expect(serializeBody(editor)).toBe(files[path].body))
  // Whatever the view does at load (a caret request, an empty note) has happened by now.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30))
  })
  return { container, editor }
}

const bodyHasFocus = (editor: TiptapEditor) => document.activeElement === editor.view.dom
const END = (editor: TiptapEditor) => editor.state.doc.content.size - 1

/** A key pressed with nothing focused: it goes to whatever holds the focus (the page, the peek's frame). */
function press(init: KeyboardEventInit): boolean {
  const target = document.activeElement ?? document.body
  return fireEvent.keyDown(target, init)
}

/** No request that writes anything was made. */
function expectNothingWritten() {
  expect(mocked.saveBody).not.toHaveBeenCalled()
  expect(mocked.updateProperties).not.toHaveBeenCalled()
  expect(mocked.renameObject).not.toHaveBeenCalled()
}

describe.each(['page', 'peek'] as const)('the keyboard reaches the text, in the %s', (mode) => {
  test('a note with text opens with nothing focused, and nothing is saved', async () => {
    const { container, editor } = await open(mode)
    expect(bodyHasFocus(editor)).toBe(false)
    expect(container.querySelector('input:focus, textarea:focus, [contenteditable]:focus')).toBeNull()
    expectNothingWritten()
  })

  test('Enter puts the caret at the end of the text, and nothing is saved', async () => {
    const { editor } = await open(mode)
    expect(press({ key: 'Enter' })).toBe(false)
    expect(bodyHasFocus(editor)).toBe(true)
    expect(editor.state.selection.empty).toBe(true)
    expect(editor.state.selection.from).toBe(END(editor))
    expect(serializeBody(editor)).toBe(BODY)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expectNothingWritten()
  })

  test('ArrowDown puts the caret at the start of the text, and nothing is saved', async () => {
    const { editor } = await open(mode)
    expect(press({ key: 'ArrowDown' })).toBe(false)
    expect(bodyHasFocus(editor)).toBe(true)
    expect(editor.state.selection.empty).toBe(true)
    expect(editor.state.selection.from).toBe(1)
    expect(serializeBody(editor)).toBe(BODY)
    expectNothingWritten()
  })

  test.each([' ', 'PageDown', 'PageUp', 'a', 'Tab', 'ArrowUp', 'Escape'])('%j does not move the caret into the text', async (key) => {
    const { editor } = await open(mode)
    press({ key })
    // The peek closes on Escape: the editor is gone, and never took the focus.
    expect(bodyHasFocus(editor)).toBe(false)
  })

  test.each([
    ['Shift+Enter', { key: 'Enter', shiftKey: true }],
    ['Ctrl+Enter', { key: 'Enter', ctrlKey: true }],
    ['Alt+Enter', { key: 'Enter', altKey: true }],
    ['Meta+Enter', { key: 'Enter', metaKey: true }],
    ['Shift+ArrowDown', { key: 'ArrowDown', shiftKey: true }],
    ['Ctrl+ArrowDown', { key: 'ArrowDown', ctrlKey: true }],
    ['Alt+ArrowDown', { key: 'ArrowDown', altKey: true }],
  ])('%s (a modifier held) does nothing', async (_name, init) => {
    const { editor } = await open(mode)
    expect(press(init)).toBe(true)
    expect(bodyHasFocus(editor)).toBe(false)
  })

  test('a key that is already repeating (held since before the note opened) does nothing', async () => {
    const { editor } = await open(mode)
    expect(press({ key: 'Enter', repeat: true })).toBe(true)
    expect(bodyHasFocus(editor)).toBe(false)
  })

  test('Enter held down does not go on to type: its repeats are swallowed until the key is released', async () => {
    const { editor } = await open(mode)
    press({ key: 'Enter' })
    expect(bodyHasFocus(editor)).toBe(true)
    const before = editor.state.doc.toJSON()
    // The repeats now go to the editor, which would break the line.
    expect(fireEvent.keyDown(editor.view.dom, { key: 'Enter', repeat: true })).toBe(false)
    expect(editor.state.doc.toJSON()).toEqual(before)
    fireEvent.keyUp(editor.view.dom, { key: 'Enter' })
    // Released: the next Enter is the person's own, and the editor's.
    const own = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    const seen = vi.fn()
    editor.view.dom.addEventListener('keydown', seen)
    editor.view.dom.dispatchEvent(own)
    expect(seen).toHaveBeenCalledTimes(1)
    expectNothingWritten()
  })

  test('with the focus in a property field the keys are the field\'s', async () => {
    const { container, editor } = await open(mode)
    const panel = within(container).getByRole('complementary', { name: 'Properties' })
    const field = within(panel).getAllByRole('textbox')[0]
    act(() => field.focus())
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(bodyHasFocus(editor)).toBe(false)
  })

  test('with the focus on a button Enter is the button\'s', async () => {
    const { container, editor } = await open(mode)
    const button = within(container).getAllByRole('button')[0]
    act(() => button.focus())
    expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true)
    expect(bodyHasFocus(editor)).toBe(false)
  })

  test('with the caret already in the text the keys are the editor\'s', async () => {
    const { editor } = await open(mode)
    act(() => {
      editor.commands.focus(3)
      editor.view.focus()
    })
    fireEvent.keyDown(editor.view.dom, { key: 'ArrowDown' })
    expect(editor.state.selection.from).toBe(3)
  })

  test('with a dialog open over the note nothing happens', async () => {
    const { editor } = await open(mode)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    try {
      expect(fireEvent.keyDown(document.body, { key: 'Enter' })).toBe(true)
      expect(fireEvent.keyDown(document.body, { key: 'ArrowDown' })).toBe(true)
      expect(bodyHasFocus(editor)).toBe(false)
    } finally {
      dialog.remove()
    }
  })

  test.each(['menu', 'listbox', 'alertdialog'])('with a %s open over the note nothing happens', async (role) => {
    const { editor } = await open(mode)
    const layer = document.createElement('div')
    layer.setAttribute('role', role)
    document.body.appendChild(layer)
    try {
      expect(fireEvent.keyDown(document.body, { key: 'Enter' })).toBe(true)
      expect(bodyHasFocus(editor)).toBe(false)
    } finally {
      layer.remove()
    }
  })

  test('with the palette open nothing happens', async () => {
    const { container, editor } = await open(mode)
    render(<CommandPalette onOpenTarget={vi.fn()} onToggleSidebar={vi.fn()} onToggleRightPanel={vi.fn()} onShowRightPanel={vi.fn()} />)
    act(() => usePalette.getState().show('search'))
    await waitFor(() => expect(document.querySelector('[data-command-palette]')).not.toBeNull())
    const palette = document.querySelector('[data-command-palette]') as HTMLElement
    // The palette's own field has the focus; a key in it is the palette's (ArrowDown walks its list).
    expect(palette.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(bodyHasFocus(editor)).toBe(false)
    // And a key that lands on the page behind it (or on the peek's frame) leaves the note as it was.
    for (const target of [document.body, container]) {
      fireEvent.keyDown(target, { key: 'Enter' })
      fireEvent.keyDown(target, { key: 'ArrowDown' })
    }
    expect(document.querySelector('[data-command-palette]')).not.toBeNull()
    expect(bodyHasFocus(editor)).toBe(false)
    expectNothingWritten()
  })

  test('a note whose text is empty opens with the caret in the text, and nothing is saved', async () => {
    const { editor } = await open(mode, EMPTY)
    expect(bodyHasFocus(editor)).toBe(true)
    expect(editor.state.selection.from).toBe(1)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expectNothingWritten()
  })

  test.each(['Enter', ' ', 'x'])('the key that opened an empty note, still down (%j), types nothing into it', async (key) => {
    const { editor } = await open(mode, EMPTY)
    expect(bodyHasFocus(editor)).toBe(true)
    const before = editor.state.doc.toJSON()
    const seen = vi.fn()
    editor.view.dom.addEventListener('keydown', seen)
    // Its repeats now land in the text the caret was put in.
    expect(fireEvent.keyDown(editor.view.dom, { key, repeat: true })).toBe(false)
    expect(fireEvent.keyDown(editor.view.dom, { key, repeat: true })).toBe(false)
    expect(seen).not.toHaveBeenCalled()
    expect(editor.state.doc.toJSON()).toEqual(before)
    fireEvent.keyUp(editor.view.dom, { key })
    // Let go: the next key is the person's own, and the editor's.
    fireEvent.keyDown(editor.view.dom, { key: 'x' })
    expect(seen).toHaveBeenCalledTimes(1)
    expectNothingWritten()
  })

  test('with no key held, the first key pressed in an empty note is the editor\'s', async () => {
    const { editor } = await open(mode, EMPTY)
    const seen = vi.fn()
    editor.view.dom.addEventListener('keydown', seen)
    fireEvent.keyDown(editor.view.dom, { key: 'H' })
    fireEvent.keyDown(editor.view.dom, { key: 'i' })
    expect(seen).toHaveBeenCalledTimes(2)
  })

  test('text that is only white space counts as empty', async () => {
    files[EMPTY] = file(EMPTY, 'Blank', '\n   \n\n')
    const { editor } = await open(mode, EMPTY)
    expect(bodyHasFocus(editor)).toBe(true)
    expectNothingWritten()
  })

  test('a brand-new note keeps its selected title', async () => {
    markFresh(EMPTY)
    // The text never has the focus on the way, not even for a moment before the title takes it.
    const inText = vi.fn()
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Element && e.target.closest('.object-body-text')) inText()
    }
    document.addEventListener('focusin', onFocusIn)
    const { container, editor } = await open(mode, EMPTY).finally(() => document.removeEventListener('focusin', onFocusIn))
    const title = within(container).getByRole('textbox', { name: 'Title' }) as HTMLInputElement
    await waitFor(() => expect(title).toHaveFocus())
    expect(inText).not.toHaveBeenCalled()
    expect(bodyHasFocus(editor)).toBe(false)
    expect(title.selectionStart).toBe(0)
    expect(title.selectionEnd).toBe('Blank'.length)
  })

  test('a focus request that came with the open wins over the empty-note rule', async () => {
    files[EMPTY] = file(EMPTY, 'Blank', '\n')
    requestBodyFocus(EMPTY, 'end')
    const { editor } = await open(mode, EMPTY)
    expect(bodyHasFocus(editor)).toBe(true)
    expect(takeBodyFocus(EMPTY)).toBeNull()
  })

  test('an empty note that can\'t be edited takes no caret', async () => {
    files[EMPTY] = file(EMPTY, 'Blank', '', { readOnly: true, readOnlyReason: 'locked' })
    const { editor } = await open(mode, EMPTY)
    expect(bodyHasFocus(editor)).toBe(false)
    expect(press({ key: 'Enter' })).toBe(true)
    expect(bodyHasFocus(editor)).toBe(false)
  })
})

describe('the keyboard reaches the text: which view', () => {
  test('a note in the side panel is not the active view: no caret by itself, and no keys', async () => {
    const { container } = render(
      <div data-sidepanel-entry="e1">
        <ObjectView path={EMPTY} mode="page" />
      </div>,
    )
    const editor = await waitFor(() => pm(container))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(bodyHasFocus(editor)).toBe(false)
    expect(press({ key: 'Enter' })).toBe(true)
    expect(press({ key: 'ArrowDown' })).toBe(true)
    expect(bodyHasFocus(editor)).toBe(false)
  })

  test('the peek wins while it is open: the page behind it takes neither the keys nor an empty note\'s caret', async () => {
    usePeek.getState().show(PATH)
    const page = render(<ObjectView path={EMPTY} mode="page" />)
    const behind = await waitFor(() => pm(page.container))
    render(<ObjectPeek />)
    const dialog = await screen.findByRole('dialog')
    const front = await waitFor(() => pm(dialog))
    await waitFor(() => expect(serializeBody(front)).toBe(BODY))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(bodyHasFocus(behind)).toBe(false)
    press({ key: 'Enter' })
    expect(bodyHasFocus(front)).toBe(true)
    expect(bodyHasFocus(behind)).toBe(false)
  })

  test('an empty note does not take the focus from a field somewhere else', async () => {
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()
    try {
      const { container } = render(<ObjectView path={EMPTY} mode="page" />)
      const editor = await waitFor(() => pm(container))
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30))
      })
      expect(field).toHaveFocus()
      expect(bodyHasFocus(editor)).toBe(false)
    } finally {
      field.remove()
    }
  })

  test('nor from a button somewhere else (a list the person is keyboarding through)', async () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()
    try {
      const { container } = render(<ObjectView path={EMPTY} mode="page" />)
      const editor = await waitFor(() => pm(container))
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30))
      })
      expect(button).toHaveFocus()
      expect(bodyHasFocus(editor)).toBe(false)
    } finally {
      button.remove()
    }
  })

  test('a layer on its way out (the palette that opened the note) no longer holds the focus back', async () => {
    // The palette stays in the page for its closing animation, its field still focused.
    const closing = document.createElement('div')
    closing.setAttribute('role', 'dialog')
    closing.setAttribute('data-state', 'closed')
    const field = document.createElement('input')
    closing.appendChild(field)
    // Its list of results is part of it: a layer inside a closing one is on its way out too.
    const results = document.createElement('div')
    results.setAttribute('role', 'listbox')
    closing.appendChild(results)
    document.body.appendChild(closing)
    field.focus()
    try {
      const { container } = render(<ObjectView path={EMPTY} mode="page" />)
      const editor = await waitFor(() => pm(container))
      await waitFor(() => expect(bodyHasFocus(editor)).toBe(true))
    } finally {
      closing.remove()
    }
  })
})

describe('a key pressed while the palette that opened the note is still closing', () => {
  /** The palette as it is for its closing animation: still in the page, its field still focused. */
  function closingPalette(state: 'closed' | 'open') {
    const layer = document.createElement('div')
    layer.setAttribute('role', 'dialog')
    layer.setAttribute('data-state', state)
    const field = document.createElement('input')
    layer.appendChild(field)
    document.body.appendChild(layer)
    return { layer, field }
  }

  test.each([
    ['Enter', 'end'],
    ['ArrowDown', 'start'],
  ] as const)('%s goes to the note (the %s of its text), and the palette does not read it', async (key, where) => {
    const { editor } = await open('page')
    const { layer, field } = closingPalette('closed')
    const seen = vi.fn()
    field.addEventListener('keydown', seen)
    field.focus()
    try {
      expect(fireEvent.keyDown(field, { key })).toBe(false)
      expect(seen).not.toHaveBeenCalled()
      expect(bodyHasFocus(editor)).toBe(true)
      expect(editor.state.selection.from).toBe(where === 'end' ? END(editor) : 1)
      expectNothingWritten()
    } finally {
      layer.remove()
    }
  })

  test('while the palette is open its field keeps its keys', async () => {
    const { editor } = await open('page')
    const { layer, field } = closingPalette('open')
    const seen = vi.fn()
    field.addEventListener('keydown', seen)
    field.focus()
    try {
      expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(true)
      expect(seen).toHaveBeenCalledTimes(1)
      expect(bodyHasFocus(editor)).toBe(false)
    } finally {
      layer.remove()
    }
  })

  test('a held key (the Enter that opened the note, still down) is not taken', async () => {
    const { editor } = await open('page')
    const { layer, field } = closingPalette('closed')
    field.focus()
    try {
      fireEvent.keyDown(field, { key: 'Enter', repeat: true })
      expect(bodyHasFocus(editor)).toBe(false)
    } finally {
      layer.remove()
    }
  })
})

describe('the peek\'s pager', () => {
  const LIST = [PATH, EMPTY, OTHER]

  test('stepping keeps the focus on the pager button: an empty note does not take the caret', async () => {
    const user = userEvent.setup()
    const { container } = await open('peek', PATH, LIST)
    const next = within(container).getByRole('button', { name: 'Next' })
    act(() => next.focus())
    await user.keyboard('{Enter}')
    await within(container).findByRole('heading', { level: 1, name: 'Blank' })
    const editor = await waitFor(() => pm(container))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(within(container).getByRole('button', { name: 'Next' })).toHaveFocus()
    expect(bodyHasFocus(editor)).toBe(false)
    // And the same key steps on, instead of typing into the note it just showed.
    await user.keyboard('{Enter}')
    await within(container).findByRole('heading', { level: 1, name: 'Other' })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    // The last note: "Next" is disabled, so "Previous" holds the focus (the way back).
    expect(within(container).getByRole('button', { name: 'Previous' })).toHaveFocus()
    expectNothingWritten()
  })

  test('once the person leaves the pager it does not take the focus back', async () => {
    const user = userEvent.setup()
    const { container } = await open('peek', PATH, LIST)
    await user.click(within(container).getByRole('button', { name: 'Next' }))
    await within(container).findByRole('heading', { level: 1, name: 'Blank' })
    const title = within(container).getByRole('textbox', { name: 'Title' })
    await user.click(title)
    expect(title).toHaveFocus()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(title).toHaveFocus()
  })
})

describe('raw Markdown', () => {
  test.each([
    ['Enter', 'end'],
    ['ArrowDown', 'start'],
  ] as const)('%s puts the caret at the %s of the raw text', async (key, where) => {
    const user = userEvent.setup()
    const { container } = await open('page')
    await user.click(within(container).getByRole('button', { name: 'More' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Raw Markdown' }))
    const raw = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('.object-body-text .cm-content')
      if (!el) throw new Error('raw mode not mounted')
      return el
    })
    await waitFor(() => expect(raw.textContent).toContain('Second line.'))
    const { EditorView } = await import('@codemirror/view')
    // The caret sits somewhere in the middle, so both ends are a move.
    act(() => EditorView.findFromDOM(raw)!.dispatch({ selection: { anchor: 5 } }))
    act(() => (document.activeElement as HTMLElement | null)?.blur())
    expect(document.activeElement).toBe(document.body)
    expect(press({ key })).toBe(false)
    expect(raw).toHaveFocus()
    await waitFor(() => {
      const view = EditorView.findFromDOM(raw)!
      expect(view.state.selection.main.empty).toBe(true)
      expect(view.state.selection.main.head).toBe(where === 'end' ? view.state.doc.length : 0)
    })
    expectNothingWritten()
  })
})
