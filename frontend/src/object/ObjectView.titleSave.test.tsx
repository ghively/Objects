// The hands-on walk of M32, W1 (Critical, typing lost): "New note", a title typed, and nothing
// else: the title was saved only on Enter, Tab or a click elsewhere, so a closed window lost it.
// The title is kept like the text: committed 2 s after the last key in it, and at once when the
// window is going or the view closes, through the rename handover, without disturbing the person.
import type { Editor as TiptapEditor } from '@tiptap/core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ObjectDetail, RenameResult, SpaceInfo, TypeDef } from '@/api/types'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api, ApiError } from '@/api/client'
import { serializeBody } from '@/editor/document'
import { setUnsavedSpace } from '@/editor/unsaved'
import { resetLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { TITLE_COMMIT_MS } from './ObjectHeader'
import { ObjectPage } from './ObjectPage'
import { ObjectView } from './ObjectView'

const mocked = vi.mocked(api)
const PAGE: TypeDef = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1', basic: true })
const PATH = 'Pages/Untitled.md'
const NEW = 'Pages/Plans.md'
const NEWER = 'Pages/Plans for May.md'

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
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  files = { [PATH]: file(PATH, 'Untitled', '', 'v1') }
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.objects.mockImplementation(async () => Object.values(files).map((d) => d.summary))
  mocked.object.mockImplementation(async (p: string) => {
    if (!files[p]) throw new Error('Not found')
    return files[p]
  })
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  document.querySelector('[data-editor-toasts]')?.remove()
})

function pm(container: HTMLElement): TiptapEditor {
  const dom = container.querySelector('.object-body-text .ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null
  if (!dom?.editor) throw new Error('editor not mounted')
  return dom.editor
}

const titleOf = () => screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement
const type = (el: HTMLInputElement, value: string) => fireEvent.change(el, { target: { value, selectionStart: value.length } })
/** Let `ms` of timers pass (the title's wait, the body's autosave) and what they started settle. */
const pass = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms))
const settle = () => act(async () => vi.advanceTimersByTimeAsync(0))

/** The page of the active tab's note, keyed by its path as in the app. */
function ObjectPageOfTab() {
  const target = useTabs((s) => currentTarget(s))
  return target?.kind === 'object' ? <ObjectPage path={target.path} /> : null
}

/** Open the note as the active tab's page; from then on timers are stepped by hand. */
async function open() {
  useTabs.getState().open({ kind: 'object', path: PATH })
  const utils = render(<ObjectPageOfTab />)
  const editor = await waitFor(() => pm(utils.container))
  await waitFor(() => expect(serializeBody(editor)).toBe(files[PATH].body))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const title = titleOf()
  act(() => title.focus())
  return { ...utils, editor, title }
}

/** `renameObject` that answers when told to: the file moves to `to` then. */
function heldRename() {
  const done: (() => Promise<void>)[] = []
  mocked.renameObject.mockImplementation(
    (path: string, title: string) =>
      new Promise<RenameResult>((resolve) => {
        done.push(async () => {
          const to = `Pages/${title}.md`
          const version = `v-${title}`
          files[to] = file(to, title, files[path]?.body ?? '', version)
          if (to !== path) delete files[path]
          await act(async () => resolve({ path: to, version, relinked: [], skipped: [] }))
        })
      }),
  )
  return { finish: (i: number) => done[i]() }
}

const mark = (container: HTMLElement) => container.querySelector('[data-save-mark]') as HTMLElement

describe('a typed title is kept like the text (W1)', () => {
  test('test a title typed and left alone is saved after 2 s: the note is renamed and nothing about the field changes', async () => {
    const rename = heldRename()
    const { title, container } = await open()
    type(title, 'Plans')
    title.setSelectionRange(1, 3)
    expect(mark(container)).toHaveTextContent('Saving…')
    await pass(TITLE_COMMIT_MS - 1)
    expect(mocked.renameObject).not.toHaveBeenCalled()
    await pass(1)
    expect(mocked.renameObject).toHaveBeenCalledTimes(1)
    expect(mocked.renameObject).toHaveBeenCalledWith(PATH, 'Plans', 'v1')
    expect(title).toHaveFocus()
    expect(mark(container)).toHaveTextContent('Saving…')

    await rename.finish(0)
    // The file moved, so the view was replaced: the field that took over has the focus, the
    // text and the selection the person left.
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: NEW })
    const next = titleOf()
    expect(next).not.toBe(title)
    expect(next).toHaveFocus()
    expect(next).toHaveValue('Plans')
    expect([next.selectionStart, next.selectionEnd]).toEqual([1, 3])
    expect(mark(container)).toHaveTextContent('Saved')
    // One rename: the view that left does not commit again, and nothing follows by itself.
    await pass(10_000)
    expect(mocked.renameObject).toHaveBeenCalledTimes(1)
    expect(mocked.saveBody).not.toHaveBeenCalled()
  }, 20000)

  test('test keys typed while the rename is on its way are kept in the field and committed after the next pause', async () => {
    const rename = heldRename()
    const { title, container } = await open()
    type(title, 'Plans')
    await pass(TITLE_COMMIT_MS)
    expect(mocked.renameObject).toHaveBeenCalledWith(PATH, 'Plans', 'v1')
    type(title, 'Plans for May')
    title.setSelectionRange(9, 9)
    await rename.finish(0)
    const next = titleOf()
    expect(next).toHaveFocus()
    expect(next).toHaveValue('Plans for May') // the field's own text, not the server's "Plans"
    expect([next.selectionStart, next.selectionEnd]).toEqual([9, 9])
    expect(mark(container)).toHaveTextContent('Saving…') // the rest of the title still waits
    expect(mocked.renameObject).toHaveBeenCalledTimes(1)
    await pass(TITLE_COMMIT_MS)
    expect(mocked.renameObject).toHaveBeenCalledTimes(2)
    expect(mocked.renameObject).toHaveBeenLastCalledWith(NEW, 'Plans for May', 'v-Plans')
    await rename.finish(1)
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: NEWER })
    expect(titleOf()).toHaveFocus()
    expect(titleOf()).toHaveValue('Plans for May')
    expect(mark(container)).toHaveTextContent('Saved')
  }, 20000)

  test.each([
    ['pagehide', () => window.dispatchEvent(new Event('pagehide'))],
    [
      'the document becoming hidden',
      () => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
      },
    ],
  ])('test %s commits the typed title at once', async (_name, going) => {
    const rename = heldRename()
    const { title } = await open()
    type(title, 'Plans')
    // No timer runs here: the request leaves while the event is handled (the client sends it as
    // a keepalive request: `api/client.test.ts`).
    await act(async () => {
      going()
      await Promise.resolve()
    })
    await act(async () => {})
    expect(mocked.renameObject).toHaveBeenCalledTimes(1)
    expect(mocked.renameObject).toHaveBeenCalledWith(PATH, 'Plans', 'v1')
    // The page may be gone before the answer says where the file moved to: the note's id is
    // left with the path it had, for the next page to find it by.
    expect(localStorage.getItem(`object.renaming:/s\n${PATH}`)).toBe('id-1')
    // The timer does not send it a second time.
    await pass(10_000)
    expect(mocked.renameObject).toHaveBeenCalledTimes(1)
    // This page lived to read the answer: its tab followed, and nothing is left to follow.
    await rename.finish(0)
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: NEW })
    expect(localStorage.getItem(`object.renaming:/s\n${PATH}`)).toBeNull()
  }, 20000)

  test('test a title that was not changed sends nothing when the window goes', async () => {
    const { title } = await open()
    type(title, 'Untitled ')
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    await pass(10_000)
    expect(mocked.renameObject).not.toHaveBeenCalled()
  }, 20000)

  test.each(['page', 'peek'] as const)('test closing the %s commits the typed title', async (mode) => {
    mocked.renameObject.mockResolvedValue({ path: NEW, version: 'v2', relinked: [], skipped: [] })
    const utils = render(<ObjectView path={PATH} mode={mode} />)
    await waitFor(() => pm(utils.container))
    const title = titleOf()
    act(() => title.focus())
    type(title, 'Plans')
    utils.unmount()
    await waitFor(() => expect(mocked.renameObject).toHaveBeenCalledWith(PATH, 'Plans', 'v1'))
    expect(mocked.renameObject).toHaveBeenCalledTimes(1)
  }, 20000)

  test('test the text typed before and after lands in the renamed file once, and nothing is written to the old path after the rename', async () => {
    const rename = heldRename()
    let n = 0
    mocked.saveBody.mockImplementation(async (p: string, body: string) => {
      const version = `b${++n}`
      files[p] = { ...files[p], body, version }
      return { version }
    })
    const { title, editor, container } = await open()
    // Text first, then straight to the title (the body's blur saves it), then a pause.
    act(() => {
      editor.commands.insertContent('Before')
    })
    const before = serializeBody(editor)
    act(() => title.focus())
    type(title, 'Plans')
    await pass(TITLE_COMMIT_MS)
    // The rename stands on the version the text's save answered.
    expect(mocked.saveBody.mock.calls).toEqual([[PATH, before, 'v1']])
    expect(mocked.renameObject).toHaveBeenCalledWith(PATH, 'Plans', 'b1')
    expect(mocked.saveBody.mock.invocationCallOrder[0]).toBeLessThan(mocked.renameObject.mock.invocationCallOrder[0])
    await rename.finish(0)
    const next = pm(container)
    expect(serializeBody(next)).toBe(before)
    act(() => {
      next.commands.focus('end')
      next.commands.insertContent(' and after')
    })
    const after = serializeBody(next)
    await pass(1500)
    expect(mocked.saveBody.mock.calls).toEqual([
      [PATH, before, 'v1'],
      [NEW, after, 'v-Plans'],
    ])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  }, 20000)

  test('test text typed in the body while a timed rename runs follows to the new path', async () => {
    const rename = heldRename()
    mocked.saveBody.mockResolvedValue({ version: 'b1' })
    const { title, editor, container } = await open()
    type(title, 'Plans')
    await pass(TITLE_COMMIT_MS)
    expect(mocked.renameObject).toHaveBeenCalledTimes(1)
    act(() => {
      editor.commands.focus('end')
      editor.view.focus()
      editor.commands.insertContent('Meanwhile')
    })
    const typed = serializeBody(editor)
    await rename.finish(0)
    const next = pm(container)
    expect(serializeBody(next)).toBe(typed)
    expect(document.activeElement).toBe(next.view.dom)
    await settle()
    expect(mocked.saveBody.mock.calls).toEqual([[NEW, typed, 'v-Plans']])
  }, 20000)

  test('test a title the server refuses says so once, keeps the draft, and is not sent again', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mocked.renameObject.mockRejectedValue(new ApiError(400, 'That title can\'t be used.'))
      const { title, container } = await open()
      type(title, 'Plans')
      await pass(TITLE_COMMIT_MS)
      expect(mocked.renameObject).toHaveBeenCalledTimes(1)
      const toasts = () => [...document.querySelectorAll('.editor-toast')].map((t) => t.textContent)
      expect(toasts()).toEqual(["That title can't be used."])
      await pass(60_000)
      expect(mocked.renameObject).toHaveBeenCalledTimes(1)
      expect(title).toHaveValue('Plans')
      expect(title).toHaveFocus()
      // Not "Saving…" for ever, and not "Saved": it was not.
      expect(mark(container)).toHaveTextContent('')
      // Nothing more when the window goes either: the same title would be refused again.
      await act(async () => {
        window.dispatchEvent(new Event('pagehide'))
      })
      await settle()
      expect(mocked.renameObject).toHaveBeenCalledTimes(1)
    } finally {
      quiet.mockRestore()
    }
  }, 20000)

  test('test a rename that keeps the file name shows Saved and leaves the field alone', async () => {
    mocked.renameObject.mockImplementation(async () => {
      files[PATH] = file(PATH, 'Untitled?', '', 'v2')
      return { path: PATH, version: 'v2', relinked: [], skipped: [] }
    })
    const { title, container } = await open()
    type(title, 'Untitled?')
    await pass(TITLE_COMMIT_MS)
    expect(mocked.renameObject).toHaveBeenCalledWith(PATH, 'Untitled?', 'v1')
    expect(titleOf()).toBe(title)
    expect(title).toHaveFocus()
    expect(mark(container)).toHaveTextContent('Saved')
    await pass(10_000)
    expect(mocked.renameObject).toHaveBeenCalledTimes(1)
  }, 20000)
})
