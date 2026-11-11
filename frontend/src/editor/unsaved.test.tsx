import type { Editor as TiptapEditor } from '@tiptap/core'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, ObjectDetail, SpaceInfo } from '@/api/types'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError, ReadOnlyError } from '@/api/client'
import { serializeBody } from '@/editor/document'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { ObjectPage } from '@/object/ObjectPage'
import { flushAll } from '@/lib/flush'
import { keepUnsaved, keptUnsaved, resetUnsaved, setUnsavedSpace } from './unsaved'

const mocked = vi.mocked(api)

const PATH = 'Pages/Notes.md'
const ORIGINAL = 'First paragraph.\n\nSecond paragraph.\n'
const THEIRS = 'First paragraph.\n\nSecond paragraph, edited in VS Code.\n'

function detail(body: string, version: string): ObjectDetail {
  return objectDetail({
    summary: objectSummary({ path: PATH, type: 'page', title: 'Notes' }),
    frontmatter: { type: 'page', title: 'Notes' },
    body,
    version,
  })
}

let onDisk: ObjectDetail
let listeners: ((e: ChangeEvent) => void)[] = []

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  resetUnsaved()
  listeners = []
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  onDisk = detail(ORIGINAL, 'v1')
  mocked.space.mockResolvedValue({
    name: 's',
    root: '/s',
    types: [typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', folder: 'Pages' })],
  } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue([onDisk.summary])
  mocked.object.mockImplementation(async () => onDisk)
  mocked.resolve.mockResolvedValue(null)
  mocked.saveBody.mockImplementation(async () => ({ version: 'v9' }))
  mocked.onChange.mockImplementation((cb: (e: ChangeEvent) => void) => {
    listeners.push(cb)
    return () => {
      listeners = listeners.filter((l) => l !== cb)
    }
  })
})

function pmEditor(container: HTMLElement): TiptapEditor {
  const dom = container.querySelector('.ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null
  if (!dom?.editor) throw new Error('editor not mounted')
  return dom.editor
}

async function openPage(expectBody = ORIGINAL) {
  const utils = render(<ObjectPage path={PATH} />)
  // `hidden`: a recovery dialog opened over the page hides it from the accessibility tree.
  await screen.findByRole('heading', { level: 1, name: 'Notes', hidden: true })
  const editor = await waitFor(() => pmEditor(utils.container))
  await waitFor(() => expect(serializeBody(editor)).toBe(expectBody))
  return { ...utils, editor }
}

function typeMine(editor: TiptapEditor): string {
  act(() => {
    editor.commands.insertContentAt(editor.state.doc.firstChild!.nodeSize - 1, ' mine')
  })
  return serializeBody(editor)
}

describe('edits that could not be saved when the object is left', () => {
  test('a save rejected with a conflict: leaving with the dialog open keeps the text and offers it again', async () => {
    mocked.saveBody.mockRejectedValueOnce(new ConflictError('v2'))
    const first = await openPage()
    const mine = typeMine(first.editor)
    onDisk = detail(THEIRS, 'v2')
    await screen.findByRole('dialog', { name: /changed on disk/i }, { timeout: 2500 })
    first.unmount() // the tab is closed with the dialog still open
    expect(keptUnsaved(PATH)).toBe(mine)
    expect(mocked.saveBody).toHaveBeenCalledTimes(1) // nothing was written over their change

    await openPage(THEIRS)
    const dialog = await screen.findByRole('dialog', { name: 'Recover unsaved changes' })
    expect(within(dialog).getByText(/Second paragraph, edited in VS Code/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(mocked.saveBody).toHaveBeenLastCalledWith(PATH, mine, 'v2'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(keptUnsaved(PATH)).toBeNull()
  })

  test('discarding the kept text leaves the file alone', async () => {
    mocked.saveBody.mockRejectedValueOnce(new ReadOnlyError('locked'))
    const first = await openPage()
    typeMine(first.editor)
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledTimes(1), { timeout: 2500 })
    first.unmount()
    expect(keptUnsaved(PATH)).not.toBeNull()

    const second = await openPage()
    const dialog = await screen.findByRole('dialog', { name: 'Recover unsaved changes' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(keptUnsaved(PATH)).toBeNull()
    expect(serializeBody(second.editor)).toBe(ORIGINAL)
    expect(mocked.saveBody).toHaveBeenCalledTimes(1)
  })

  test('a save sent while leaving that is rejected keeps the text', async () => {
    const first = await openPage()
    const mine = typeMine(first.editor)
    mocked.saveBody.mockRejectedValueOnce(new ConflictError('v2'))
    first.unmount() // the unmount flush gets the 409 after the view is gone
    await waitFor(() => expect(keptUnsaved(PATH)).toBe(mine))
  })

  test('a space switch with the conflict dialog open keeps the text before the page reloads', async () => {
    mocked.saveBody.mockRejectedValueOnce(new ConflictError('v2'))
    const first = await openPage()
    const mine = typeMine(first.editor)
    onDisk = detail(THEIRS, 'v2')
    await screen.findByRole('dialog', { name: /changed on disk/i }, { timeout: 2500 })
    await act(async () => {
      await flushAll() // what `switchSpace` runs before the server switches and the page reloads
    })
    expect(keptUnsaved(PATH)).toBe(mine) // no unmount happens: a reload skips the effect cleanups
    expect(mocked.saveBody).toHaveBeenCalledTimes(1)
  })

  test('text kept for a deleted object is not offered to another object made at its path', async () => {
    onDisk = { ...onDisk, summary: { ...onDisk.summary, id: 'id-old' } }
    mocked.saveBody.mockRejectedValueOnce(new ConflictError('v2'))
    const first = await openPage()
    const mine = typeMine(first.editor)
    onDisk = { ...detail(THEIRS, 'v2'), summary: { ...onDisk.summary, id: 'id-old' } }
    await screen.findByRole('dialog', { name: /changed on disk/i }, { timeout: 2500 })
    first.unmount()
    expect(keptUnsaved(PATH, 'id-old')).toBe(mine)

    onDisk = { ...detail(THEIRS, 'v5'), summary: { ...onDisk.summary, id: 'id-new' } }
    await openPage(THEIRS)
    await act(async () => new Promise((r) => setTimeout(r, 50)))
    expect(screen.queryByRole('dialog', { name: 'Recover unsaved changes' })).not.toBeInTheDocument()
    expect(keptUnsaved(PATH, 'id-old')).toBe(mine) // still there, should the old object be restored
  })

  test('a clean leave keeps nothing', async () => {
    const first = await openPage()
    typeMine(first.editor)
    first.unmount()
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledTimes(1))
    expect(keptUnsaved(PATH)).toBeNull()
  })

  test('text kept by a settle while paused is forgotten once Keep mine saves it', async () => {
    mocked.saveBody.mockRejectedValueOnce(new ConflictError('v2'))
    const first = await openPage()
    typeMine(first.editor)
    onDisk = detail(THEIRS, 'v2')
    const dialog = await screen.findByRole('dialog', { name: /changed on disk/i }, { timeout: 2500 })
    await act(async () => {
      await flushAll() // e.g. a version restore or export settles the editor while paused
    })
    expect(keptUnsaved(PATH)).not.toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep mine' }))
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(keptUnsaved(PATH)).toBeNull())
    // More typing and a clean leave: reopening offers nothing old.
    const later = typeMine(first.editor)
    first.unmount()
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledTimes(3))
    onDisk = detail(later, 'v9')
    await openPage(later)
    expect(screen.queryByRole('dialog', { name: 'Recover unsaved changes' })).not.toBeInTheDocument()
  })

  test('text kept by a settle while paused is forgotten on Take theirs', async () => {
    mocked.saveBody.mockRejectedValueOnce(new ConflictError('v2'))
    const first = await openPage()
    typeMine(first.editor)
    onDisk = detail(THEIRS, 'v2')
    const dialog = await screen.findByRole('dialog', { name: /changed on disk/i }, { timeout: 2500 })
    await act(async () => {
      await flushAll()
    })
    expect(keptUnsaved(PATH)).not.toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take theirs' }))
    await waitFor(() => expect(serializeBody(first.editor)).toBe(THEIRS))
    expect(keptUnsaved(PATH)).toBeNull()
  })
})

describe('the recovery dialog', () => {
  const KEPT = 'First paragraph. kept\n\nSecond paragraph.\n'

  test('a double-click on "Save changes" saves once', async () => {
    keepUnsaved(PATH, KEPT)
    await openPage()
    const dialog = await screen.findByRole('dialog', { name: 'Recover unsaved changes' })
    const save = within(dialog).getByRole('button', { name: 'Save changes' })
    mocked.saveBody.mockImplementationOnce(async () => ({ version: 'v2' }))
    mocked.saveBody.mockImplementationOnce(async () => {
      throw new ConflictError('v2')
    })
    fireEvent.click(save)
    fireEvent.click(save)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocked.saveBody.mock.calls.filter((c) => c[1] === KEPT)).toHaveLength(1)
    expect(keptUnsaved(PATH)).toBeNull()
  })

  test('a conflict on save whose file already holds the kept text closes the dialog', async () => {
    keepUnsaved(PATH, KEPT)
    await openPage()
    const dialog = await screen.findByRole('dialog', { name: 'Recover unsaved changes' })
    mocked.saveBody.mockRejectedValueOnce(new ConflictError('v2'))
    onDisk = detail(KEPT, 'v2') // another window saved the same text meanwhile
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(keptUnsaved(PATH)).toBeNull()
  })

  test('"Version on disk" follows a change made while the dialog is open', async () => {
    keepUnsaved(PATH, KEPT)
    await openPage()
    const dialog = await screen.findByRole('dialog', { name: 'Recover unsaved changes' })
    onDisk = detail(THEIRS, 'v2')
    act(() => {
      for (const cb of [...listeners]) cb({ kind: 'changed', path: PATH, version: 'v2' })
    })
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Version on disk')).toHaveTextContent(/edited in VS Code/),
    )
  })
})

// The M32 review, F2 (decision): a note the closing window could not save (too long for a
// keepalive request, or more was typed while a save was in flight) is not silently gone. The
// kept text is in local storage, so the next window finds it; a storage entry written here by
// hand is what a window that has been closed left behind.
describe('text a closed window left unsaved', () => {
  const CUT = 'First paragraph, and the words the close cut off.\n\nSecond paragraph.\n'
  const leftBy = (root: string, body: string, id: string | null = null) =>
    localStorage.setItem(`object.unsaved:${root}\n${PATH}`, JSON.stringify({ body, id }))

  beforeEach(() => setUnsavedSpace('/s'))
  afterEach(() => setUnsavedSpace(null))

  test('test it is offered when the note next opens, and saving it clears it', async () => {
    leftBy('/s', CUT)
    const { editor } = await openPage()
    const dialog = await screen.findByRole('dialog', { name: 'Recover unsaved changes' })
    expect(within(dialog).getByText(/the words the close cut off/)).toBeInTheDocument()
    // Nothing is written until the user says so.
    expect(mocked.saveBody).not.toHaveBeenCalled()
    expect(serializeBody(editor)).toBe(ORIGINAL)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledWith(PATH, CUT, 'v1'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(serializeBody(editor)).toBe(CUT)
    expect(keptUnsaved(PATH)).toBeNull()
    expect(localStorage.getItem(`object.unsaved:/s\n${PATH}`)).toBeNull()
  })

  test('test text the file already holds (its save landed after the window had gone) is not offered, and is cleared', async () => {
    onDisk = detail(CUT, 'v2')
    leftBy('/s', CUT)
    await openPage(CUT)
    await act(async () => new Promise((r) => setTimeout(r, 50)))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem(`object.unsaved:/s\n${PATH}`)).toBeNull()
    expect(mocked.saveBody).not.toHaveBeenCalled()
  })

  test('test a note that changed on disk since is never written by itself: both texts are shown and the save is checked', async () => {
    // Something else changed the file after the window closed.
    onDisk = detail(THEIRS, 'v2')
    leftBy('/s', CUT)
    const { editor } = await openPage(THEIRS)
    const dialog = await screen.findByRole('dialog', { name: 'Recover unsaved changes' })
    // The editor shows the file; the dialog shows the version on disk beside the kept text.
    expect(serializeBody(editor)).toBe(THEIRS)
    expect(within(dialog).getByText(/the words the close cut off/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Second paragraph, edited in VS Code/)).toBeInTheDocument()
    expect(mocked.saveBody).not.toHaveBeenCalled()
    // It changes again before the choice: the save stands on the version that was shown, is
    // refused, writes nothing, and the dialog asks again with the newest version.
    const NEWER = 'First paragraph.\n\nSecond paragraph, edited twice.\n'
    onDisk = detail(NEWER, 'v3')
    mocked.saveBody.mockRejectedValueOnce(new ConflictError('v3'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledWith(PATH, CUT, 'v2'))
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByText(/edited twice/)).toBeInTheDocument())
    expect(mocked.saveBody).toHaveBeenCalledTimes(1)
    expect(keptUnsaved(PATH)).toBe(CUT)
    // Discard leaves the file alone.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocked.saveBody).toHaveBeenCalledTimes(1)
    expect(serializeBody(editor)).toBe(NEWER)
    expect(keptUnsaved(PATH)).toBeNull()
  })

  test("test another space's note at the same path is never offered", async () => {
    leftBy('/other', CUT)
    leftBy('/s/nested', CUT)
    await openPage()
    await act(async () => new Promise((r) => setTimeout(r, 50)))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(keptUnsaved(PATH)).toBeNull()
    // Theirs is still there for their own space.
    expect(localStorage.getItem(`object.unsaved:/other\n${PATH}`)).not.toBeNull()
  })

  test('test text left for another object that was at this path is not offered', async () => {
    onDisk = { ...onDisk, summary: { ...onDisk.summary, id: 'id-new' } }
    leftBy('/s', CUT, 'id-old')
    await openPage()
    await act(async () => new Promise((r) => setTimeout(r, 50)))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
