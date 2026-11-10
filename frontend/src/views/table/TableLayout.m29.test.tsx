// M29: synced facts in views. A synced cell is read-only (and muted once stale), a Kanban drag
// between Patch state columns sends nothing, and a `synced` event reloads that type's rows only.
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, Row, TypeDef, ViewState } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

let dragEnd: ((e: unknown) => void) | undefined
vi.mock('@dnd-kit/core', async (orig) => {
  const real = await orig<typeof import('@dnd-kit/core')>()
  return {
    ...real,
    DndContext: (p: { onDragEnd?: (e: unknown) => void } & Record<string, unknown>) => {
      dragEnd = p.onDragEnd
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
import { SYNCED_TEXT } from '@/properties/synced'
import { DataView } from '../DataView'
import { emptyFilterGroup } from '../model'
import { useRows } from '../useRows'

const mocked = vi.mocked(api)
const NOW = new Date('2026-11-09T10:00:00.000Z')
const SOURCE = { source: 'Inventory script', staleAfterDays: 7 }

const HOST: TypeDef = typeDef({
  id: 'host',
  name: 'Host',
  pluralName: 'Hosts',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
    propertyDef({ id: 'fqdn', type: 'text', name: 'FQDN' }),
    propertyDef({ id: 'diskFree', type: 'number', name: 'Disk free', synced: SOURCE }),
    propertyDef({
      id: 'patchState',
      type: 'label',
      name: 'Patch state',
      synced: SOURCE,
      options: {
        isArray: false,
        set: [
          { id: 'o1', text: 'Current', color: 'green', icon: null },
          { id: 'o2', text: 'Failed', color: 'red', icon: null },
        ],
      },
    }),
  ],
})
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages' })

const host = (title: string, syncedAt: string | null, values: Row['values']): Row =>
  row({ summary: objectSummary({ path: `Hosts/${title}.md`, title, type: 'host' }), values, syncedAt, version: `v-${title}` })
const APP01 = host('APP01', '2026-11-09T09:55:00.000Z', { fqdn: 'app01.example.test', diskFree: 40, patchState: ['Current'] })
const SRV02 = host('SRV-02', '2026-11-01T09:00:00.000Z', { fqdn: 'srv-02.example.test', diskFree: 12, patchState: ['Failed'] })
const ROWS = [APP01, SRV02]

const view = (patch: Partial<ViewState> = {}): ViewState => ({
  viewDefinition: { dataViewLayout: 'table', tableConfigs: { host: { wrapAllContent: false, properties: [] } } },
  filterGroup: emptyFilterGroup(),
  sorts: [],
  groupBy: null,
  ...patch,
})

function Harness({ init, rows = ROWS }: { init: ViewState; rows?: Row[] }) {
  const [state, setState] = useState(init)
  return <DataView rows={rows} types={[HOST]} scope={{ typeIds: ['host'] }} state={state} onState={setState} layouts={['table', 'kanban']} patchRow={vi.fn()} />
}

const cell = (container: HTMLElement, path: string, col: string) =>
  container.querySelector(`[role="row"][data-path="${path}"] [role="cell"][data-col="${col}"]`) as HTMLElement

let listeners: ((e: ChangeEvent) => void)[] = []
const fire = (e: ChangeEvent) => {
  for (const l of listeners) l(e)
}

beforeEach(() => {
  vi.clearAllMocks()
  resetLinkIndex()
  useLinkIndex.setState({ types: [HOST, PAGE], loaded: true })
  dragEnd = undefined
  listeners = []
  mocked.onChange.mockImplementation((cb) => {
    listeners.push(cb)
    return () => {
      listeners = listeners.filter((l) => l !== cb)
    }
  })
})
afterEach(() => vi.useRealTimers())

describe('TableLayout: M29 synced facts', () => {
  test('synced cells are read-only and a drag never writes', async () => {
    const { container, unmount } = render(<Harness init={view()} />)
    const disk = cell(container, APP01.summary.path, 'diskFree').querySelector('input') as HTMLInputElement
    expect(disk).toHaveAttribute('readonly')
    const patch = cell(container, APP01.summary.path, 'patchState')
    expect(within(patch).getByText('Current')).toBeInTheDocument()
    expect(within(patch).queryByRole('button', { name: 'Edit Patch state' })).not.toBeInTheDocument()
    // FQDN, not synced, stays editable.
    expect(cell(container, APP01.summary.path, 'fqdn').querySelector('input')).not.toHaveAttribute('readonly')
    unmount()

    // A Kanban grouped by Patch state: dragging APP01 from Current to Failed sends nothing.
    const kanban = view({
      viewDefinition: { dataViewLayout: 'kanban' },
      groupBy: { groups: [{ propertyId: 'patchState', option: 'default', typeId: 'host' }] },
    })
    render(<Harness init={kanban} />)
    const columns = screen.getAllByTestId('kanban-column')
    const failed = columns.find((c) => within(c).queryByText('Failed') && within(c).queryByText('SRV-02'))
    expect(failed).toBeTruthy()
    // The cards don't start a drag (M29 review #7).
    for (const card of screen.getAllByTestId('kanban-card')) expect(card).toHaveAttribute('aria-disabled', 'true')
    act(() => dragEnd?.({ active: { id: APP01.summary.path }, over: { id: `col:${failed!.getAttribute('data-group')}` } }))
    await waitFor(() => expect(screen.getByText(SYNCED_TEXT.readOnly('Patch state', 'Inventory script'))).toBeInTheDocument())
    expect(mocked.updateProperties).not.toHaveBeenCalled()
  })

  test('a filter or grouping on a synced property creates without it (M29 review #2)', async () => {
    const user = userEvent.setup()
    // Grouped by Patch state (synced), filtered on Disk free (synced) and FQDN (not synced).
    const kanban = view({
      viewDefinition: { dataViewLayout: 'kanban' },
      groupBy: { groups: [{ propertyId: 'patchState', option: 'default', typeId: 'host' }] },
      filterGroup: {
        type: 'filterGroup',
        operator: 'and',
        elements: [
          { type: 'filter', propertyId: 'diskFree', option: 'equal', referenceValue: 40 },
          { type: 'filter', propertyId: 'fqdn', option: 'is', referenceValue: 'app01.example.test' },
        ],
      },
    })
    render(<Harness init={kanban} rows={[APP01]} />)
    const current = screen.getAllByTestId('kanban-column').find((c) => within(c).queryByText('Current'))!
    await user.click(within(current).getByRole('button', { name: /Add to Current/ }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('host', { values: { fqdn: 'app01.example.test' } }))
  })

  test("a stale row's synced cell is muted", () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const { container } = render(<Harness init={view()} />)
    // SRV-02 was refreshed 8 days ago (stale after 7); APP01 five minutes ago.
    expect(cell(container, SRV02.summary.path, 'diskFree')).toHaveAttribute('data-stale')
    expect(cell(container, SRV02.summary.path, 'patchState')).toHaveAttribute('data-stale')
    expect(cell(container, SRV02.summary.path, 'fqdn')).not.toHaveAttribute('data-stale')
    expect(cell(container, APP01.summary.path, 'diskFree')).not.toHaveAttribute('data-stale')
  })

  test('a synced event for host reloads host rows only', async () => {
    vi.useFakeTimers()
    const page = row({ summary: objectSummary({ path: 'Pages/Notes.md', title: 'Notes', type: 'page' }) })
    const all = [...ROWS, page]
    mocked.rows.mockImplementation(async (scope) => {
      const paths = (scope as { paths?: string[] }).paths
      return paths ? all.filter((r) => paths.includes(r.summary.path)) : all
    })
    const settle = () => act(async () => void (await Promise.resolve()))
    const tick = () =>
      act(async () => {
        vi.advanceTimersByTime(150)
        await Promise.resolve()
      })
    for (const backlinks of [false, true]) {
      listeners = []
      const hook = renderHook(() => useRows({ typeIds: ['host', 'page'] }, { backlinks }))
      await settle()
      expect(hook.result.current.rows).toHaveLength(3)
      mocked.rows.mockClear()

      // Another type's sync: none of these rows is of it, nothing is fetched.
      act(() => fire({ kind: 'synced', path: 'network', version: 'r1' }))
      await tick()
      expect(mocked.rows).not.toHaveBeenCalled()

      // Host's sync: only the Host rows are fetched again, in one call.
      act(() => fire({ kind: 'synced', path: 'host', version: 'r2' }))
      await tick()
      expect(mocked.rows).toHaveBeenCalledTimes(1)
      const call = mocked.rows.mock.calls[0][0] as { paths?: string[] }
      expect([...(call.paths ?? [])].sort()).toEqual([APP01.summary.path, SRV02.summary.path])
      expect(hook.result.current.rows).toHaveLength(3)
      hook.unmount()
    }
  })
})
