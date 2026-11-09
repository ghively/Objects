// M22 Task 11: the Steps, List and Floor items cells, and the three kinds in sorts, groups and
// column calculations.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { FloorItemValue, Row, StepValue, WorkWriteResult } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef, workItem, workWriteResult } from '@/test/mockApi'
import { CALC_KINDS, calculate } from '@/views/calc'
import type { FilterCtx } from '@/views/filter'
import { isGroupable } from '@/views/group'
import { SORT_OPTIONS, applySorts } from '@/views/sort'
import { FloorItemsCell } from './FloorItemsCell'
import { StepsCell } from './StepsCell'
import { TextListCell } from './TextListCell'

const mocked = vi.mocked(api)

const step = (p: Partial<StepValue> & Pick<StepValue, 'id' | 'kind' | 'state' | 'text'>): StepValue => ({
  rev: `${p.id}000000`.slice(0, 12),
  notBefore: null,
  answer: null,
  result: null,
  addedAt: null,
  approvedAt: null,
  doneAt: null,
  declinedAt: null,
  ...p,
})
const STEPS = [
  step({ id: 'q4m2xa', kind: 'question', state: 'done', text: 'Which tray jams most often?' }),
  step({ id: 'r8k1pd', kind: 'approve', state: 'open', text: 'Restart the print spooler on PRN-TEST-01' }),
  step({ id: 't5n7bc', kind: 'do', state: 'open', text: 'Print 20 test pages' }),
]
const FLOOR: FloorItemValue[] = [
  { id: 'f3k9wz', rev: 'aaaaaaaaaaaa', place: 'Line 3 printer', what: 'Photo of the error panel', collected: null, found: null },
  { id: 'g7m2qa', rev: 'bbbbbbbbbbbb', place: 'Line 3', what: 'Tray 2 rollers', collected: '2026-11-05', found: 'Worn' },
]

const stepsDef = propertyDef({ id: 'steps', name: 'Steps', type: 'steps' })
const listDef = propertyDef({ id: 'verified', name: 'Verified', type: 'textList' })
const floorDef = propertyDef({ id: 'floorItems', name: 'Floor items', type: 'floorItems' })

beforeEach(() => vi.clearAllMocks())

describe('StepsCell', () => {
  test('in a table: "Step n of N · current text"', () => {
    render(<StepsCell def={stepsDef} value={STEPS} density="table" inTable onChange={vi.fn()} />)
    expect(screen.getByText('Step 2 of 3 · Restart the print spooler on PRN-TEST-01')).toBeInTheDocument()
  })

  test('in a table with no current step: "N steps"', () => {
    const done = STEPS.map((s) => ({ ...s, state: 'done' as const }))
    render(<StepsCell def={stepsDef} value={done} density="table" inTable onChange={vi.fn()} />)
    expect(screen.getByText('3 steps')).toBeInTheDocument()
  })

  test('in the panel a step action runs through onWorkWrite → api.workStep', async () => {
    const user = userEvent.setup()
    const res = workWriteResult({ item: workItem({ steps: [] }) })
    mocked.workStep.mockResolvedValue(res)
    const onWorkWrite = vi.fn(async (run: (p: string, v: string) => Promise<WorkWriteResult>) => run('Tasks/A.md', 'v1'))
    render(<StepsCell def={stepsDef} value={STEPS} path="Tasks/A.md" onWorkWrite={onWorkWrite} onChange={vi.fn()} />)
    const rows = screen.getAllByRole('listitem')
    await user.click(rows[2].querySelector('[aria-label="Edit step 3"]') as HTMLElement)
    await user.clear(screen.getByRole('textbox', { name: 'Step 3 text' }))
    mocked.workSteps.mockResolvedValue(res)
    await user.type(screen.getByRole('textbox', { name: 'Step 3 text' }), 'Print 25 test pages{Enter}')
    await waitFor(() =>
      expect(mocked.workSteps).toHaveBeenCalledWith('Tasks/A.md', [
        { op: 'edit', stepId: 't5n7bc', stepRev: STEPS[2].rev, text: 'Print 25 test pages' },
      ]),
    )
    expect(onWorkWrite).toHaveBeenCalledTimes(1)
  })

  test('steps typed into the file by hand (no id, no state) render as open steps', () => {
    // Before the decoded steps arrive the panel gets the raw front matter; a hand-typed step has
    // no `state` and no `id` (the server reads them as open and `@n`).
    const raw = [{ kind: 'do', text: 'Sweep the floor' }, { kind: 'question', text: 'Who reloads the labels?' }]
    const onWorkWrite = vi.fn()
    render(
      <StepsCell def={stepsDef} value={raw as unknown as StepValue[]} path="Tasks/A.md" onWorkWrite={onWorkWrite} onChange={vi.fn()} />,
    )
    expect(screen.getByText('Sweep the floor')).toBeInTheDocument()
    expect(screen.getByText('Who reloads the labels?')).toBeInTheDocument()
  })

  test('without onWorkWrite the panel is read-only', () => {
    render(<StepsCell def={stepsDef} value={STEPS} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '+ Add step' })).not.toBeInTheDocument()
  })
})

describe('TextListCell', () => {
  test('Enter adds an item and onChange gets the list', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TextListCell def={listDef} value={['The spooler log shows 3 crashes']} onChange={onChange} />)
    await user.type(screen.getByRole('textbox', { name: 'Add item' }), 'Tray 2 is worn{Enter}')
    expect(onChange).toHaveBeenCalledWith(['The spooler log shows 3 crashes', 'Tray 2 is worn'])
  })

  test('Backspace on an empty item removes it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TextListCell def={listDef} value={['One', 'Two']} onChange={onChange} />)
    const second = screen.getByRole('textbox', { name: 'Item 2' })
    await user.clear(second)
    expect(onChange).not.toHaveBeenCalled()
    await user.type(second, '{Backspace}')
    expect(onChange).toHaveBeenCalledWith(['One'])
  })

  test('the table form joins the items with " · "', () => {
    render(<TextListCell def={listDef} value={['One', 'Two']} density="table" inTable onChange={vi.fn()} />)
    expect(screen.getByText('One · Two')).toBeInTheDocument()
  })
})

describe('FloorItemsCell', () => {
  test('ticking collects the item through onWorkWrite → api.workFloor', async () => {
    const user = userEvent.setup()
    mocked.workFloor.mockResolvedValue(workWriteResult())
    const onWorkWrite = vi.fn(async (run: (p: string, v: string) => Promise<WorkWriteResult>) => run('Tasks/A.md', 'v1'))
    render(<FloorItemsCell def={floorDef} value={FLOOR} path="Tasks/A.md" onWorkWrite={onWorkWrite} onChange={vi.fn()} />)
    await user.click(screen.getByRole('checkbox', { name: 'Line 3 printer | Photo of the error panel' }))
    await waitFor(() =>
      expect(mocked.workFloor).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'Tasks/A.md', op: 'collect', itemId: 'f3k9wz', itemRev: 'aaaaaaaaaaaa' }),
      ),
    )
    expect(onWorkWrite).toHaveBeenCalledTimes(1)
  })

  test('the table form reads "1/2 collected"', () => {
    render(<FloorItemsCell def={floorDef} value={FLOOR} density="table" inTable onChange={vi.fn()} />)
    expect(screen.getByText('1/2 collected')).toBeInTheDocument()
  })
})

describe('the work kinds in views', () => {
  const task = typeDef({ id: 'task', propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title' }), stepsDef, listDef, floorDef] })
  const ctx: FilterCtx = { types: [task], collections: [], tagIdsToTitles: {}, now: new Date(2026, 10, 5) }
  const R = (path: string, values: Row['values']): Row => row({ summary: objectSummary({ path, type: 'task' }), values })

  test('a List sorts by its first item; Steps and Floor items do not sort', () => {
    expect(SORT_OPTIONS('textList').length).toBeGreaterThan(0)
    expect(SORT_OPTIONS('steps')).toEqual([])
    expect(SORT_OPTIONS('floorItems')).toEqual([])
    const rows = [R('b', { verified: ['Banana', 'Apple'] }), R('a', { verified: ['Apple'] }), R('e', {})]
    const sorted = applySorts(rows, [{ propertyId: 'verified', option: 'ascending' } as never], ctx)
    expect(sorted.map((r) => r.summary.path)).toEqual(['a', 'b', 'e'])
  })

  test('none of the three groups', () => {
    expect(isGroupable('steps')).toBe(false)
    expect(isGroupable('textList')).toBe(false)
    expect(isGroupable('floorItems')).toBe(false)
  })

  test('column calculations: the count kinds only', () => {
    for (const k of ['steps', 'textList', 'floorItems'] as const) {
      expect(CALC_KINDS(k)).toEqual(['countAll', 'countValues', 'countUnique', 'countEmpty', 'countNotEmpty', 'percentEmpty', 'percentNotEmpty'])
    }
    const rows = [R('a', { verified: ['One', 'Two'], steps: STEPS }), R('b', { verified: [] }), R('c', {})]
    expect(calculate(rows, 'verified', 'countNotEmpty', ctx).value).toBe(1)
    expect(calculate(rows, 'verified', 'countValues', ctx).value).toBe(2)
    expect(calculate(rows, 'steps', 'countNotEmpty', ctx).value).toBe(1)
  })
})
