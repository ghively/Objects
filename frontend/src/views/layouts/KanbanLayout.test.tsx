import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Row, ViewState } from '@/api/types'
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

function Harness({ init = kanban(), patchRow }: { init?: ViewState; patchRow?: (p: string, r: Row) => void }) {
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
