// M22 Task 11: the step list editor (kind and state chips, the current step, drag to reorder,
// inline edit, "+ Add step", the two-press Approve and the per-step actions).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { StepValue } from '@/api/types'
import { StepList } from './StepList'

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

const q1 = step({ id: 'q4m2xa', kind: 'question', state: 'done', text: 'Which tray jams most often?', answer: 'Tray 2' })
const a2 = step({ id: 'r8k1pd', kind: 'approve', state: 'open', text: 'Restart the print spooler on PRN-TEST-01' })
const d3 = step({ id: 't5n7bc', kind: 'do', state: 'open', text: 'Print 20 test pages' })
const STEPS = [q1, a2, d3]

function setup(steps: StepValue[] = STEPS, extra: { readOnly?: boolean } = {}) {
  const onOps = vi.fn(async () => true)
  const onAction = vi.fn(async () => true)
  render(<StepList steps={steps} onOps={onOps} onAction={onAction} {...extra} />)
  return { onOps, onAction, rows: () => screen.getAllByRole('listitem') }
}

const stateChip = (row: HTMLElement) => within(row).getByRole('button', { name: /^State:/ })

describe('StepList', () => {
  test('renders the kind and state chips with their labels', () => {
    const { rows } = setup()
    const [r1, r2, r3] = rows()
    expect(within(r1).getByText('Question')).toBeInTheDocument()
    expect(within(r1).getByText('Done')).toBeInTheDocument()
    expect(within(r2).getByText('Approve')).toBeInTheDocument()
    expect(within(r2).getByText('Open')).toBeInTheDocument()
    expect(within(r3).getByText('Do')).toBeInTheDocument()
  })

  test('the current step has aria-current="step"', () => {
    const { rows } = setup()
    const [r1, r2, r3] = rows()
    expect(r2).toHaveAttribute('aria-current', 'step')
    expect(r1).not.toHaveAttribute('aria-current')
    expect(r3).not.toHaveAttribute('aria-current')
  })

  test('dragging step 3 above step 1 moves it before step 1', async () => {
    const { rows, onOps } = setup()
    const [r1, , r3] = rows()
    const handle = within(r3).getByRole('button', { name: 'Drag to reorder' })
    fireEvent.dragStart(handle, { dataTransfer: { setData: vi.fn(), effectAllowed: 'move' } })
    fireEvent.dragOver(r1, { dataTransfer: { dropEffect: 'move' } })
    fireEvent.drop(r1, { dataTransfer: {} })
    await waitFor(() =>
      expect(onOps).toHaveBeenCalledWith([{ op: 'move', stepId: 't5n7bc', stepRev: d3.rev, before: 'q4m2xa' }]),
    )
  })

  test('editing a step text sends edit', async () => {
    const user = userEvent.setup()
    const { onOps } = setup()
    await user.click(screen.getByRole('button', { name: 'Edit step 3' }))
    const box = screen.getByRole('textbox', { name: 'Step 3 text' })
    await user.clear(box)
    await user.type(box, 'Print 25 test pages{Enter}')
    await waitFor(() =>
      expect(onOps).toHaveBeenCalledWith([{ op: 'edit', stepId: 't5n7bc', stepRev: d3.rev, text: 'Print 25 test pages' }]),
    )
  })

  test('"+ Add step" with kind Approve sends add', async () => {
    const user = userEvent.setup()
    const { onOps } = setup()
    await user.click(screen.getByRole('button', { name: '+ Add step' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'approve')
    await user.type(screen.getByRole('textbox', { name: 'New step' }), 'Swap tray 2{Enter}')
    await waitFor(() => expect(onOps).toHaveBeenCalledWith([{ op: 'add', kind: 'approve', text: 'Swap tray 2' }]))
  })

  test('Approve needs two presses', async () => {
    const user = userEvent.setup()
    const { rows, onAction } = setup()
    const r2 = rows()[1]
    await user.click(stateChip(r2))
    const actions = within(r2).getByRole('group', { name: 'Step 2 actions' })
    await user.click(within(actions).getByRole('button', { name: 'Approve' }))
    expect(onAction).not.toHaveBeenCalled()
    const again = within(actions).getByRole('button', { name: 'Press again to approve' })
    await user.click(again)
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1))
    expect((onAction.mock.calls[0] as unknown[]).slice(0, 3)).toEqual(['r8k1pd', a2.rev, 'approve'])
  })

  test("an approved step's text is not editable", () => {
    setup([q1, { ...a2, state: 'approved' }, d3])
    expect(screen.queryByRole('button', { name: 'Edit step 2' })).not.toBeInTheDocument()
    expect(screen.getByText('Restart the print spooler on PRN-TEST-01')).toBeInTheDocument()
  })

  test('a done Approve step offers no Reopen; a done Question step does', async () => {
    const user = userEvent.setup()
    const { rows } = setup([q1, { ...a2, state: 'done' }, d3])
    const [r1, r2] = rows()
    expect(stateChip(r2)).toBeDisabled()
    expect(within(r2).queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument()
    await user.click(stateChip(r1))
    expect(within(r1).getByRole('button', { name: 'Reopen' })).toBeInTheDocument()
  })

  test('a step after the current one offers no actions', () => {
    const { rows } = setup()
    expect(stateChip(rows()[2])).toBeDisabled()
  })

  test('a failed action puts the row back as it was', async () => {
    const user = userEvent.setup()
    let finish: (ok: boolean) => void = () => {}
    const onOps = vi.fn(async () => true)
    const onAction = vi.fn(() => new Promise<boolean>((r) => (finish = r)))
    render(<StepList steps={[d3]} onOps={onOps} onAction={onAction} />)
    const r = screen.getAllByRole('listitem')[0]
    await user.click(stateChip(r))
    await user.click(within(r).getByRole('button', { name: 'Mark done' }))
    expect(onAction).toHaveBeenCalledWith('t5n7bc', d3.rev, 'done', undefined)
    await waitFor(() => expect(stateChip(screen.getAllByRole('listitem')[0])).toHaveTextContent('Done'))
    finish(false)
    await waitFor(() => expect(stateChip(screen.getAllByRole('listitem')[0])).toHaveTextContent('Open'))
  })

  test('Answer… sends the text', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn(async () => true)
    render(<StepList steps={[{ ...q1, state: 'open', answer: null }]} onOps={vi.fn(async () => true)} onAction={onAction} />)
    const r = screen.getAllByRole('listitem')[0]
    await user.click(stateChip(r))
    await user.click(within(r).getByRole('button', { name: 'Answer…' }))
    await user.type(within(r).getByRole('textbox', { name: 'Answer' }), 'Tray 2{Enter}')
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('q4m2xa', q1.rev, 'answer', { text: 'Tray 2' }))
  })

  test('read-only shows no edit controls', () => {
    setup(STEPS, { readOnly: true })
    expect(screen.queryByRole('button', { name: '+ Add step' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit step 3' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Drag to reorder' })).not.toBeInTheDocument()
  })
})
