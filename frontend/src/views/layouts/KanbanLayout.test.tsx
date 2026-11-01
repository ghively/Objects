import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Row, UpdateResult, ViewState } from '@/api/types'
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
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek } from '@/nav/tabs'
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
    mocked.rows.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    render(<Harness patchRow={vi.fn()} />)
    const [notStarted, done] = columns().map((c) => c.getAttribute('data-group'))
    dragEnd?.({ active: { id: 'Tasks/T1.md' }, over: { id: `col:${done}` } })
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocked.rows).toHaveBeenCalledTimes(1))
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
    mocked.rows.mockResolvedValueOnce([fresh])
    render(<Harness patchRow={patch} onWritten={onWritten} />)
    const done = columns()[1].getAttribute('data-group')
    dragEnd?.({ active: { id: 'Tasks/T1.md' }, over: { id: `col:${done}` } })
    await waitFor(() => expect(onWritten).toHaveBeenCalledTimes(1))
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
    expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/T1.md', { status: ['Done'] }, 'v7')
    expect(mocked.rows).toHaveBeenCalledTimes(1)
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
    // A task's drop still writes the label.
    dragEnd?.({ active: { id: 'Tasks/T1.md' }, over: { id: `col:${done}` } })
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/T1.md', { status: ['Done'] }, 'v7'))
  })

  test("the group definition follows the grouping's structureId", async () => {
    // Two types with `stage` labels: the grouping names the second type, so its options are the columns.
    const A = typeDef({ id: 'a', name: 'A', pluralName: 'As', propertyDefinitions: [propertyDef({ id: 'stage', type: 'label', name: 'Stage', options: { set: [{ id: 'x', text: 'X', color: null, icon: null }] } })] })
    const B = typeDef({ id: 'b', name: 'B', pluralName: 'Bs', propertyDefinitions: [propertyDef({ id: 'stage', type: 'label', name: 'Stage', options: { set: [{ id: 'y', text: 'Y', color: null, icon: null }] } })] })
    const rows = [row({ summary: objectSummary({ path: 'Bs/B1.md', type: 'b' }), values: { stage: [] }, version: 'v3' })]
    const state = kanban({ groupBy: { groups: [{ propertyId: 'stage', option: 'default', structureId: 'b' }] } })
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
})
