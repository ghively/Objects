// M23 Task 12: Today: the 07:00-17:30 timeline with the brief, meetings, focus lines in the gaps,
// the wrap-up, a now-line and the deadline countdowns.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { MeetingSlot, WorkBoard } from '@/api/types'
import { useTabs } from '@/nav/tabs'
import { focusDay } from '@/test/mockApi'
import boardJson from '../__fixtures__/board.json'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { TodayView } from './TodayView'

const BOARD = boardJson as unknown as WorkBoard
const NOW = new Date('2026-11-05T10:00:00.000Z')

const MEETINGS: MeetingSlot[] = [
  {
    path: 'Meetings/Line 3 standup.md',
    title: 'Line 3 standup',
    start: '2026-11-05T09:00:00.000Z',
    end: '2026-11-05T09:30:00.000Z',
    startLocal: '09:00',
    endLocal: '09:30',
  },
  {
    path: 'Meetings/Vendor call.md',
    title: 'Vendor call',
    start: '2026-11-05T13:00:00.000Z',
    end: '2026-11-05T13:30:00.000Z',
    startLocal: '13:00',
    endLocal: '13:30',
  },
]

function View() {
  const data = useWorkData()
  return <TodayView data={data} now={NOW} />
}

function show() {
  useWorkData.setState({
    board: BOARD,
    today: { day: '2026-11-05', now: NOW.toISOString(), nowLocal: '10:00', meetings: MEETINGS },
    focus: focusDay(['Clear the jams on [[Printer jams on line 3]]', 'Finish [[Scanner rollout]]', 'Plan next week']),
  })
  return render(<View />)
}

const block = (kind: string) => [...document.querySelectorAll(`[data-block-kind="${kind}"]`)] as HTMLElement[]

describe('TodayView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkData()
  })

  test('test the timeline holds the brief, meetings, focus blocks and the wrap-up', () => {
    show()
    const [brief] = block('brief')
    expect(brief).toHaveAttribute('data-start', '07:00')
    expect(within(brief).getByText('Morning brief')).toBeInTheDocument()
    const meetings = block('meeting')
    expect(meetings.map((m) => m.getAttribute('data-start'))).toEqual(['09:00', '13:00'])
    expect(within(meetings[0]).getByText('Line 3 standup')).toBeInTheDocument()
    expect(meetings[0]).toHaveAttribute('data-tone', 'you')
    const focus = block('focus')
    expect(focus.map((f) => [f.getAttribute('data-start'), f.getAttribute('data-end')])).toEqual([
      ['10:00', '11:27'],
      ['11:30', '12:57'],
      ['13:30', '14:57'],
    ])
    const [wrap] = block('wrapUp')
    expect(wrap).toHaveAttribute('data-start', '16:30')
    expect(within(wrap).getByText('Wrap-up')).toBeInTheDocument()
    // hour marks from 07 to 17
    expect(document.querySelectorAll('[data-hour-mark]').length).toBe(11)
  })

  test('test the now-line sits at now', () => {
    show()
    const line = document.querySelector('[data-work-now-line]') as HTMLElement
    expect(line).toHaveAttribute('data-time', '10:00')
    // 10:00 is 180 of the 630 minutes from 07:00
    expect(line.style.left).toBe(`${(180 / 630) * 100}%`)
  })

  test('test no now-line outside the day', () => {
    useWorkData.setState({ board: BOARD, today: { day: '2026-11-05', now: '', nowLocal: '18:00', meetings: [] } })
    render(<TodayView data={useWorkData.getState()} now={new Date('2026-11-05T18:00:00.000Z')} />)
    expect(document.querySelector('[data-work-now-line]')).toBeNull()
  })

  test('test deadline countdowns in the amber tone under 21 days', () => {
    show()
    const row = screen.getByText('Waiting on Pat').closest('[data-work-deadline]') as HTMLElement
    const days = within(row).getByText('7 days')
    expect(days.closest('[data-tone]')).toHaveAttribute('data-tone', 'high')
  })

  test('test the focus lines are listed with their slot times', () => {
    show()
    const list = document.querySelector('[data-work-focus-slots]') as HTMLElement
    expect(within(list).getByText('Clear the jams on Printer jams on line 3')).toBeInTheDocument()
    expect(within(list).getByText('10:00-11:27')).toBeInTheDocument()
    expect(within(list).getByText('13:30-14:57')).toBeInTheDocument()
  })

  test('test a meeting click opens it in the side panel', () => {
    const spy = vi.spyOn(useTabs.getState(), 'openInSidepanel').mockImplementation(() => undefined)
    useTabs.setState({ openInSidepanel: spy })
    show()
    fireEvent.click(within(block('meeting')[1]).getByText('Vendor call'))
    expect(spy).toHaveBeenCalledWith({ kind: 'object', path: 'Meetings/Vendor call.md' })
  })

  test('test the day name shows', () => {
    show()
    expect(screen.getByText('Thursday, November 5')).toBeInTheDocument()
  })
})
