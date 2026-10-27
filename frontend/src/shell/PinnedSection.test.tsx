import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { UiState } from '@/api/types'
import { collection, objectSummary, query, typeDef } from '@/test/mockApi'

let dragEnd:
  | ((e: {
      active: { id: string }
      over: { id: string } | null
      activatorEvent?: { clientX: number; clientY: number }
      delta?: { x: number; y: number }
    }) => void)
  | undefined
vi.mock('@dnd-kit/core', async (orig) => {
  const real = await orig<typeof import('@dnd-kit/core')>()
  return {
    ...real,
    DndContext: (p: { onDragEnd: typeof dragEnd; children: React.ReactNode }) => {
      dragEnd = p.onDragEnd
      return <>{p.children}</>
    },
  }
})

vi.mock('./objectDrag', async (orig) => {
  const real = await orig<typeof import('./objectDrag')>()
  return { ...real, dropObjectAt: vi.fn(() => true) }
})

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { useDefs } from '@/types/useDefinitions'
import { OBJECT_DRAG_MIME } from '@/whiteboard/dnd'
import { dropObjectAt } from './objectDrag'
import { PinnedSection } from './PinnedSection'
import { resetPinned } from './usePinned'

const mocked = vi.mocked(api)

const SERVER = typeDef({ id: 'server', name: 'Server', pluralName: 'Servers', revision: 'r1' })
const UI: UiState = {
  pinned: [
    { kind: 'query', id: 'open' },
    { kind: 'object', id: 'OBJ1' },
    { kind: 'collection', id: 'tooling' },
    { kind: 'type', id: 'server' },
  ],
  sections: [],
  allNotesLayout: 'list',
}

beforeEach(() => {
  dragEnd = undefined
  resetLinkIndex()
  resetPinned()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.ui.mockResolvedValue({ ui: UI, revision: 'u1' })
  mocked.patchUi.mockImplementation(async (patch) => ({ ui: { ...UI, ...patch }, revision: 'u2' }))
  useLinkIndex.setState({
    types: [SERVER],
    objects: [objectSummary({ path: 'Servers/Atlas.md', id: 'OBJ1', title: 'Atlas', type: 'server' })],
    loaded: true,
  })
  const collections = [collection({ id: 'tooling', name: 'Tooling', typeIds: ['server'] })]
  const queries = [query({ id: 'open', name: 'Open servers' })]
  mocked.collections.mockResolvedValue(collections)
  mocked.queries.mockResolvedValue(queries)
  useDefs.setState({ collections, queries, loaded: true })
})

const labels = () => screen.getAllByRole('listitem').map((li) => li.textContent)

describe('PinnedSection', () => {
  test('test pinned shows four kinds in saved order', async () => {
    render(<PinnedSection />)
    await screen.findByText('Atlas')
    expect(labels()).toEqual(['Open servers', 'Atlas', 'Tooling', 'Servers'])
  })

  test('test collection and query pins load with no other definitions consumer', async () => {
    useDefs.setState({ collections: [], queries: [], loaded: false })
    render(<PinnedSection />)
    await screen.findByText('Tooling')
    expect(labels()).toEqual(['Open servers', 'Atlas', 'Tooling', 'Servers'])
    expect(mocked.collections).toHaveBeenCalled()
    expect(mocked.queries).toHaveBeenCalled()
  })

  test('test No pinned content when empty', async () => {
    mocked.ui.mockResolvedValue({ ui: { ...UI, pinned: [] }, revision: 'u1' })
    render(<PinnedSection />)
    expect(await screen.findByText('No pinned content')).toBeInTheDocument()
  })

  test('test drag reorder calls patchUi with new order and baseRevision', async () => {
    render(<PinnedSection />)
    await screen.findByText('Atlas')
    act(() => dragEnd?.({ active: { id: 'query:open' }, over: { id: 'type:server' } }))
    await waitFor(() => expect(mocked.patchUi).toHaveBeenCalledTimes(1))
    expect(mocked.patchUi).toHaveBeenCalledWith(
      { pinned: [UI.pinned[1], UI.pinned[2], UI.pinned[3], UI.pinned[0]] },
      { baseRevision: 'u1' },
    )
    expect(labels()).toEqual(['Atlas', 'Tooling', 'Servers', 'Open servers'])
  })

  test('test pinned object drag carries the object path; reordering still works', async () => {
    render(<PinnedSection />)
    const atlas = (await screen.findByText('Atlas')).closest('button')!
    // A native drag of an object pin carries its path and a wikilink.
    expect(atlas).toHaveAttribute('draggable', 'true')
    const data: Record<string, string> = {}
    fireEvent.dragStart(atlas, { dataTransfer: { setData: (k: string, v: string) => (data[k] = v), effectAllowed: '' } })
    expect(data).toEqual({ [OBJECT_DRAG_MIME]: 'Servers/Atlas.md', 'text/plain': '[[Atlas]]' })
    // Other kinds are not native-draggable.
    expect(screen.getByText('Tooling').closest('button')).not.toHaveAttribute('draggable')

    const list = atlas.closest('ul')!
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 200, top: 0, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    // Released inside the list: an ordinary reorder.
    act(() =>
      dragEnd?.({
        active: { id: 'object:OBJ1' },
        over: { id: 'type:server' },
        activatorEvent: { clientX: 20, clientY: 40 },
        delta: { x: 0, y: 100 },
      }),
    )
    await waitFor(() => expect(mocked.patchUi).toHaveBeenCalledTimes(1))
    expect(dropObjectAt).not.toHaveBeenCalled()
    // Released outside the list (over a board): no reorder; the object is dropped there.
    act(() =>
      dragEnd?.({
        active: { id: 'object:OBJ1' },
        over: { id: 'type:server' },
        activatorEvent: { clientX: 20, clientY: 40 },
        delta: { x: 500, y: 10 },
      }),
    )
    expect(dropObjectAt).toHaveBeenCalledWith('Servers/Atlas.md', 'Atlas', 520, 50)
    expect(mocked.patchUi).toHaveBeenCalledTimes(1)
  })

  test('test patchUi 409 refetches and reapplies the reorder once', async () => {
    const fresh: UiState = { ...UI, pinned: [...UI.pinned, { kind: 'collection', id: 'tooling-2' }] }
    mocked.patchUi.mockRejectedValueOnce(new ConflictError('u9'))
    mocked.ui.mockResolvedValueOnce({ ui: UI, revision: 'u1' }).mockResolvedValueOnce({ ui: fresh, revision: 'u9' })
    render(<PinnedSection />)
    await screen.findByText('Atlas')
    act(() => dragEnd?.({ active: { id: 'query:open' }, over: { id: 'type:server' } }))
    await waitFor(() => expect(mocked.patchUi).toHaveBeenCalledTimes(2))
    expect(mocked.patchUi).toHaveBeenLastCalledWith(
      { pinned: [fresh.pinned[1], fresh.pinned[2], fresh.pinned[3], fresh.pinned[0], fresh.pinned[4]] },
      { baseRevision: 'u9' },
    )
  })

  test('test dangling pin dimmed with unpin only', async () => {
    mocked.ui.mockResolvedValue({ ui: { ...UI, pinned: [{ kind: 'collection', id: 'gone' }] }, revision: 'u1' })
    const user = userEvent.setup()
    render(<PinnedSection />)
    const item = await screen.findByText('Not found')
    expect(item.closest('li')).toHaveAttribute('data-missing')
    fireEvent.contextMenu(item)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(1)
    await user.click(within(menu).getByRole('menuitem', { name: 'Unpin from space' }))
    await waitFor(() => expect(mocked.patchUi).toHaveBeenCalledWith({ pinned: [] }, { baseRevision: 'u1' }))
  })

  test('test an item opens its target and a context menu unpins it', async () => {
    const onOpenTarget = vi.fn()
    const user = userEvent.setup()
    render(<PinnedSection onOpenTarget={onOpenTarget} />)
    await user.click(await screen.findByText('Atlas'))
    expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'object', path: 'Servers/Atlas.md' }, { newTab: false })
    await user.click(screen.getByText('Tooling'))
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'collection', id: 'tooling' }, { newTab: false })
    fireEvent.contextMenu(screen.getByText('Servers'))
    await user.click(await screen.findByRole('menuitem', { name: 'Unpin from space' }))
    await waitFor(() =>
      expect(mocked.patchUi).toHaveBeenCalledWith({ pinned: UI.pinned.slice(0, 3) }, { baseRevision: 'u1' }),
    )
  })
})
