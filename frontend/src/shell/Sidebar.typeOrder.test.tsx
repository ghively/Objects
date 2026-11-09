// Polish item 8: the Object Types header `...` menu (Sort manually | Sort alphabetically) and drag
// reordering of the types in manual mode, saved to `ui.objectsSectionSortOption` and
// `ui.workspace.objects.ids`.
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DragEndEvent } from '@dnd-kit/core'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { UiState } from '@/api/types'
import { typeDef } from '@/test/mockApi'

let typesDragEnd: ((e: DragEndEvent) => void) | undefined
vi.mock('@dnd-kit/core', async (orig) => {
  const real = await orig<typeof import('@dnd-kit/core')>()
  return {
    ...real,
    DndContext: (p: { id?: string; onDragEnd?: (e: DragEndEvent) => void } & Record<string, unknown>) => {
      if (p.id === 'object-types-order') typesDragEnd = p.onDragEnd
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
import { orderTypeEntries, SORT_ALPHABETICALLY, SORT_MANUALLY, TYPES_MENU_LABEL } from './typeOrder'
import { resetPinned } from './usePinned'

const mocked = vi.mocked(api)
const A = typeDef({ id: 'a', name: 'Apple', pluralName: 'Apples', revision: 'r1' })
const B = typeDef({ id: 'b', name: 'Banana', pluralName: 'Bananas', revision: 'r1' })
const Z = typeDef({ id: 'z', name: 'Zebra', pluralName: 'Zebras', revision: 'r1' })

let stored: UiState
let rev = 0

/** The type list's rows (types and Queries) as rendered. */
const rows = () => {
  const list = screen.getByRole('region', { name: 'Object Types' })
  return [...list.querySelectorAll('[data-type-entry]')].map((el) => el.getAttribute('data-type-entry'))
}

beforeEach(() => {
  resetLinkIndex()
  resetPinned()
  rev = 0
  typesDragEnd = undefined
  stored = { pinned: [], sections: [], allNotesLayout: 'list' }
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
  useLinkIndex.setState({ types: [A, B, Z], objects: [], loaded: true })
  useDefs.setState({ collections: [], queries: [], loaded: true })
})

describe('orderTypeEntries', () => {
  const names = { a: 'Apples', b: 'Bananas', z: 'Zebras', queries: 'Queries' }
  test('alphabetical ignores the saved ids', () => {
    expect(orderTypeEntries(['z', 'a', 'queries', 'b'], names, 'alphabetical', ['z', 'a'])).toEqual(['a', 'b', 'queries', 'z'])
  })
  test('manual follows the ids; unknown ids drop, missing entries follow by name', () => {
    expect(orderTypeEntries(['z', 'a', 'queries', 'b'], names, 'manual', ['z', 'gone', 'a'])).toEqual(['z', 'a', 'b', 'queries'])
  })
  test('unset sorts alphabetically', () => {
    expect(orderTypeEntries(['z', 'a'], names, undefined, ['z', 'a'])).toEqual(['a', 'z'])
  })
})

describe('Object Types sort', () => {
  test('the header menu offers both sorts and checks the current one', async () => {
    const user = userEvent.setup()
    render(<Sidebar types={[Z, A, B]} />)
    await waitFor(() => expect(rows()).toEqual(['a', 'b', 'queries', 'z']))
    await user.click(screen.getByRole('button', { name: TYPES_MENU_LABEL }))
    const manual = await screen.findByRole('menuitemcheckbox', { name: SORT_MANUALLY })
    expect([SORT_MANUALLY, SORT_ALPHABETICALLY]).toEqual(['Sort manually', 'Sort alphabetically'])
    const alpha = screen.getByRole('menuitemcheckbox', { name: SORT_ALPHABETICALLY })
    expect(manual).toHaveAttribute('aria-checked', 'false')
    expect(alpha).toHaveAttribute('aria-checked', 'true')
  })

  test('Sort manually keeps the shown order and saves it', async () => {
    const user = userEvent.setup()
    render(<Sidebar types={[Z, A, B]} />)
    await waitFor(() => expect(rows()).toEqual(['a', 'b', 'queries', 'z']))
    await user.click(screen.getByRole('button', { name: TYPES_MENU_LABEL }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: SORT_MANUALLY }))
    await waitFor(() =>
      expect(mocked.patchUi).toHaveBeenCalledWith(
        { objectsSectionSortOption: 'manual', workspace: { objects: { ids: ['a', 'b', 'queries', 'z'] } } },
        { baseRevision: 'u0' },
      ),
    )
  })

  test('manual order renders and a drag saves the new order', async () => {
    stored.objectsSectionSortOption = 'manual'
    stored.workspace = { objects: { ids: ['z', 'queries', 'a'] } }
    render(<Sidebar types={[A, B, Z]} />)
    await waitFor(() => expect(rows()).toEqual(['z', 'queries', 'a', 'b']))
    expect(typesDragEnd).toBeDefined()
    act(() => typesDragEnd?.({ active: { id: 'b' }, over: { id: 'z' } } as unknown as DragEndEvent))
    await waitFor(() =>
      expect(mocked.patchUi).toHaveBeenCalledWith({ workspace: { objects: { ids: ['b', 'z', 'queries', 'a'] } } }, { baseRevision: 'u0' }),
    )
    expect(rows()).toEqual(['b', 'z', 'queries', 'a'])
  })

  test('alphabetical mode has no type drag; switching back keeps the saved ids', async () => {
    const user = userEvent.setup()
    stored.objectsSectionSortOption = 'manual'
    stored.workspace = { objects: { ids: ['z', 'queries', 'a', 'b'] } }
    render(<Sidebar types={[A, B, Z]} />)
    await waitFor(() => expect(rows()).toEqual(['z', 'queries', 'a', 'b']))
    await user.click(screen.getByRole('button', { name: TYPES_MENU_LABEL }))
    typesDragEnd = undefined
    await user.click(await screen.findByRole('menuitemcheckbox', { name: SORT_ALPHABETICALLY }))
    await waitFor(() => expect(mocked.patchUi).toHaveBeenCalledWith({ objectsSectionSortOption: 'alphabetical' }, { baseRevision: 'u0' }))
    await waitFor(() => expect(rows()).toEqual(['a', 'b', 'queries', 'z']))
    expect(typesDragEnd).toBeUndefined()
    expect(stored.workspace).toEqual({ objects: { ids: ['z', 'queries', 'a', 'b'] } })
  })
})
