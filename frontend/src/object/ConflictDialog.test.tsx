import type { Editor as TiptapEditor } from '@tiptap/core'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, ObjectDetail, ObjectSummary, SpaceInfo, TypeDef } from '@/api/types'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      space: vi.fn(),
      objects: vi.fn(),
      object: vi.fn(),
      resolve: vi.fn(),
      saveBody: vi.fn(),
      reveal: vi.fn(),
      onChange: vi.fn(),
    },
  }
})

import { api } from '@/api/client'
import App from '@/App'
import { serializeBody } from '@/editor/document'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { ObjectPage } from './ObjectPage'

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>

const TYPES: TypeDef[] = [
  { id: 'page', name: 'Page', pluralName: 'Pages', folder: 'Pages', icon: 'ph-file-text', color: 'pink', propertyDefinitions: [] },
  { id: 'person', name: 'Person', pluralName: 'People', folder: 'People', icon: 'ph-user', color: 'orange', propertyDefinitions: [] },
]

function summary(path: string, title: string, type = 'page'): ObjectSummary {
  return { path, id: null, type, title, icon: null, createdAt: null, lastUpdated: null, tags: [], readOnly: false }
}

const PATH = 'Pages/Notes.md'
const ORIGINAL = 'First paragraph.\n\nSecond paragraph.\n'
const THEIRS = 'First paragraph.\n\nSecond paragraph, edited in VS Code.\n'

function detail(body: string, version: string): ObjectDetail {
  return {
    summary: summary(PATH, 'Notes'),
    frontmatter: { type: 'page', title: 'Notes' },
    body,
    version,
  }
}

let listeners: ((e: ChangeEvent) => void)[] = []
let onDisk: ObjectDetail

function emit(e: ChangeEvent) {
  act(() => {
    for (const cb of [...listeners]) cb(e)
  })
}

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  listeners = []
  for (const fn of Object.values(mocked)) fn.mockReset?.()
  onDisk = detail(ORIGINAL, 'v1')
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: TYPES } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue([summary(PATH, 'Notes')])
  mocked.object.mockImplementation(async () => onDisk)
  mocked.resolve.mockResolvedValue(null)
  mocked.saveBody.mockImplementation(async () => ({ version: 'v3' }))
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

async function openPage() {
  const utils = render(<ObjectPage path={PATH} />)
  await screen.findByRole('heading', { level: 1, name: 'Notes' })
  const editor = await waitFor(() => pmEditor(utils.container))
  await waitFor(() => expect(serializeBody(editor)).toBe(ORIGINAL))
  await waitFor(() => expect(listeners.length).toBeGreaterThan(0))
  return { ...utils, editor }
}

/** Type " mine" at the end of the first paragraph. */
function typeMine(editor: TiptapEditor): string {
  let pos = -1
  editor.state.doc.forEach((node, offset) => {
    if (pos < 0 && node.type.name === 'paragraph') pos = offset + node.nodeSize - 1
  })
  act(() => {
    editor.commands.insertContentAt(pos, ' mine')
  })
  return serializeBody(editor)
}

async function changeOnDisk() {
  onDisk = detail(THEIRS, 'v2')
  emit({ kind: 'changed', path: PATH, version: 'v2' })
  return screen.findByRole('dialog', { name: /changed on disk/i })
}

describe('external changes', () => {
  test('clean editor reloads on external change', async () => {
    const { editor } = await openPage()
    onDisk = detail(THEIRS, 'v2')
    emit({ kind: 'changed', path: PATH, version: 'v2' })
    await waitFor(() => expect(serializeBody(editor)).toBe(THEIRS))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocked.saveBody).not.toHaveBeenCalled()

    // An event for another object, or for the version we already have, does nothing.
    mocked.object.mockClear()
    emit({ kind: 'changed', path: 'Pages/Other.md', version: 'x' })
    emit({ kind: 'changed', path: PATH, version: 'v2' })
    await new Promise((r) => setTimeout(r, 20))
    expect(mocked.object).not.toHaveBeenCalled()
  })

  test('dirty editor shows dialog with Keep mine / Take theirs', async () => {
    const { editor } = await openPage()
    const mine = typeMine(editor)
    const dialog = await changeOnDisk()
    expect(within(dialog).getByRole('button', { name: 'Keep mine' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Take theirs' })).toBeInTheDocument()
    // Side by side: my text and the text on disk.
    expect(within(dialog).getByLabelText('Your version').textContent).toBe(mine)
    expect(within(dialog).getByLabelText('Version on disk').textContent).toBe(THEIRS)
    // Nothing was saved over the external change while the dialog is open.
    await new Promise((r) => setTimeout(r, 1200))
    expect(mocked.saveBody).not.toHaveBeenCalled()
  })

  test('Keep mine saves against new version', async () => {
    const { editor } = await openPage()
    const mine = typeMine(editor)
    const dialog = await changeOnDisk()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep mine' }))
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledTimes(1))
    expect(mocked.saveBody).toHaveBeenCalledWith(PATH, mine, 'v2')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(serializeBody(editor)).toBe(mine)

    // Later edits save against the version that save produced.
    let pos = -1
    editor.state.doc.forEach((node, offset) => {
      if (pos < 0 && node.type.name === 'paragraph') pos = offset + node.nodeSize - 1
    })
    act(() => {
      editor.commands.insertContentAt(pos, '!')
    })
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledTimes(2), { timeout: 2000 })
    expect(mocked.saveBody.mock.calls[1][2]).toBe('v3')
  })

  test('Take theirs discards local edits', async () => {
    const { editor } = await openPage()
    typeMine(editor)
    const dialog = await changeOnDisk()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take theirs' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(serializeBody(editor)).toBe(THEIRS)
    await new Promise((r) => setTimeout(r, 1200))
    expect(mocked.saveBody).not.toHaveBeenCalled()
  })

  test('a save rejected with a conflict asks too', async () => {
    const { ConflictError } = await import('@/api/client')
    mocked.saveBody.mockRejectedValueOnce(new ConflictError('v2'))
    const { editor } = await openPage()
    const mine = typeMine(editor)
    onDisk = detail(THEIRS, 'v2')
    const dialog = await screen.findByRole('dialog', { name: /changed on disk/i }, { timeout: 2500 })
    expect(mocked.saveBody).toHaveBeenCalledWith(PATH, mine, 'v1')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep mine' }))
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledTimes(2))
    expect(mocked.saveBody).toHaveBeenLastCalledWith(PATH, mine, 'v2')
  })
})

describe('App', () => {
  test('sidebar counts refresh on created/deleted', async () => {
    const objects = [summary('Pages/A.md', 'A'), summary('Pages/B.md', 'B'), summary('People/Ada.md', 'Ada', 'person')]
    mocked.objects.mockResolvedValue(objects)
    render(<App />)
    const types = await screen.findByRole('region', { name: 'Object Types' })
    const row = (name: string) => within(types).getByRole('button', { name: new RegExp(`^${name}`) })
    await waitFor(() => expect(row('Pages')).toHaveTextContent('Pages2'))
    expect(row('People')).toHaveTextContent('People1')
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0))

    mocked.objects.mockResolvedValue([...objects, summary('Pages/C.md', 'C')])
    emit({ kind: 'created', path: 'Pages/C.md', version: 'c1' })
    await waitFor(() => expect(row('Pages')).toHaveTextContent('Pages3'))

    mocked.objects.mockResolvedValue([summary('Pages/A.md', 'A'), summary('Pages/C.md', 'C')])
    emit({ kind: 'deleted', path: 'People/Ada.md', version: null })
    await waitFor(() => expect(row('People')).toHaveTextContent('People0'))
    expect(row('Pages')).toHaveTextContent('Pages2')
  })
})
