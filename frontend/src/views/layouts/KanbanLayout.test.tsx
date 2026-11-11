import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Row, UpdateResult, ViewState } from '@/api/types'
import { counterpartDef, objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

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
import { resetLinkIndex } from '@/links/linkIndex'
import { resetFresh, takeFresh } from '@/create/freshObjects'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { resetOpenAsFullPage, setOpenAsFullPage } from '@/test/fullPage'
import { DataView } from '../DataView'
import { emptyFilterGroup } from '../model'

const mocked = vi.mocked(api)

const TASK = typeDef({
  id: 'task',
  name: 'Task',
  pluralName: 'Tasks',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
    propertyDef({ id: 'done', type: 'boolean', name: 'Done' }),
    propertyDef({
      id: 'status',
      type: 'label',
      name: 'Status',
      options: {
        isArray: false,
        set: [
          { id: 'o1', text: 'Not Started', color: 'gray', icon: null },
          { id: 'o2', text: 'Done', color: 'green', icon: null },
        ],
      },
    }),
  ],
})

const mk = (n: number, status: string[], version = 'v1'): Row =>
  row({ summary: objectSummary({ path: `Tasks/T${n}.md`, type: 'task' }), values: { status }, version })
const ROWS = [mk(1, ['Not Started'], 'v7'), { ...mk(2, ['Done']), values: { status: ['Done'], done: true } }, mk(3, [])]

const kanban = (patch: Partial<ViewState> = {}): ViewState => ({
  viewDefinition: { dataViewLayout: 'kanban' },
  filterGroup: emptyFilterGroup(),
  sorts: [],
  groupBy: null,
  ...patch,
})

function Harness({
  init = kanban(),
  patchRow,
  onWritten,
}: {
  init?: ViewState
  patchRow?: (p: string, r: Row) => void
  onWritten?: (r: Row, res: UpdateResult) => void
}) {
  const [state, setState] = useState(init)
  return (
    <DataView
      rows={ROWS}
      types={[TASK]}
      scope={{ typeIds: ['task'] }}
      state={state}
      onState={setState}
      layouts={['list', 'kanban']}
      patchRow={patchRow}
      onWritten={onWritten}
    />
  )
}

const columns = () => screen.getAllByTestId('kanban-column')

beforeEach(() => {
  resetLinkIndex()
  usePeek.getState().close()
  useTabs.getState().reset()
  resetOpenAsFullPage()
  resetFresh()
  vi.clearAllMocks()
  dragEnd = undefined
})

describe('KanbanLayout', () => {
  test('test kanban columns follow label option order plus Other', () => {
    render(<Harness />)
    expect(columns()).toHaveLength(3)
    expect(within(columns()[0]).getByText('Not Started')).toBeTruthy()
    expect(within(columns()[1]).getByText('Done')).toBeTruthy()
    expect(within(columns()[2]).getByText('Other')).toBeTruthy()
  })

  test('test kanban drop writes matching label', async () => {
    const patch = vi.fn()
    render(<Harness patchRow={patch} />)
    const done = columns()[1].getAttribute('data-group')
    dragEnd?.({ active: { id: 'Tasks/T1.md' }, over: { id: `col:${done}` } })
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/T1.md', { status: ['Done'] }, 'v7'))
  })

  test('a second drop of the same card sends the first write version (audit #14)', async () => {
    render(<Harness patchRow={vi.fn()} />)
    const [notStarted, done] = columns().map((c) => c.getAttribute('data-group'))
    const reloads = () => mocked.rows.mock.calls.filter(([scope]) => !scope?.preview).length
    dragEnd?.({ active: { id: 'Tasks/T1.md' }, over: { id: `col:${done}` } })
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(reloads()).toBe(1))
    // The rows never caught up (no patch landed): the card is still in its old column.
    dragEnd?.({ active: { id: 'Tasks/T1.md' }, over: { id: `col:${done}` } })
    expect(notStarted).toBeTruthy()
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledTimes(2))
    expect(mocked.updateProperties).toHaveBeenLastCalledWith('Tasks/T1.md', { status: ['Done'] }, 'v7+1')
  })

  test('test kanban drop calls onWritten with the update result', async () => {
    const patch = vi.fn()
    const onWritten = vi.fn()
    const res: UpdateResult = { version: 'v8', frontmatter: {}, links: {}, synced: [], skipped: [], task: { completed: true, advanced: false } }
    const fresh = mk(1, ['Done'], 'v8')
    mocked.updateProperties.mockResolvedValueOnce(res)
    // The cards' preview fetch answers nothing; the drop's reload answers the fresh row.
    mocked.rows.mockImplementation(async (scope) => (scope?.preview ? [] : [fresh]))
    render(<Harness patchRow={patch} onWritten={onWritten} />)
    const done = columns()[1].getAttribute('data-group')
    dragEnd?.({ active: { id: 'Tasks/T1.md' }, over: { id: `col:${done}` } })
    await waitFor(() => expect(onWritten).toHaveBeenCalledTimes(1))
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
    expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/T1.md', { status: ['Done'] }, 'v7')
    expect(mocked.rows.mock.calls.filter(([scope]) => !scope?.preview)).toHaveLength(1)
    expect(mocked.rows).toHaveBeenCalledWith({ paths: ['Tasks/T1.md'] })
    expect(patch).toHaveBeenCalledWith('Tasks/T1.md', fresh)
    expect(onWritten.mock.calls[0][0].summary.path).toBe('Tasks/T1.md')
    expect(onWritten.mock.calls[0][1]).toBe(res)
  })

  test('a drop of a row whose type has the key as text writes nothing (audit 2026-11-01 #12)', async () => {
    const NOTE = typeDef({ id: 'note', name: 'Note', pluralName: 'Notes', propertyDefinitions: [propertyDef({ id: 'status', type: 'text', name: 'Status' })] })
    const textRow = row({ summary: objectSummary({ path: 'Notes/N1.md', type: 'note' }), values: { status: 'Done' } })
    const [state, setState] = [kanban(), vi.fn()]
    render(
      <DataView rows={[...ROWS, textRow]} types={[TASK, NOTE]} scope={{ typeIds: ['task', 'note'] }} state={state} onState={setState} layouts={['kanban']} />,
    )
    // The text "Done" is not the label "Done": the row sits in Other.
    const other = columns().find((c) => c.getAttribute('data-group') === 'other')!
    expect(within(other).getByText('N1')).toBeTruthy()
    const done = columns()[1].getAttribute('data-group')
    dragEnd?.({ active: { id: 'Notes/N1.md', data: { current: { path: 'Notes/N1.md', groupId: 'other' } } }, over: { id: `col:${done}` } })
    await new Promise((r) => setTimeout(r, 50))
    expect(mocked.updateProperties).not.toHaveBeenCalled()
    // The refusal is said, not silent.
    expect(screen.getAllByRole('status').map((e) => e.textContent)).toContain("This card can't be moved here.")
    // A task's drop still writes the label.
    dragEnd?.({ active: { id: 'Tasks/T1.md' }, over: { id: `col:${done}` } })
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/T1.md', { status: ['Done'] }, 'v7'))
  })

  test('a long-text card with a second paragraph is not draggable, and a drop of it says why and writes nothing', async () => {
    const PAGE = typeDef({
      id: 'page',
      name: 'Page',
      pluralName: 'Pages',
      propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }), propertyDef({ id: 'body', type: 'textBlock', name: 'Body' })],
    })
    const rows = [
      row({ summary: objectSummary({ path: 'Pages/A.md', type: 'page' }), values: { body: 'First\n\nSecond paragraph' }, version: 'v2' }),
      row({ summary: objectSummary({ path: 'Pages/B.md', type: 'page' }), values: { body: 'Other' }, version: 'v3' }),
    ]
    const state = kanban({ groupBy: { groups: [{ propertyId: 'body', option: 'default' }] } })
    render(<DataView rows={rows} types={[PAGE]} scope={{ typeIds: ['page'] }} state={state} onState={vi.fn()} layouts={['kanban']} />)
    const card = (path: string) => screen.getAllByTestId('kanban-card').find((c) => c.getAttribute('data-path') === path)!
    expect(card('Pages/A.md')).toHaveAttribute('aria-disabled', 'true')
    expect(card('Pages/B.md')).toHaveAttribute('aria-disabled', 'false')
    const other = columns().find((c) => within(c).queryByText('Other'))!.getAttribute('data-group')
    const first = columns().find((c) => within(c).queryByText('First'))!.getAttribute('data-group')
    dragEnd?.({ active: { id: 'Pages/A.md', data: { current: { path: 'Pages/A.md', groupId: first } } }, over: { id: `col:${other}` } })
    await new Promise((r) => setTimeout(r, 50))
    expect(mocked.updateProperties).not.toHaveBeenCalled()
    expect(screen.getAllByRole('status').map((e) => e.textContent)).toContain(
      "This card has more than one paragraph, so it can't be moved to another column.",
    )
    // The one-paragraph card still moves.
    dragEnd?.({ active: { id: 'Pages/B.md', data: { current: { path: 'Pages/B.md', groupId: other } } }, over: { id: `col:${first}` } })
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Pages/B.md', { body: 'First' }, 'v3'))
  })

  test("the group definition follows the grouping's typeId", async () => {
    // Two types with `stage` labels: the grouping names the second type, so its options are the columns.
    const A = typeDef({ id: 'a', name: 'A', pluralName: 'As', propertyDefinitions: [propertyDef({ id: 'stage', type: 'label', name: 'Stage', options: { set: [{ id: 'x', text: 'X', color: null, icon: null }] } })] })
    const B = typeDef({ id: 'b', name: 'B', pluralName: 'Bs', propertyDefinitions: [propertyDef({ id: 'stage', type: 'label', name: 'Stage', options: { set: [{ id: 'y', text: 'Y', color: null, icon: null }] } })] })
    const rows = [row({ summary: objectSummary({ path: 'Bs/B1.md', type: 'b' }), values: { stage: [] }, version: 'v3' })]
    const state = kanban({ groupBy: { groups: [{ propertyId: 'stage', option: 'default', typeId: 'b' }] } })
    render(<DataView rows={rows} types={[A, B]} scope={{ typeIds: ['a', 'b'] }} state={state} onState={vi.fn()} layouts={['kanban']} />)
    expect(columns().map((c) => c.getAttribute('data-group'))).toEqual(['y', 'other'])
    dragEnd?.({ active: { id: 'Bs/B1.md' }, over: { id: 'col:y' } })
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Bs/B1.md', { stage: ['Y'] }, 'v3'))
  })

  test('a column shows a page of cards and loads more on its own (audit 2026-11-01 P1)', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 120 }, (_, i) => mk(100 + i, ['Done']))
    render(<DataView rows={[...ROWS, ...many]} types={[TASK]} scope={{ typeIds: ['task'] }} state={kanban()} onState={vi.fn()} layouts={['kanban']} />)
    const done = columns()[1]
    expect(within(done).getAllByTestId('kanban-card')).toHaveLength(50)
    // The header counts every card of the column.
    expect(within(done).getByText('121')).toBeInTheDocument()
    expect(within(columns()[0]).queryByRole('button', { name: 'Load more' })).toBeNull()
    await user.click(within(done).getByRole('button', { name: 'Load more' }))
    expect(within(done).getAllByTestId('kanban-card')).toHaveLength(100)
    // The board pages per column: no view-wide "Load more".
    expect(screen.getAllByRole('button', { name: 'Load more' })).toHaveLength(1)
  })

  test('the board fetches previews for the cards on screen, and the next page on its "Load more" (audit 2026-11-01 P2)', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 70 }, (_, i) => mk(100 + i, ['Done']))
    const previews = () => mocked.rows.mock.calls.filter(([scope]) => scope?.preview).map(([scope]) => scope?.paths ?? [])
    render(<DataView rows={many} types={[TASK]} scope={{ typeIds: ['task'] }} state={kanban()} onState={vi.fn()} layouts={['kanban']} patchRow={vi.fn()} />)
    await waitFor(() => expect(previews()).toHaveLength(1))
    expect(previews()[0]).toHaveLength(50)
    expect(previews()[0][0]).toBe('Tasks/T100.md')
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(previews()).toHaveLength(2))
    expect(previews()[1]).toEqual(many.slice(50).map((r) => r.summary.path))
  })

  test('test kanban drop on createdAt grouping disabled', () => {
    render(
      <Harness
        init={kanban({ groupBy: { groups: [{ propertyId: 'createdAt', option: 'default' }] } })}
      />,
    )
    for (const c of columns()) expect(c.getAttribute('data-droppable')).toBe('false')
    const id = columns()[0].getAttribute('data-group')
    dragEnd?.({ active: { id: 'Tasks/T1.md' }, over: { id: `col:${id}` } })
    expect(mocked.updateProperties).not.toHaveBeenCalled()
  })

  test('test create from filtered view prefills matching values', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        init={kanban({
          filterGroup: {
            type: 'filterGroup',
            operator: 'and',
            elements: [{ type: 'filter', propertyId: 'done', option: 'isChecked' }],
          },
        })}
      />,
    )
    const done = columns().find((c) => within(c).queryByText('Done'))!
    await user.click(within(done).getByRole('button', { name: /Add to Done/ }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('task', { values: { done: true, status: ['Done'] } }))
  })

  // M32: a new card opens as any new note does (a full page, its title ready for typing); with
  // "Open notes as a full page" off it opens in the peek and the board stays in view.
  test('a new card opens as a full page with its title ready; with full pages off, in the peek', async () => {
    const user = userEvent.setup()
    mocked.createObject.mockResolvedValue({ path: 'Tasks/New.md', version: 'v1' })
    render(<Harness init={kanban()} />)
    await user.click(within(columns()[0]).getByRole('button', { name: /^Add to / }))
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Tasks/New.md' }))
    expect(usePeek.getState().path).toBeNull()
    expect(takeFresh('Tasks/New.md')).toBe(true)

    useTabs.getState().reset()
    setOpenAsFullPage(false)
    mocked.createObject.mockResolvedValue({ path: 'Tasks/Newer.md', version: 'v1' })
    await user.click(within(columns()[0]).getByRole('button', { name: /^Add to / }))
    await waitFor(() => expect(usePeek.getState().path).toBe('Tasks/Newer.md'))
    expect(currentTarget(useTabs.getState())).toBeNull()
    expect(takeFresh('Tasks/Newer.md')).toBe(true)
  })

  test('a board grouped by a counterpart takes no drops and its "+" creates without it (M28 review #2)', async () => {
    const user = userEvent.setup()
    const runs = counterpartDef({
      key: 'runs',
      name: 'Runs',
      options: { allowedTypes: ['application'], counterpartOf: [{ typeId: 'application', key: 'runsOn' }] },
    })
    const host = typeDef({
      id: 'host',
      name: 'Host',
      pluralName: 'Hosts',
      propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title', name: 'Title' })],
      counterparts: [runs],
    })
    const inv = 'Applications/Inventory app.md'
    const hosts = [
      row({
        summary: objectSummary({ path: 'Hosts/H1.md', title: 'H1', type: 'host' }),
        values: { runs: [{ target: 'Inventory app', path: inv }] },
        links: { runs: [inv] },
      }),
      row({ summary: objectSummary({ path: 'Hosts/H2.md', title: 'H2', type: 'host' }), values: { runs: [] }, links: { runs: [] } }),
    ]
    function Board() {
      const [state, setState] = useState(kanban({ groupBy: { groups: [{ propertyId: 'runs', option: 'default' }] } }))
      return <DataView rows={hosts} types={[host]} scope={{ typeIds: ['host'] }} state={state} onState={setState} layouts={['list', 'kanban']} />
    }
    render(<Board />)
    expect(columns().length).toBeGreaterThan(1)
    for (const c of columns()) expect(c.getAttribute('data-droppable')).toBe('false')
    const col = columns().find((c) => within(c).queryByText('Inventory app'))!
    await user.click(within(col).getByRole('button', { name: /Add to Inventory app/ }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('host', { values: {} }))
  })
})
