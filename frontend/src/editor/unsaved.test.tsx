import type { Editor as TiptapEditor } from '@tiptap/core'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
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
import { keptUnsaved, resetUnsaved } from './unsaved'

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
