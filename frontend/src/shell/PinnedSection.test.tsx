import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { UiState } from '@/api/types'
import { collection, objectSummary, query, typeDef } from '@/test/mockApi'

let dragEnd: ((e: { active: { id: string }; over: { id: string } | null }) => void) | undefined
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

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { useDefs } from '@/types/useDefinitions'
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
  useDefs.setState({
    collections: [collection({ id: 'tooling', name: 'Tooling', typeIds: ['server'] })],
    queries: [query({ id: 'open', name: 'Open servers' })],
    loaded: true,
  })
})

const labels = () => screen.getAllByRole('listitem').map((li) => li.textContent)

describe('PinnedSection', () => {
  test('test pinned shows four kinds in saved order', async () => {
    render(<PinnedSection />)
    await screen.findByText('Atlas')
    expect(labels()).toEqual(['Open servers', 'Atlas', 'Tooling', 'Servers'])
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
