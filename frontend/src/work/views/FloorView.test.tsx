// M23 Task 12: On the floor: rows grouped by place with the summary; ticking collects (an item's row
// through M22's `workFloor`, a general row through `generalFloorOp`), the row vanishes and comes
// back with a toast on failure; the add row; un-ticking; Print.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, StepChangedError } from '@/api/client'
import type { FloorItemValue, WorkBoard } from '@/api/types'
import { workBoard, workBoardItem } from '@/test/mockApi'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { resetWorkToasts, useWorkToasts } from '../state/workToasts'
import { FloorView } from './FloorView'

const mocked = vi.mocked(api)
const NOW = new Date('2026-11-05T10:00:00.000Z')

const floor = (over: Partial<FloorItemValue>): FloorItemValue => ({
  id: 'f00001',
  rev: 'r00000000001',
  place: 'Line 3',
  what: 'Photo of the panel',
  collected: null,
  found: null,
  ...over,
})

const PRINTER = workBoardItem({
  path: 'Tasks/Printer jams on line 3.md',
  title: 'Printer jams on line 3',
  ticket: { id: 'INC0012345' } as never,
  floorItems: [
    floor({ id: 'a00001', rev: 'ra0000000001', place: 'Line 3 (by the door)', what: 'Photo of the panel' }),
    floor({ id: 'a00002', rev: 'ra0000000002', place: 'Line 3', what: 'Tray 2 serial' }),
    floor({ id: 'a00003', rev: 'ra0000000003', place: 'Line 3', what: 'Old toner', collected: '2026-11-04', found: 'E-12' }),
  ],
})
const SCANNER = workBoardItem({
  path: 'Tasks/Scanner firmware.md',
  title: 'Scanner firmware',
  floorItems: [floor({ id: 'b00001', rev: 'rb0000000001', place: 'Dock', what: 'Firmware label' })],
})
const GENERAL: FloorItemValue[] = [floor({ id: 'g00001', rev: 'rg0000000001', place: 'Dock', what: 'Spare cables' })]

function View() {
  const data = useWorkData()
  return <FloorView data={data} now={NOW} />
}

function show(board: WorkBoard = workBoard([PRINTER, SCANNER]), general = GENERAL) {
  useWorkData.setState({ board, general: { items: general, revision: 'g1' } })
  return render(<View />)
}

const row = (what: string) => screen.getByText(what).closest('[data-floor-row]') as HTMLElement

describe('FloorView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkData()
    resetWorkToasts()
  })

  test('test rows group by place with the summary', () => {
    show()
    expect(screen.getByText('4 to gather in 2 places · 1 collected')).toBeInTheDocument()
    const groups = [...document.querySelectorAll('[data-floor-place]')].map((g) => g.getAttribute('data-floor-place'))
    expect(groups).toEqual(['Dock', 'Line 3'])
    const line3 = document.querySelector('[data-floor-place="Line 3"]') as HTMLElement
    expect(within(line3).getByText('Photo of the panel')).toBeInTheDocument()
    expect(within(line3).getByText('Tray 2 serial')).toBeInTheDocument()
    expect(within(row('Photo of the panel')).getByText(/INC0012345/)).toBeInTheDocument()
    expect(within(row('Spare cables')).getByText('General list')).toBeInTheDocument()
    const collected = document.querySelector('[data-floor-collected]') as HTMLElement
    expect(within(collected).getByText('Old toner')).toBeInTheDocument()
  })

  test('test ticking an item row collects it through workFloor and the row vanishes', async () => {
    let finish: () => void = () => undefined
    mocked.workFloor.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve({} as never))),
    )
    show()
    const r = row('Tray 2 serial')
    fireEvent.change(within(r).getByPlaceholderText('What you found'), { target: { value: 'SN-77' } })
    fireEvent.click(within(r).getByRole('checkbox'))
    expect(mocked.workFloor).toHaveBeenCalledWith({
      path: 'Tasks/Printer jams on line 3.md',
      op: 'collect',
      itemId: 'a00002',
      itemRev: 'ra0000000002',
      found: 'SN-77',
    })
    expect(screen.queryByText('Tray 2 serial')).toBeNull()
    await act(async () => finish())
    expect(useWorkToasts.getState().toasts).toEqual([])
  })

  test('test enter in what you found collects with the text', () => {
    show()
    const input = within(row('Firmware label')).getByPlaceholderText('What you found')
    fireEvent.change(input, { target: { value: 'v2.1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mocked.workFloor).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'Tasks/Scanner firmware.md', op: 'collect', itemId: 'b00001', found: 'v2.1' }),
    )
  })

  test('test ticking a general row calls generalFloorOp', async () => {
    show()
    fireEvent.click(within(row('Spare cables')).getByRole('checkbox'))
    expect(mocked.generalFloorOp).toHaveBeenCalledWith({ op: 'collect', itemId: 'g00001', itemRev: 'rg0000000001' })
    expect(mocked.workFloor).not.toHaveBeenCalled()
    await waitFor(() => expect(useWorkData.getState().general?.revision).toBe('r1'))
  })

  test('test a 409 brings the row back with a toast', async () => {
    mocked.workFloor.mockRejectedValueOnce(new StepChangedError('This floor item changed. Look again.', ''))
    show()
    fireEvent.click(within(row('Photo of the panel')).getByRole('checkbox'))
    expect(screen.queryByText('Photo of the panel')).toBeNull()
    await waitFor(() => expect(screen.getByText('Photo of the panel')).toBeInTheDocument())
    expect(useWorkToasts.getState().toasts.map((t) => t.text)).toEqual(['This floor item changed. Look again.'])
  })

  test('test the add row with the general list', () => {
    show()
    fireEvent.change(screen.getByPlaceholderText('Place'), { target: { value: 'Line 4' } })
    fireEvent.change(screen.getByPlaceholderText('What'), { target: { value: 'Badge photo' } })
    expect((screen.getByLabelText('Item') as HTMLSelectElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(mocked.generalFloorOp).toHaveBeenCalledWith({ op: 'add', place: 'Line 4', what: 'Badge photo' })
  })

  test('test the add row with an item', () => {
    show()
    fireEvent.change(screen.getByPlaceholderText('What'), { target: { value: 'Label' } })
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: 'Tasks/Scanner firmware.md' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(mocked.workFloor).toHaveBeenCalledWith({ path: 'Tasks/Scanner firmware.md', op: 'add', place: null, what: 'Label' })
  })

  test('test un-ticking a collected row sends uncollect', () => {
    show()
    const collected = document.querySelector('[data-floor-collected]') as HTMLElement
    const r = within(collected).getByText('Old toner').closest('[data-floor-row]') as HTMLElement
    const box = within(r).getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    expect(mocked.workFloor).toHaveBeenCalledWith({
      path: 'Tasks/Printer jams on line 3.md',
      op: 'uncollect',
      itemId: 'a00003',
      itemRev: 'ra0000000003',
    })
  })

  test('test print prints the checklist', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    show()
    expect(document.querySelector('[data-work-print]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Print checklist' }))
    expect(print).toHaveBeenCalledTimes(1)
  })

  test('test the empty state and the general list loads on first show', async () => {
    useWorkData.setState({ board: workBoard([]) })
    render(<View />)
    expect(screen.getByText('Nothing to gather on the floor')).toBeInTheDocument()
    await waitFor(() => expect(mocked.generalFloor).toHaveBeenCalledTimes(1))
  })

  test('test done items are not on the floor', () => {
    show(workBoard([{ ...PRINTER, done: true, stage: 'done' }]), [])
    expect(screen.getByText('Nothing to gather on the floor')).toBeInTheDocument()
  })
})
