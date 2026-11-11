// M32, item 2 and the body-focus requests: Enter, ArrowDown or Tab in a note's title puts the caret
// at the start of the body; Shift+Tab or ArrowUp at the body's very first position goes back to the
// end of the title; a request left for the note (`requestBodyFocus`) is taken when its editor is
// ready; and a rename that moves the file hands over what was typed meanwhile, and the caret.
import type { Editor as TiptapEditor } from '@tiptap/core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ObjectDetail, RenameResult, SpaceInfo, TypeDef } from '@/api/types'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api } from '@/api/client'
import { serializeBody } from '@/editor/document'
import { keptUnsaved, setUnsavedSpace } from '@/editor/unsaved'
import { resetLinkIndex } from '@/links/linkIndex'
import { requestBodyFocus, takeBodyFocus } from '@/nav/focusRequest'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { ObjectPage } from './ObjectPage'
import { ObjectView } from './ObjectView'

const mocked = vi.mocked(api)
const PAGE: TypeDef = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1', basic: true })
const PATH = 'Pages/Notes.md'
const BODY = 'First line.\n\nSecond line.\n'

let files: Record<string, ObjectDetail>

function file(path: string, title: string, body: string, version: string): ObjectDetail {
  return objectDetail({
    summary: objectSummary({ id: 'id-1', path, type: 'page', title }),
    frontmatter: { type: 'Page', title },
    body,
    version,
  })
}

beforeEach(() => {
  localStorage.clear()
  setUnsavedSpace('/s')
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  takeBodyFocus(PATH)
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  files = { [PATH]: file(PATH, 'Notes', BODY, 'v1') }
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.objects.mockImplementation(async () => Object.values(files).map((d) => d.summary))
  mocked.object.mockImplementation(async (p: string) => {
    if (!files[p]) throw new Error('Not found')
    return files[p]
  })
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => undefined)
})

function pm(container: HTMLElement): TiptapEditor {
  const dom = container.querySelector('.object-body-text .ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null
  if (!dom?.editor) throw new Error('editor not mounted')
  return dom.editor
}

async function open(mode: 'page' | 'peek' = 'page', path = PATH) {
  const utils = render(<ObjectView path={path} mode={mode} />)
  const editor = await waitFor(() => pm(utils.container))
  await waitFor(() => expect(serializeBody(editor)).toBe(files[path].body))
  return { ...utils, editor, title: screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement }
}

const bodyHasFocus = (editor: TiptapEditor) => document.activeElement === editor.view.dom

describe.each(['page', 'peek'] as const)('title to body, in the %s', (mode) => {
  test.each(['Enter', 'ArrowDown', 'Tab'])('%s in the title puts the caret at the start of the body', async (key) => {
    const { editor, title } = await open(mode)
    act(() => title.focus())
    const notPrevented = fireEvent.keyDown(title, { key })
    expect(notPrevented).toBe(false)
    expect(bodyHasFocus(editor)).toBe(true)
    expect(editor.state.selection.empty).toBe(true)
    expect(editor.state.selection.from).toBe(1)
    // The title was not changed: nothing is renamed.
    expect(mocked.renameObject).not.toHaveBeenCalled()
  })

  test('Shift+Tab in the title is left to the browser', async () => {
    const { editor, title } = await open(mode)
    act(() => title.focus())
    expect(fireEvent.keyDown(title, { key: 'Tab', shiftKey: true })).toBe(true)
    expect(bodyHasFocus(editor)).toBe(false)
  })

  test.each([
    ['ArrowUp', { key: 'ArrowUp' }],
    ['Shift+Tab', { key: 'Tab', shiftKey: true }],
  ])('%s at the very first position of the body goes to the end of the title', async (_name, init) => {
    const { editor, title } = await open(mode)
    act(() => {
      editor.commands.focus('start')
      editor.view.focus()
    })
    expect(fireEvent.keyDown(editor.view.dom, init)).toBe(false)
    expect(title).toHaveFocus()
    expect(title.selectionStart).toBe('Notes'.length)
    expect(title.selectionEnd).toBe('Notes'.length)
  })

  test('anywhere else in the body the keys stay with the editor', async () => {
    const { editor, title } = await open(mode)
    act(() => {
      editor.commands.focus(3)
      editor.view.focus()
    })
    fireEvent.keyDown(editor.view.dom, { key: 'ArrowUp' })
    fireEvent.keyDown(editor.view.dom, { key: 'Tab', shiftKey: true })
    expect(title).not.toHaveFocus()
    // A selection that starts at the first position is not the caret there.
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 4 })
    })
    fireEvent.keyDown(editor.view.dom, { key: 'ArrowUp' })
    expect(title).not.toHaveFocus()
  })
})

describe('title to body', () => {
  // The editor's state follows the DOM selection a moment later (on `selectionchange`), and the key
  // is read before the editor sees it: ArrowLeft, ArrowLeft, ArrowUp in quick succession (found
  // in a real browser).
  test('the caret is read where it is now, not where the editor last saw it', async () => {
    const { editor, title } = await open()
    act(() => {
      editor.commands.focus(4)
      editor.view.focus()
    })
    // The caret moves in the DOM; the editor has not heard yet.
    const text = editor.view.dom.querySelector('p')!.firstChild!
    document.getSelection()!.collapse(text, 0)
    expect(editor.state.selection.from).toBe(4)
    fireEvent.keyDown(editor.view.dom, { key: 'ArrowUp' })
    expect(title).toHaveFocus()
  })

  test('and a caret the DOM has moved away from the start is not at the start', async () => {
    const { editor, title } = await open()
    act(() => {
      editor.commands.focus('start')
      editor.view.focus()
    })
    const text = editor.view.dom.querySelector('p')!.firstChild!
    document.getSelection()!.collapse(text, 3)
    expect(editor.state.selection.from).toBe(1)
    fireEvent.keyDown(editor.view.dom, { key: 'ArrowUp' })
    expect(title).not.toHaveFocus()
  })

  test('Shift+Tab at the start of a list item is the editor\'s (it unindents); ArrowUp still goes to the title', async () => {
    files[PATH] = file(PATH, 'Notes', '- one\n- two\n', 'v1')
    const { editor, title } = await open()
    act(() => {
      editor.commands.focus('start')
      editor.view.focus()
    })
    fireEvent.keyDown(editor.view.dom, { key: 'Tab', shiftKey: true })
    expect(title).not.toHaveFocus()
    act(() => {
      editor.commands.focus('start')
      editor.view.focus()
    })
    fireEvent.keyDown(editor.view.dom, { key: 'ArrowUp' })
    expect(title).toHaveFocus()
  })

  test('typing a title and pressing Enter renames the note and keeps the caret in the body', async () => {
    const user = userEvent.setup()
    mocked.renameObject.mockImplementation(async () => ({ path: PATH, version: 'v2', relinked: [], skipped: [] }))
    const { editor, title } = await open()
    await user.clear(title)
    await user.type(title, 'Plans{Enter}')
    expect(bodyHasFocus(editor)).toBe(true)
    await waitFor(() => expect(mocked.renameObject).toHaveBeenCalledWith(PATH, 'Plans', 'v1'))
    expect(bodyHasFocus(editor)).toBe(true)
  })
})

describe('body focus requests', () => {
  test.each(['page', 'peek'] as const)('a request for the end is taken once, when the %s editor is ready', async (mode) => {
    requestBodyFocus(PATH, 'end')
    const { editor } = await open(mode)
    await waitFor(() => expect(bodyHasFocus(editor)).toBe(true))
    expect(editor.state.selection.empty).toBe(true)
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1)
    expect(takeBodyFocus(PATH)).toBeNull()
  })

  test('a request for the start puts the caret before the first character', async () => {
    requestBodyFocus(PATH, 'start')
    const { editor } = await open()
    await waitFor(() => expect(bodyHasFocus(editor)).toBe(true))
    expect(editor.state.selection.from).toBe(1)
  })

  test('with no request the body does not take the focus', async () => {
    const { editor } = await open()
    expect(bodyHasFocus(editor)).toBe(false)
  })
})

describe('a rename that moves the file', () => {
  const NEW = 'Pages/Plans.md'

  /** Open the note as the active tab's page, retitle it and press Enter; the rename is held open. */
  async function renameAndStayInBody(body: string) {
    const user = userEvent.setup()
    files[PATH] = file(PATH, 'Notes', body, 'v1')
    let finishRename!: (r: RenameResult) => void
    mocked.renameObject.mockImplementation(
      () =>
        new Promise<RenameResult>((resolve) => {
          finishRename = resolve
        }),
    )
    useTabs.getState().open({ kind: 'object', path: PATH })
    const utils = render(<ObjectPageOfTab />)
    const editor = await waitFor(() => pm(utils.container))
    await waitFor(() => expect(serializeBody(editor)).toBe(body))
    const title = screen.getByRole('textbox', { name: 'Title' })
    await user.clear(title)
    await user.type(title, 'Plans{Enter}')
    await waitFor(() => expect(mocked.renameObject).toHaveBeenCalledWith(PATH, 'Plans', 'v1'))
    // The rename is still on its way; the caret is already in the body.
    expect(bodyHasFocus(editor)).toBe(true)
    const finish = async (onDisk = body) => {
      // The file has moved: only the new path can be read or written.
      files[NEW] = file(NEW, 'Plans', onDisk, 'v2')
      delete files[PATH]
      mocked.object.mockClear()
      await act(async () => {
        finishRename({ path: NEW, version: 'v2', relinked: [], skipped: [] })
      })
    }
    return { ...utils, editor, finish }
  }

  test('what was typed in the body meanwhile is shown at once, saved under the new path, and the caret stays', async () => {
    mocked.saveBody.mockImplementation(async (p: string, body: string) => {
      files[p] = file(p, 'Plans', body, 'v3')
      return { version: 'v3' }
    })
    const { container, editor, finish } = await renameAndStayInBody('')
    act(() => {
      editor.commands.insertContent('Hello')
    })
    const typed = serializeBody(editor)
    expect(mocked.saveBody).not.toHaveBeenCalled()

    await finish()
    // No moment without an editor: the view that took over is there with the words and the
    // caret after them (nothing was loaded again), so the next key lands in the right place.
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: NEW })
    const next = pm(container)
    expect(next).not.toBe(editor)
    expect(serializeBody(next)).toBe(typed)
    expect(bodyHasFocus(next)).toBe(true)
    expect(next.state.selection.from).toBe(1 + 'Hello'.length)
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Plans')
    // Saved once, under the new path on the rename's version; never under the old path.
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledWith(NEW, typed, 'v2'))
    expect(mocked.saveBody).toHaveBeenCalledTimes(1)
    // What is typed next is saved on the version that save answered.
    act(() => {
      next.commands.insertContent(' there')
    })
    const more = serializeBody(next)
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledWith(NEW, more, 'v3'), { timeout: 4000 })
    expect(mocked.saveBody.mock.calls.every(([p]) => p === NEW)).toBe(true)
    expect(keptUnsaved(PATH)).toBeNull()
    expect(keptUnsaved(NEW)).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  }, 15000)

  test('a body nobody typed in moves at once, with the caret, and nothing is saved', async () => {
    const { container, editor, finish } = await renameAndStayInBody(BODY)
    act(() => {
      editor.commands.setTextSelection(4)
    })
    await finish()
    const next = pm(container)
    expect(next).not.toBe(editor)
    expect(serializeBody(next)).toBe(BODY)
    expect(bodyHasFocus(next)).toBe(true)
    expect(next.state.selection.from).toBe(4)
    expect(mocked.saveBody).not.toHaveBeenCalled()
  }, 15000)

  // The M32 review, F1: the server's rename rewrites a first `# Old title` heading in the same
  // write. The view that takes over is handed the text from before the rename with the version
  // from after it, so it must show the heading as the file now has it: otherwise the next save
  // writes the old heading back over the new one, with no conflict.
  test.each([
    ['plain', '# Notes\n\nfirst line\n', '# Plans\n\nfirst line\n'],
    ['CRLF', '# Notes\r\n\r\nfirst line\r\n', '# Plans\r\n\r\nfirst line\r\n'],
  ])(
    'a body that opens with the title (%s) shows the new title as its heading, and the next save keeps it',
    async (_name, body, renamed) => {
      mocked.saveBody.mockImplementation(async (p: string, b: string) => {
        files[p] = file(p, 'Plans', b, 'v3')
        return { version: 'v3' }
      })
      const { container, editor, finish } = await renameAndStayInBody(body)
      await finish(renamed)
      const next = pm(container)
      expect(next).not.toBe(editor)
      expect(serializeBody(next)).toBe(renamed)
      expect(next.view.dom.querySelector('h1')).toHaveTextContent('Plans')
      // The handed-over text is what the file holds: nothing to save yet.
      expect(mocked.saveBody).not.toHaveBeenCalled()
      act(() => {
        next.commands.focus('end')
        next.commands.insertContent(' more')
      })
      await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledTimes(1), { timeout: 4000 })
      const [path, saved, base] = mocked.saveBody.mock.calls[0]
      expect(path).toBe(NEW)
      expect(base).toBe('v2')
      expect(saved).toBe(renamed.replace('first line', 'first line more'))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
    15000,
  )

  test('words typed while the rename ran are saved under the new heading, not the old one', async () => {
    mocked.saveBody.mockResolvedValue({ version: 'v3' })
    const { container, editor, finish } = await renameAndStayInBody('# Notes\n\nfirst line\n')
    act(() => {
      editor.commands.focus('end')
      editor.commands.insertContent(' more')
    })
    await finish('# Plans\n\nfirst line\n')
    expect(serializeBody(pm(container))).toBe('# Plans\n\nfirst line more\n')
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledWith(NEW, '# Plans\n\nfirst line more\n', 'v2'))
    expect(mocked.saveBody).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  }, 15000)

  test('a heading the user changed meanwhile is theirs: it is saved as typed', async () => {
    mocked.saveBody.mockResolvedValue({ version: 'v3' })
    const { container, editor, finish } = await renameAndStayInBody('# Notes\n\nfirst line\n')
    act(() => {
      editor.commands.focus(1 + 'Notes'.length)
      editor.commands.insertContent(' two')
    })
    expect(serializeBody(editor)).toBe('# Notes two\n\nfirst line\n')
    await finish('# Plans\n\nfirst line\n')
    expect(serializeBody(pm(container))).toBe('# Notes two\n\nfirst line\n')
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledWith(NEW, '# Notes two\n\nfirst line\n', 'v2'))
  }, 15000)

  test('a title committed by clicking elsewhere moves the note without taking the focus into the body', async () => {
    const user = userEvent.setup()
    mocked.renameObject.mockImplementation(async () => {
      files[NEW] = file(NEW, 'Plans', BODY, 'v2')
      delete files[PATH]
      return { path: NEW, version: 'v2', relinked: [], skipped: [] }
    })
    useTabs.getState().open({ kind: 'object', path: PATH })
    const utils = render(<ObjectPageOfTab />)
    const editor = await waitFor(() => pm(utils.container))
    const title = screen.getByRole('textbox', { name: 'Title' })
    await user.clear(title)
    await user.type(title, 'Plans')
    act(() => title.blur())
    const next = await waitFor(() => {
      const ed = pm(utils.container)
      expect(ed).not.toBe(editor)
      return ed
    })
    expect(serializeBody(next)).toBe(BODY)
    expect(bodyHasFocus(next)).toBe(false)
  }, 15000)

  test('with the note open in two places, the pane being typed in keeps the caret and the text is saved once', async () => {
    const user = userEvent.setup()
    files[PATH] = file(PATH, 'Notes', '', 'v1')
    let finishRename!: (r: RenameResult) => void
    mocked.renameObject.mockImplementation(
      () =>
        new Promise<RenameResult>((resolve) => {
          finishRename = resolve
        }),
    )
    mocked.saveBody.mockResolvedValue({ version: 'v3' })
    useTabs.getState().open({ kind: 'object', path: PATH })
    const { container } = render(
      <>
        <div data-pane="main">
          <ObjectPageOfTab />
        </div>
        <div data-pane="side">
          <ObjectPageOfTab />
        </div>
      </>,
    )
    const pane = (name: string) => container.querySelector(`[data-pane="${name}"]`) as HTMLElement
    const side = await waitFor(() => pm(pane('side')))
    await waitFor(() => pm(pane('main')))
    const title = pane('side').querySelector('input[aria-label="Title"]') as HTMLInputElement
    await user.clear(title)
    await user.type(title, 'Plans{Enter}')
    await waitFor(() => expect(mocked.renameObject).toHaveBeenCalledTimes(1))
    act(() => {
      side.commands.insertContent('Hello')
    })
    const typed = serializeBody(side)
    files[NEW] = file(NEW, 'Plans', '', 'v2')
    delete files[PATH]
    await act(async () => {
      finishRename({ path: NEW, version: 'v2', relinked: [], skipped: [] })
    })
    const nextSide = pm(pane('side'))
    const nextMain = pm(pane('main'))
    expect(nextSide).not.toBe(side)
    expect(serializeBody(nextSide)).toBe(typed)
    expect(bodyHasFocus(nextSide)).toBe(true)
    expect(bodyHasFocus(nextMain)).toBe(false)
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledWith(NEW, typed, 'v2'))
    expect(mocked.saveBody).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  }, 15000)

  test('text that cannot be saved under the new path is kept and offered, never dropped', async () => {
    mocked.saveBody.mockRejectedValue(new Error('disk full'))
    const { container, editor, finish } = await renameAndStayInBody('')
    act(() => {
      editor.commands.insertContent('Hello')
    })
    const typed = serializeBody(editor)
    await finish()
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledWith(NEW, typed, 'v2'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Hello')
    expect(keptUnsaved(NEW)).toBe(typed)
    // The editor is back on what the file holds; the offered text is one click from saved.
    expect(serializeBody(pm(container))).toBe('')
  }, 15000)
})

// F1, the other branch: two titles can map to one file name ("Notes?" and "Notes"), so the rename
// answers the same path and this view and its editor stay. The file's heading still changed.
describe('a rename that keeps the file name', () => {
  const HEADED = '# Notes\n\nfirst line\n'
  const RENAMED = '# Plans\n\nfirst line\n'

  test('the heading follows the title, and the next save keeps it', async () => {
    const user = userEvent.setup()
    files[PATH] = file(PATH, 'Notes', HEADED, 'v1')
    mocked.renameObject.mockImplementation(async () => {
      files[PATH] = file(PATH, 'Plans', RENAMED, 'v2')
      return { path: PATH, version: 'v2', relinked: [], skipped: [] }
    })
    mocked.saveBody.mockResolvedValue({ version: 'v3' })
    const { editor, title } = await open()
    await user.clear(title)
    await user.type(title, 'Plans{Enter}')
    await waitFor(() => expect(serializeBody(editor)).toBe(RENAMED))
    expect(mocked.saveBody).not.toHaveBeenCalled()
    act(() => {
      editor.commands.focus('end')
      editor.commands.insertContent(' more')
    })
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledWith(PATH, '# Plans\n\nfirst line more\n', 'v2'), {
      timeout: 4000,
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  }, 15000)

  test('a body without the title as a heading is not read again', async () => {
    const user = userEvent.setup()
    mocked.renameObject.mockImplementation(async () => {
      files[PATH] = file(PATH, 'Plans', BODY, 'v2')
      return { path: PATH, version: 'v2', relinked: [], skipped: [] }
    })
    const { editor, title } = await open()
    mocked.object.mockClear()
    await user.clear(title)
    await user.type(title, 'Plans{Enter}')
    await waitFor(() => expect(mocked.renameObject).toHaveBeenCalled())
    await act(async () => {})
    expect(mocked.object).not.toHaveBeenCalled()
    expect(serializeBody(editor)).toBe(BODY)
    expect(bodyHasFocus(editor)).toBe(true)
  }, 15000)
})

/** The page of the active tab's object, keyed by its path as in the app. */
function ObjectPageOfTab() {
  const target = useTabs((s) => currentTarget(s))
  return target?.kind === 'object' ? <ObjectPage path={target.path} /> : null
}
