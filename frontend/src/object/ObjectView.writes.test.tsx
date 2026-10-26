import type { Editor as TiptapEditor } from '@tiptap/core'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, ObjectDetail, SpaceInfo, TypeDef, UpdateResult } from '@/api/types'
import { objectDetail, objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import { serializeBody } from '@/editor/document'
import { resetLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { ObjectPage } from './ObjectPage'

const mocked = vi.mocked(api)

const STAGE = propertyDef({
  id: 'p-stage',
  key: 'stage',
  name: 'Stage',
  type: 'label',
  options: {
    isArray: false,
    set: [
      { id: 'o1', text: 'Idea', color: 'gray', icon: null },
      { id: 'o2', text: 'Doing', color: 'blue', icon: null },
    ],
  },
})

const PROJECT: TypeDef = typeDef({
  id: 'project',
  name: 'Project',
  pluralName: 'Projects',
  revision: 'r1',
  propertyDefinitions: [STAGE],
})

const PATH = 'Projects/Notes.md'
const ORIGINAL = 'First paragraph.\n\nSecond paragraph.\n'
const THEIRS = 'First paragraph.\n\nSecond paragraph, edited in VS Code.\n'

function detail(body: string, version: string, frontmatter: Record<string, unknown> = {}): ObjectDetail {
  return objectDetail({
    summary: objectSummary({ path: PATH, type: 'project', title: 'Notes' }),
    frontmatter: { type: 'Project', title: 'Notes', stage: 'Idea', ...frontmatter },
    body,
    version,
  })
}

let listeners: ((e: ChangeEvent) => void)[] = []
let onDisk: ObjectDetail

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  listeners = []
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  onDisk = detail(ORIGINAL, 'v1')
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PROJECT] } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue([onDisk.summary])
  mocked.object.mockImplementation(async () => onDisk)
  mocked.resolve.mockResolvedValue(null)
  mocked.saveBody.mockImplementation(async () => ({ version: 'v3' }))
  mocked.updateProperties.mockImplementation(
    async (_p: string, updates: Record<string, unknown>): Promise<UpdateResult> => ({
      version: 'v4',
      frontmatter: { ...updates },
      links: {},
      synced: [],
      skipped: [],
    }),
  )
  mocked.saveType.mockImplementation(async (t: TypeDef) => ({ type: { ...t, revision: 'r2' }, rewritten: [], skipped: [] }))
  mocked.renameObject.mockImplementation(async (_p: string, title: string, base: string) => ({
    path: `Projects/${title}.md`,
    version: `${base}+r`,
    relinked: [],
    skipped: [],
  }))
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
  // The type has loaded: the label cell is editable.
  await screen.findByRole('button', { name: 'Edit Stage' })
  return { ...utils, editor }
}

/** Type `text` at the end of the first paragraph. */
function typeInBody(editor: TiptapEditor, text: string): string {
  let pos = -1
  editor.state.doc.forEach((node, offset) => {
    if (pos < 0 && node.type.name === 'paragraph') pos = offset + node.nodeSize - 1
  })
  act(() => {
    editor.commands.insertContentAt(pos, text)
  })
  return serializeBody(editor)
}

async function pickStage(option: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Edit Stage' }))
  const list = await screen.findByRole('listbox', { name: 'Stage' })
  fireEvent.click(within(list).getByRole('option', { name: new RegExp(option) }))
}

describe('serialized writes', () => {
  test('test property edit while body dirty keeps both', async () => {
    const { editor } = await openPage()
    const mine = typeInBody(editor, ' mine')
    await pickStage('Doing')

    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledTimes(1))
    expect(mocked.saveBody).toHaveBeenCalledWith(PATH, mine, 'v1')
    // The body is saved first, and the property write is based on that save's version.
    expect(mocked.saveBody.mock.invocationCallOrder[0]).toBeLessThan(mocked.updateProperties.mock.invocationCallOrder[0])
    expect(mocked.updateProperties).toHaveBeenCalledWith(PATH, { stage: ['Doing'] }, 'v3', undefined)
    expect(serializeBody(editor)).toBe(mine)

    // The editor resumes on the version the property write returned.
    const more = typeInBody(editor, '!')
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledTimes(2), { timeout: 3000 })
    expect(mocked.saveBody).toHaveBeenLastCalledWith(PATH, more, 'v4')
    expect(screen.queryByRole('dialog', { name: /changed on disk/i })).not.toBeInTheDocument()
  }, 15000)

  test('test body flush conflict stops queue and replays property edit', async () => {
    mocked.saveBody.mockRejectedValueOnce(new ConflictError('v2'))
    const { editor } = await openPage()
    typeInBody(editor, ' mine')
    onDisk = detail(THEIRS, 'v2')
    await pickStage('Doing')

    const dialog = await screen.findByRole('dialog', { name: /changed on disk/i })
    expect(screen.getAllByRole('dialog', { name: /changed on disk/i })).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 50))
    expect(mocked.updateProperties).not.toHaveBeenCalled()

    // "Take theirs" reloads the file; the queued property edit is then sent on that version.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take theirs' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledTimes(1))
    expect(mocked.updateProperties).toHaveBeenCalledWith(PATH, { stage: ['Doing'] }, 'v2', undefined)
    expect(serializeBody(editor)).toBe(THEIRS)
    await new Promise((r) => setTimeout(r, 50))
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
    expect(mocked.saveBody).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: /changed on disk/i })).not.toBeInTheDocument()
  })

  test('test 409 on property update runs reconcile', async () => {
    await openPage()
    mocked.updateProperties.mockRejectedValueOnce(new ConflictError('v2'))
    onDisk = detail(ORIGINAL, 'v2', { stage: 'Idea', owner: 'someone' })
    mocked.object.mockClear()
    await pickStage('Doing')

    // The conflict reloads the (clean) object and replays the edit on the version on disk.
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledTimes(2))
    expect(mocked.object).toHaveBeenCalledWith(PATH)
    expect(mocked.updateProperties.mock.calls[0][2]).toBe('v1')
    expect(mocked.updateProperties.mock.calls[1][2]).toBe('v2')
    expect(screen.queryByRole('dialog', { name: /changed on disk/i })).not.toBeInTheDocument()
  })

  test('test editing a label calls updateProperties with option text', async () => {
    await openPage()
    await pickStage('Doing')
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith(PATH, { stage: ['Doing'] }, 'v1', undefined))
    // The panel shows the written value.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Stage' })).toHaveTextContent('Doing'))
    expect(mocked.saveBody).not.toHaveBeenCalled()
  })

  test('test new label option saves the type before updateProperties', async () => {
    const user = userEvent.setup()
    await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit Stage' }))
    await user.type(await screen.findByPlaceholderText('Search or create'), 'Blocked')
    await user.click(screen.getByRole('button', { name: "New 'Blocked'" }))

    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledTimes(1))
    expect(mocked.saveType).toHaveBeenCalledTimes(1)
    const saved = mocked.saveType.mock.calls[0][0] as TypeDef
    expect(saved.propertyDefinitions[0].options.set?.map((o) => o.text)).toEqual(['Idea', 'Doing', 'Blocked'])
    expect(mocked.saveType.mock.calls[0][1]).toEqual({ baseRevision: 'r1' })
    expect(mocked.saveType.mock.invocationCallOrder[0]).toBeLessThan(mocked.updateProperties.mock.invocationCallOrder[0])
    expect(mocked.updateProperties).toHaveBeenCalledWith(PATH, { stage: ['Blocked'] }, 'v1', undefined)
  })

  test('test title commit on Enter calls renameObject; Esc reverts', async () => {
    const user = userEvent.setup()
    useTabs.getState().open({ kind: 'object', path: PATH })
    await openPage()
    const title = screen.getByRole('textbox', { name: 'Title' })

    // Esc reverts and writes nothing.
    await user.clear(title)
    await user.type(title, 'Draft{Escape}')
    expect(title).toHaveValue('Notes')
    expect(mocked.renameObject).not.toHaveBeenCalled()

    // Enter trims and commits; the tab follows the file to its new path.
    await user.clear(title)
    await user.type(title, '  Plans  {Enter}')
    await waitFor(() => expect(mocked.renameObject).toHaveBeenCalledWith(PATH, 'Plans', 'v1'))
    expect(mocked.renameObject).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Projects/Plans.md' }))
  })

  test('a rename that keeps the path updates the title, so renaming back is still sent', async () => {
    const user = userEvent.setup()
    // safe_filename cuts at the first illegal character: both titles stay at the same path.
    mocked.renameObject.mockImplementation(async (_p: string, _title: string, base: string) => ({
      path: PATH,
      version: `${base}+r`,
      relinked: [],
      skipped: [],
    }))
    await openPage()
    const title = screen.getByRole('textbox', { name: 'Title' })

    await user.clear(title)
    await user.type(title, 'Notes: two{Enter}')
    await waitFor(() => expect(mocked.renameObject).toHaveBeenCalledWith(PATH, 'Notes: two', 'v1'))

    await user.clear(title)
    await user.type(title, 'Notes{Enter}')
    await waitFor(() => expect(mocked.renameObject).toHaveBeenCalledTimes(2))
    expect(mocked.renameObject).toHaveBeenLastCalledWith(PATH, 'Notes', 'v1+r')
    expect(title).toHaveValue('Notes')
  })
})

describe('App events', () => {
  test('a renamed event retargets the tabs; a types event reloads the index', async () => {
    const { default: App } = await import('@/App')
    useTabs.getState().open({ kind: 'type', typeId: 'project' })
    useTabs.getState().open({ kind: 'object', path: 'Projects/Old.md' }, { newTab: true })
    useTabs.getState().open({ kind: 'type', typeId: 'project' })
    render(<App />)
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0))
    const spaceCalls = mocked.space.mock.calls.length
    act(() => {
      for (const cb of [...listeners]) cb({ kind: 'renamed', path: 'Projects/New.md', oldPath: 'Projects/Old.md', version: 'n1' })
    })
    expect(useTabs.getState().tabs[1].history[0]).toEqual({ kind: 'object', path: 'Projects/New.md' })
    act(() => {
      for (const cb of [...listeners]) cb({ kind: 'types', path: 'project', version: 'r2' })
    })
    await waitFor(() => expect(mocked.space.mock.calls.length).toBeGreaterThan(spaceCalls))
  })
})
