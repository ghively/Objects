import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, DataViewDefinition, Row, ViewState } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek } from '@/nav/tabs'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { cardProperties } from './cards/cardConfig'
import { DataView } from './DataView'
import { emptyFilterGroup } from './model'
import { useRows } from './useRows'
import { useViewState } from './useViewState'

const mocked = vi.mocked(api)

const PAGE = typeDef({
  id: 'page',
  name: 'Page',
  pluralName: 'Pages',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
    propertyDef({
      id: 'status',
      type: 'label',
      name: 'Status',
      options: {
        isArray: false,
        set: [
          { id: 'o1', text: 'Todo', color: 'gray', icon: null },
          { id: 'o2', text: 'Done', color: 'green', icon: null },
        ],
      },
    }),
  ],
})
const TASK = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks' })

const mk = (path: string, extra: Partial<Row['summary']> = {}, values: Row['values'] = {}, type = 'page') =>
  row({ summary: objectSummary({ path, type, ...extra }), values })

const ROWS = [
  mk('Pages/Alpha.md', { createdAt: '2026-10-01T00:00:00Z' }, { status: ['Todo'] }),
  mk('Pages/Alphabet.md', { createdAt: '2026-10-03T00:00:00Z' }, { status: ['Done'] }),
  mk('Pages/Beta.md', { createdAt: '2026-10-02T00:00:00Z' }, { status: ['Todo'] }),
  mk('Pages/Gamma.md', { createdAt: '2026-10-04T00:00:00Z' }, {}),
]

const base = (): ViewState => ({
  viewDefinition: { dataViewLayout: 'list' },
  filterGroup: emptyFilterGroup(),
  sorts: [],
  groupBy: null,
})

function Harness({
  rows = ROWS,
  init = base(),
  onState,
  onCreate,
}: {
  rows?: Row[]
  init?: ViewState
  onState?: (s: ViewState) => void
  onCreate?: (v: Record<string, unknown>, t: string) => void
}) {
  const [state, setState] = useState(init)
  return (
    <DataView
      rows={rows}
      types={[PAGE, TASK]}
      scope={{ typeIds: ['page'] }}
      state={state}
      onState={(s) => {
        setState(s)
        onState?.(s)
      }}
      layouts={['list', 'grid', 'wall']}
      allowCreate
      onCreate={onCreate}
    />
  )
}

const titles = () => screen.getAllByRole('listitem').map((li) => li.textContent)

beforeEach(() => {
  resetLinkIndex()
  usePeek.getState().close()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
})

describe('DataView', () => {
  test('test toolbar shows count and tooltips', () => {
    render(<Harness />)
    expect(screen.getByTitle('4 entries')).toHaveTextContent('4')
    for (const name of ['Filter', 'Sort', 'Group by', 'Layout', 'Customize view']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  test('a single entry says "1 entry"', () => {
    render(<Harness rows={[ROWS[0]]} />)
    expect(screen.getByTitle('1 entry')).toBeInTheDocument()
  })

  test('test filter popover adds filter and narrows rows', async () => {
    const user = userEvent.setup()
    const onState = vi.fn()
    render(<Harness onState={onState} />)
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(await screen.findByRole('button', { name: '+ Filter' }))
    await user.click(screen.getByRole('button', { name: 'Operator' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'includes' }))
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'alp')
    // No sort: the createdAt-newest-first fallback.
    await waitFor(() => expect(titles()).toEqual(['Alphabet', 'Alpha']))
    const last = onState.mock.calls.at(-1)![0] as ViewState
    expect(last.filterGroup.elements[0]).toMatchObject({
      type: 'filter',
      propertyId: 'title',
      option: 'contains',
      referenceValue: 'alp',
    })
    expect(screen.getByTitle('2 entries')).toBeInTheDocument()
  })

  test('test sort Newest first reorders', async () => {
    const user = userEvent.setup()
    const onState = vi.fn()
    render(<Harness onState={onState} />)
    await user.click(screen.getByRole('button', { name: 'Sort' }))
    await user.click(await screen.findByRole('button', { name: 'Add sort' }))
    await user.click(screen.getByRole('button', { name: 'Sort property' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Created at' }))
    await user.click(screen.getByRole('button', { name: 'Sort option' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Newest first' }))
    expect(titles()).toEqual(['Gamma', 'Alphabet', 'Beta', 'Alpha'])
    expect((onState.mock.calls.at(-1)![0] as ViewState).sorts).toEqual([{ propertyId: 'createdAt', option: 'descending' }])
  })

  test('test group by label renders headers with counts and collapse persists isClosed', async () => {
    const user = userEvent.setup()
    const onState = vi.fn()
    const init = { ...base(), groupBy: { groups: [{ propertyId: 'status', option: 'default' }] } }
    render(<Harness init={init} onState={onState} />)
    const headers = screen.getAllByTestId('group-header')
    expect(headers.map((h) => h.textContent)).toEqual(['Todo2', 'Done1', 'Other1'])
    await user.click(headers[0])
    const last = onState.mock.calls.at(-1)![0] as ViewState
    expect(last.viewDefinition.groupByConfig?.groups).toContainEqual({ id: 'o1', isHidden: false, isClosed: true })
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.getByText('Alphabet')).toBeInTheDocument()
  })

  test('a tags group is keyed by the tag object, not a same-titled page (audit 2026-11-01)', () => {
    useLinkIndex.setState({
      objects: [
        objectSummary({ path: 'Tags/Work.md', type: 'tag', title: 'Work', id: 'TAGID' }),
        objectSummary({ path: 'Pages/Work.md', type: 'page', title: 'Work', id: 'PAGEID' }),
      ],
      loaded: true,
    })
    const rows = [mk('Pages/Alpha.md', { tags: ['Work'] }), mk('Pages/Beta.md', { tags: ['Home'] })]
    const init: ViewState = {
      ...base(),
      groupBy: { groups: [{ propertyId: 'tags', option: 'default' }] },
      viewDefinition: { dataViewLayout: 'list', groupByConfig: { groups: [{ id: 'TAGID', isHidden: true, isClosed: false }] } },
    }
    render(<Harness rows={rows} init={init} />)
    // The hidden "Work" group stays hidden; only "Home" shows.
    expect(screen.getAllByTestId('group-header').map((h) => h.textContent)).toEqual(['Home1'])
  })

  test('test load more pages by 50', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 120 }, (_, i) => mk(`Pages/P${String(i).padStart(3, '0')}.md`))
    render(<Harness rows={many} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(50)
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(100)
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(120)
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  test('test empty state Create calls onCreate', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(<Harness rows={[]} onCreate={onCreate} />)
    expect(screen.getByText("Nothing to show yet.")).toBeInTheDocument()
    expect(screen.getByText('Create a note to see it here.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create Note' }))
    expect(onCreate).toHaveBeenCalledWith({}, 'page')
  })

  test('shows "Loading results…" while loading', () => {
    render(<DataView rows={[]} types={[PAGE]} loading state={base()} onState={() => undefined} layouts={['list']} />)
    expect(screen.getByText('Loading results…')).toBeInTheDocument()
  })

  test('test click peeks with view order as pager list', async () => {
    const user = userEvent.setup()
    const init = { ...base(), sorts: [{ propertyId: 'title', option: 'descending' as const }] }
    render(<Harness init={init} />)
    await user.click(screen.getByText('Beta'))
    expect(usePeek.getState().path).toBe('Pages/Beta.md')
    expect(usePeek.getState().list).toEqual(['Pages/Gamma.md', 'Pages/Beta.md', 'Pages/Alphabet.md', 'Pages/Alpha.md'])
  })

  test('Show details toggles the view summary', async () => {
    const user = userEvent.setup()
    const init = { ...base(), sorts: [{ propertyId: 'title', option: 'ascending' as const }] }
    render(<Harness init={init} />)
    expect(screen.queryByTestId('view-summary')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Customize view' }))
    await user.click(await screen.findByRole('button', { name: 'Show details' }))
    expect(screen.getByTestId('view-summary')).toHaveTextContent('Sorted by Title')
  })

  test('pausedHint dims Filter and Sort and shows the hint', () => {
    render(
      <DataView
        rows={ROWS}
        types={[PAGE]}
        state={base()}
        onState={() => undefined}
        layouts={['list']}
        pausedHint="Sorting and property filters are off during a search."
      />,
    )
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveAttribute('title', 'Sorting and property filters are off during a search.')
    expect(screen.getByTestId('view-summary')).toHaveTextContent('off during a search')
  })

  test('the layout picker offers only the given layouts', async () => {
    const user = userEvent.setup()
    const onState = vi.fn()
    render(<Harness onState={onState} />)
    await user.click(screen.getByRole('button', { name: 'Layout' }))
    const menu = await screen.findAllByRole('menuitemcheckbox')
    expect(menu.map((m) => m.textContent)).toEqual(['List', 'Gallery', 'Wall'])
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Wall' }))
    expect((onState.mock.calls.at(-1)![0] as ViewState).viewDefinition.dataViewLayout).toBe('wall')
  })

  test('Customize groups lists visible and hidden groups', async () => {
    const user = userEvent.setup()
    const onState = vi.fn()
    const init = { ...base(), groupBy: { groups: [{ propertyId: 'status', option: 'default' }] } }
    render(<Harness init={init} onState={onState} />)
    await user.click(screen.getByRole('button', { name: 'Customize view' }))
    await user.click(await screen.findByRole('button', { name: 'Groups' }))
    expect(screen.getByText('Visible groups')).toBeInTheDocument()
    expect(screen.getByText('Hidden groups')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hide all groups' }))
    const cfg = (onState.mock.calls.at(-1)![0] as ViewState).viewDefinition.groupByConfig
    expect(cfg?.groups.every((g) => g.isHidden)).toBe(true)
    expect(within(document.body).getByText('Hide empty groups')).toBeInTheDocument()
  })
})

describe('preview paging (audit 2026-11-01 P2)', () => {
  // A "server" of 120 pages with a 1,500-character preview each; rows without previews are small.
  const SERVER = Array.from({ length: 120 }, (_, i) =>
    row({ summary: objectSummary({ path: `Pages/P${String(i).padStart(3, '0')}.md`, type: 'page', title: `P${i}` }), preview: `preview ${i} `.padEnd(1500, 'x') }),
  )
  const answer = async (scope?: Parameters<typeof api.rows>[0]) => {
    const wanted = scope?.paths ? SERVER.filter((r) => scope.paths?.includes(r.summary.path)) : SERVER
    return scope?.preview === false ? wanted.map((r) => ({ ...r, preview: '' })) : wanted
  }
  const calls = () => mocked.rows.mock.calls.map(([scope]) => scope)
  function Owner({ layout, def }: { layout: 'list' | 'grid' | 'kanban'; def?: Partial<DataViewDefinition> }) {
    const { rows, loading, patchRow } = useRows({ typeIds: ['page'] })
    const [state, setState] = useState<ViewState>({ ...base(), viewDefinition: { dataViewLayout: layout, ...def } })
    return (
      <DataView rows={rows} loading={loading} types={[PAGE]} scope={{ typeIds: ['page'] }} state={state} onState={setState} layouts={['list', 'grid', 'kanban']} patchRow={patchRow} />
    )
  }

  beforeEach(() => {
    mocked.rows.mockReset()
    mocked.rows.mockImplementation(answer)
    mocked.onChange.mockReturnValue(() => undefined)
  })

  test('rows load without previews; a card layout fetches the visible page, then the next page on Load more', async () => {
    const user = userEvent.setup()
    render(<Owner layout="grid" />)
    await waitFor(() => expect(screen.getAllByTestId('card-preview')).toHaveLength(50))
    expect(calls()[0]).toEqual({ typeIds: ['page'], preview: false })
    expect(calls()[1]).toEqual({ paths: SERVER.slice(0, 50).map((r) => r.summary.path), preview: true })
    expect(screen.getAllByTestId('card-preview')[0].textContent?.startsWith('preview 0 ')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(screen.getAllByTestId('card-preview')).toHaveLength(100))
    expect(calls()).toHaveLength(3)
    expect(calls()[2]).toEqual({ paths: SERVER.slice(50, 100).map((r) => r.summary.path), preview: true })
    // What the page cost: the full rows once, previews for the 100 on screen; before, every preview came with the rows.
    const bytes = (rows: Row[]) => JSON.stringify(rows).length
    const before = bytes(SERVER)
    const after = bytes(SERVER.map((r) => ({ ...r, preview: '' }))) + bytes(SERVER.slice(0, 50)) + bytes(SERVER.slice(50, 100))
    console.log(`P2 bytes: rows with previews ${before}; rows without + 2 preview pages ${after}; first paint ${bytes(SERVER.map((r) => ({ ...r, preview: '' }))) + bytes(SERVER.slice(0, 50))}`)
    expect(after).toBeLessThan(before)
  })

  // Review fix 2026-11-01 #6: the kanban pages on its own, and asked for previews even when its cards show none.
  test('a kanban whose cards show no preview fetches none; one whose cards do fetches its cards', async () => {
    const noPreview: Partial<DataViewDefinition> = {
      smallCardViewConfigs: { page: { entityViewType: 'smallCard', properties: cardProperties(PAGE).filter((p) => p.propertyId !== 'computed_preview') } },
    }
    const { unmount } = render(<Owner layout="kanban" def={noPreview} />)
    await waitFor(() => expect(screen.getAllByTestId('kanban-card').length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 50))
    expect(calls()).toEqual([{ typeIds: ['page'], preview: false }])
    unmount()
    mocked.rows.mockClear()
    render(<Owner layout="kanban" />)
    await waitFor(() => expect(screen.getAllByTestId('card-preview').length).toBeGreaterThan(0))
    expect(calls()[1]?.preview).toBe(true)
  })

  test('the list never fetches previews', async () => {
    render(<Owner layout="list" />)
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(50))
    await new Promise((r) => setTimeout(r, 50))
    expect(calls()).toEqual([{ typeIds: ['page'], preview: false }])
  })
})

describe('useRows', () => {
  let emit: (e: ChangeEvent) => void
  const A = mk('Pages/A.md')
  const B = mk('Pages/B.md')
  const C = mk('Pages/C.md')

  beforeEach(() => {
    mocked.onChange.mockImplementation((cb) => {
      emit = cb
      return () => undefined
    })
    mocked.rows.mockReset()
    mocked.rows.mockResolvedValue([A, B, C])
  })

  const ev = (kind: ChangeEvent['kind'], path: string): ChangeEvent => ({ kind, path, version: null })

  test('test useRows patches only the changed path', async () => {
    const { result } = renderHook(() => useRows({ typeIds: ['page'] }))
    await waitFor(() => expect(result.current.rows).toHaveLength(3))
    const fresh = mk('Pages/A.md', { title: 'Renamed in place' })
    mocked.rows.mockClear()
    mocked.rows.mockResolvedValue([fresh])
    act(() => emit(ev('changed', 'Pages/A.md')))
    await waitFor(() => expect(result.current.rows[0].summary.title).toBe('Renamed in place'))
    expect(mocked.rows).toHaveBeenCalledTimes(1)
    expect(mocked.rows).toHaveBeenCalledWith({ typeIds: ['page'], paths: ['Pages/A.md'], preview: false })
    expect(result.current.rows[1]).toBe(B)
    expect(result.current.rows[2]).toBe(C)
  })

  test('test useRows coalesces changed paths into one rows call', async () => {
    const { result } = renderHook(() => useRows({ typeIds: ['page'] }))
    await waitFor(() => expect(result.current.rows).toHaveLength(3))
    mocked.rows.mockClear()
    mocked.rows.mockResolvedValue([A, B, C])
    act(() => {
      emit(ev('changed', 'Pages/A.md'))
      emit(ev('changed', 'Pages/B.md'))
      emit(ev('changed', 'Pages/C.md'))
    })
    await waitFor(() => expect(mocked.rows).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 250))
    expect(mocked.rows).toHaveBeenCalledTimes(1)
    expect(mocked.rows).toHaveBeenCalledWith({ typeIds: ['page'], paths: ['Pages/A.md', 'Pages/B.md', 'Pages/C.md'], preview: false })
  })

  test('a requested path the scoped call no longer returns is dropped', async () => {
    const { result } = renderHook(() => useRows({ typeIds: ['page'] }))
    await waitFor(() => expect(result.current.rows).toHaveLength(3))
    mocked.rows.mockResolvedValue([])
    act(() => emit(ev('changed', 'Pages/B.md')))
    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    expect(result.current.rows.map((r) => r.summary.path)).toEqual(['Pages/A.md', 'Pages/C.md'])
  })

  test('test useRows reloads on types and collections events', async () => {
    const { result } = renderHook(() => useRows({ typeIds: ['page'] }))
    await waitFor(() => expect(result.current.rows).toHaveLength(3))
    mocked.rows.mockClear()
    act(() => emit(ev('types', 'page')))
    await waitFor(() => expect(mocked.rows).toHaveBeenCalledTimes(1))
    expect(mocked.rows).toHaveBeenCalledWith({ typeIds: ['page'], preview: false })
    mocked.rows.mockClear()
    act(() => emit(ev('views', 'page')))
    act(() => emit(ev('ui', 'ui.json')))
    await new Promise((r) => setTimeout(r, 250))
    expect(mocked.rows).not.toHaveBeenCalled()
    act(() => emit(ev('collections', 'tools')))
    await waitFor(() => expect(mocked.rows).toHaveBeenCalledTimes(1))
  })
})

describe('useRows with rollups (M12)', () => {
  let emit: (e: ChangeEvent) => void
  const PROJECT = typeDef({
    id: 'project',
    name: 'Project',
    propertyDefinitions: [
      propertyDef({ id: 'p-members', key: 'members', name: 'Members', type: 'entity', options: { isArray: true, allowedTypes: ['member'] } }),
      propertyDef({ id: 'p-hours', key: 'hours', name: 'Hours', type: 'rollup', options: { relationId: 'p-members', targetId: 'm-hours', calc: 'sum' } }),
    ],
  })
  const P1 = mk('Projects/Apollo.md', {}, {}, 'project')
  const P2 = mk('Projects/Gemini.md', {}, {}, 'project')
  const ev = (kind: ChangeEvent['kind'], path: string): ChangeEvent => ({ kind, path, version: null })

  beforeEach(() => {
    resetLinkIndex()
    useLinkIndex.setState({ types: [PROJECT, PAGE], objects: [], loaded: true })
    mocked.onChange.mockImplementation((cb) => {
      emit = cb
      return () => undefined
    })
    mocked.rows.mockReset()
    mocked.rows.mockResolvedValue([P1, P2])
  })

  test('a change to an object outside the rows reloads every row (a related object a rollup reads)', async () => {
    const { result } = renderHook(() => useRows({ typeIds: ['project'] }))
    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    mocked.rows.mockClear()
    act(() => emit(ev('changed', 'Members/Ann.md')))
    await waitFor(() => expect(mocked.rows).toHaveBeenCalledTimes(1))
    expect(mocked.rows).toHaveBeenCalledWith({ typeIds: ['project'], preview: false })
  })

  test("a change to one of the rollup type's own rows still refetches only that row", async () => {
    const { result } = renderHook(() => useRows({ typeIds: ['project'] }))
    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    mocked.rows.mockClear()
    mocked.rows.mockResolvedValue([P1])
    act(() => emit(ev('changed', 'Projects/Apollo.md')))
    await waitFor(() => expect(mocked.rows).toHaveBeenCalledTimes(1))
    expect(mocked.rows).toHaveBeenCalledWith({ typeIds: ['project'], paths: ['Projects/Apollo.md'], preview: false })
  })

  test('without a rollup in scope an outside change fetches only that path', async () => {
    mocked.rows.mockResolvedValue([mk('Pages/A.md')])
    const { result } = renderHook(() => useRows({ typeIds: ['page'] }))
    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    mocked.rows.mockClear()
    mocked.rows.mockResolvedValue([])
    act(() => emit(ev('changed', 'Members/Ann.md')))
    await waitFor(() => expect(mocked.rows).toHaveBeenCalledTimes(1))
    expect(mocked.rows).toHaveBeenCalledWith({ typeIds: ['page'], paths: ['Members/Ann.md'], preview: false })
  })
})

describe('useViewState', () => {
  test('test useViewState 409 refetches and reapplies once', async () => {
    const initial = base()
    const fresh: ViewState = { ...base(), sorts: [{ propertyId: 'title', option: 'ascending' }] }
    const save = vi.fn().mockRejectedValueOnce(new ConflictError('r2')).mockResolvedValue(undefined)
    const refetch = vi.fn().mockResolvedValue(fresh)
    const { result } = renderHook(() => useViewState(initial, save, refetch))
    const group = { type: 'filterGroup' as const, operator: 'or' as const, elements: [] }
    act(() => result.current[1]({ filterGroup: group }))
    expect(result.current[0].filterGroup).toBe(group)
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2), { timeout: 3000 })
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[1][0]).toMatchObject({ sorts: fresh.sorts, filterGroup: group })
    await new Promise((r) => setTimeout(r, 600))
    expect(save).toHaveBeenCalledTimes(2)
  })

  test('saves are debounced into one call', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useViewState(base(), save))
    act(() => {
      result.current[1]({ sorts: [{ propertyId: 'a', option: 'ascending' }] })
      result.current[1]({ sorts: [{ propertyId: 'b', option: 'ascending' }] })
    })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(save.mock.calls[0][0].sorts).toEqual([{ propertyId: 'b', option: 'ascending' }])
  })

  // Audit 2026-11-07 #44: a save in flight counts as pending, so a stored state arriving meanwhile
  // (another window's) does not replace the one being saved.
  test('a stored state that arrives while a save is in flight does not replace ours', async () => {
    let finish: () => void = () => undefined
    const save = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const { result, rerender } = renderHook(({ initial }) => useViewState(initial, save), { initialProps: { initial: base() } })
    const mine = [{ propertyId: 'mine', option: 'ascending' as const }]
    act(() => result.current[1]({ sorts: mine }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 3000 })
    rerender({ initial: { ...base(), sorts: [{ propertyId: 'theirs', option: 'ascending' }] } })
    expect(result.current[0].sorts).toEqual(mine)
    await act(async () => finish())
    expect(result.current[0].sorts).toEqual(mine)
    // Once the save has landed, a new stored state is taken again.
    const later = [{ propertyId: 'later', option: 'ascending' as const }]
    rerender({ initial: { ...base(), sorts: later } })
    expect(result.current[0].sorts).toEqual(later)
  })
})

describe('DataView group labels', () => {
  // The 2026-11-08 sweep: the "By Hour" label reads the Time format setting through the group
  // context, so flipping the setting re-labels the groups without the rows changing.
  test('a view grouped By Hour re-labels when the Time format setting changes', () => {
    const DATED = typeDef({
      id: 'dated',
      name: 'Dated',
      pluralName: 'Dated',
      propertyDefinitions: [
        propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
        propertyDef({ id: 'due', key: 'due', type: 'datetime', name: 'Due' }),
      ],
    })
    const rows = [mk('Dated/A.md', {}, { due: { start: '2026-11-08T14:05:00.000Z', resolution: 'time' } }, 'dated')]
    const state: ViewState = { ...base(), groupBy: { groups: [{ propertyId: 'due', option: 'hour' }] } }
    try {
      useSettings.setState({ settings: { ...settingsDefaults, timeZone: 'UTC' } })
      render(<DataView rows={rows} types={[DATED]} scope={{ typeIds: ['dated'] }} state={state} onState={() => {}} layouts={['list']} />)
      expect(screen.getAllByTestId('group-header').map((h) => h.textContent)).toEqual(['Nov 8, 2026, 2 PM1'])
      act(() => {
        useSettings.setState({ settings: { ...settingsDefaults, timeZone: 'UTC', twentyFourHourTime: true } })
      })
      expect(screen.getAllByTestId('group-header').map((h) => h.textContent)).toEqual(['Nov 8, 2026, 14:001'])
    } finally {
      useSettings.setState({ settings: settingsDefaults })
    }
  })
})
