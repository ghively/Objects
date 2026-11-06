// M9 Task 21: the sidebar's top-level blocks follow `ui.workspaceOrder` and are reordered by dragging.
import { act, render, screen, waitFor } from '@testing-library/react'
import type { ClientRect, DragEndEvent } from '@dnd-kit/core'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { UiState } from '@/api/types'
import { typeDef } from '@/test/mockApi'

// jsdom has no layout for a real drag: keep the real context, and catch the sidebar order's drop handler.
let dragEnd: ((e: DragEndEvent) => void) | undefined
vi.mock('@dnd-kit/core', async (orig) => {
  const real = await orig<typeof import('@dnd-kit/core')>()
  return {
    ...real,
    DndContext: (p: { id?: string; onDragEnd?: (e: DragEndEvent) => void } & Record<string, unknown>) => {
      if (p.id === 'workspace-order') dragEnd = p.onDragEnd
      return <real.DndContext {...(p as object)} />
    },
  }
})

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { useDefs } from '@/types/useDefinitions'
import { Sidebar } from './Sidebar'
import { workspaceBlocks, workspaceCollision } from './SidebarSections'
import { resetPinned } from './usePinned'

const mocked = vi.mocked(api)
const SERVER = typeDef({ id: 'server', name: 'Server', pluralName: 'Servers', revision: 'r1' })

let stored: UiState
let rev = 0

/** The order of the top-level blocks as rendered. */
const blocks = () => [...document.querySelectorAll('[data-workspace-block]')].map((el) => el.getAttribute('data-workspace-block'))

beforeEach(() => {
  resetLinkIndex()
  resetPinned()
  rev = 0
  stored = {
    pinned: [],
    sections: [
      { id: 'S1', name: 'In Progress', icon: null, items: [] },
      { id: 'S2', name: 'Later', icon: null, items: [] },
    ],
    allNotesLayout: 'list',
  }
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.ui.mockImplementation(async () => ({ ui: stored, revision: `u${rev}` }))
  mocked.patchUi.mockImplementation(async (patch) => {
    stored = { ...stored, ...patch }
    rev += 1
    return { ui: stored, revision: `u${rev}` }
  })
  mocked.collections.mockResolvedValue([])
  mocked.queries.mockResolvedValue([])
  useLinkIndex.setState({ types: [SERVER], objects: [], loaded: true })
  useDefs.setState({ collections: [], queries: [], loaded: true })
})

describe('Sidebar workspaceOrder', () => {
  test('test sections render in workspaceOrder', async () => {
    stored.workspaceOrder = ['objects', 'S2', 'pinned', 'S1']
    render(<Sidebar types={[SERVER]} />)
    await waitFor(() => expect(blocks()).toEqual(['objects', 'S2', 'pinned', 'S1']))
    // The type list really sits first: "Object Types" comes before the sections' headings (M17's
    // Agents section sits above the main navigation, outside the workspace blocks).
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent).filter((h) => h !== 'Agents')
    expect(headings.slice(0, 4)).toEqual(['Object Types', 'Later', 'Pinned', 'In Progress'])
  })

  test('without workspaceOrder the default order is kept', async () => {
    render(<Sidebar types={[SERVER]} />)
    await waitFor(() => expect(blocks()).toEqual(['S1', 'S2', 'pinned', 'objects']))
  })

  test('test unknown and missing ids', () => {
    // Unknown ids are dropped; missing ones follow in their default place; duplicates count once.
    expect(workspaceBlocks(['gone', 'objects', 'S2', 'objects'], ['S1', 'S2'])).toEqual(['objects', 'S2', 'S1', 'pinned'])
    expect(workspaceBlocks(undefined, ['S1'])).toEqual(['S1', 'pinned', 'objects'])
    expect(workspaceBlocks('bad', [])).toEqual(['pinned', 'objects'])
  })

  test('"Add Section" sits under the object types, after every block, not under Pinned', async () => {
    render(<Sidebar types={[SERVER]} />)
    await waitFor(() => expect(blocks()).toEqual(['S1', 'S2', 'pinned', 'objects']))
    const add = screen.getByRole('button', { name: 'Add Section' })
    expect(add.closest('[data-workspace-block]')).toBeNull()
    const types = document.querySelector('[data-workspace-block="objects"]') as HTMLElement
    expect(types.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('a section added after the order was saved appears above Pinned', () => {
    expect(workspaceBlocks(['S1', 'pinned', 'objects'], ['S1', 'S2'])).toEqual(['S1', 'S2', 'pinned', 'objects'])
    expect(workspaceBlocks(['objects', 'pinned', 'S1'], ['S1', 'S2', 'S3'])).toEqual(['objects', 'S2', 'S3', 'pinned', 'S1'])
  })

  test('test drag reorders and patches ui', async () => {
    render(<Sidebar types={[SERVER]} />)
    await waitFor(() => expect(blocks()).toEqual(['S1', 'S2', 'pinned', 'objects']))
    // Every block has a drag handle.
    expect(screen.getByRole('button', { name: 'Reorder Object Types' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reorder Pinned' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reorder In Progress' })).toBeInTheDocument()
    // Drop "Object Types" on Pinned.
    act(() => dragEnd?.({ active: { id: 'objects' }, over: { id: 'pinned' } } as unknown as DragEndEvent))
    await waitFor(() => expect(mocked.patchUi).toHaveBeenCalledWith({ workspaceOrder: ['S1', 'S2', 'objects', 'pinned'] }, { baseRevision: 'u0' }))
    expect(blocks()).toEqual(['S1', 'S2', 'objects', 'pinned'])
    expect(stored.workspaceOrder).toEqual(['S1', 'S2', 'objects', 'pinned'])
  })

  test('the drag handle sits inside the block, not in the clipped gutter', async () => {
    render(<Sidebar types={[SERVER]} />)
    const handle = await screen.findByRole('button', { name: 'Reorder Object Types' })
    expect(handle.className).not.toMatch(/(^|\s)-left-/)
    expect(handle.className).toMatch(/(^|\s)left-0(\s|$)/)
  })

  test('collisions resolve to the neighbouring block, even for the tall object types', () => {
    const rect = (top: number, height: number): ClientRect => ({ top, left: 10, width: 300, height, bottom: top + height, right: 310 })
    // Pinned is short; Object Types below it is tall.
    const rects = new Map<string, ClientRect>([
      ['S1', rect(0, 60)],
      ['pinned', rect(60, 80)],
      ['objects', rect(140, 600)],
    ])
    const args = (collisionRect: ClientRect, pointerCoordinates: { x: number; y: number } | null = null) =>
      ({
        active: { id: 'objects' },
        collisionRect,
        droppableRects: rects,
        droppableContainers: [...rects.keys()].map((id) => ({ id })),
        pointerCoordinates,
      }) as unknown as Parameters<typeof workspaceCollision>[0]
    // Keyboard: lifted but not moved, it stays over itself (a drop changes nothing).
    expect(workspaceCollision(args(rect(140, 600)))[0].id).toBe('objects')
    // Keyboard ArrowUp moves its top onto Pinned's: Pinned is the target.
    expect(workspaceCollision(args(rect(60, 600)))[0].id).toBe('pinned')
    // Pointer: the block under the pointer.
    expect(workspaceCollision(args(rect(40, 600), { x: 100, y: 90 }))[0].id).toBe('pinned')
  })
})
