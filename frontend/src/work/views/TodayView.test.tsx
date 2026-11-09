// M23 Task 12: Today: the 07:00-17:30 timeline with the brief, meetings, focus lines in the gaps,
// the wrap-up, a now-line and the deadline countdowns.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { MeetingSlot, WorkBoard } from '@/api/types'
import { useTabs } from '@/nav/tabs'
import { focusDay } from '@/test/mockApi'
import boardJson from '../__fixtures__/board.json'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import type { DayBlock } from '../logic/daySlots'
import { blockCaptions } from '../logic/timelineCaptions'
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

// A block too short for its label and time (the 24-minute Morning brief is ~35px wide at 1440px and
// read "M…") hangs both, on one line, under the track; long blocks keep them inside.
describe('TodayView short blocks', () => {
  beforeEach(() => resetWorkData())

  test('test the Morning brief shows its label and time in a caption under the track', () => {
    show()
    const [brief] = block('brief')
    expect(brief).toHaveAttribute('data-short')
    expect(brief).toHaveAttribute('title', 'Morning brief 07:00-07:24')
    expect(brief).toHaveAttribute('data-start', '07:00')
    const caption = brief.querySelector('[data-block-caption]') as HTMLElement
    expect(caption).toHaveAttribute('data-block-caption', 'start')
    expect(caption).toHaveAttribute('data-lane', '0')
    expect(caption.className).toContain('whitespace-nowrap')
    expect(within(caption).getByText('Morning brief')).not.toHaveClass('truncate')
    expect(within(caption).getByText('07:00-07:24')).toBeInTheDocument()
    // The track's box makes room for the caption row.
    const box = brief.closest('[data-work-timeline]') as HTMLElement
    expect(box.style.paddingBottom).not.toBe('')
  })

  test('test long blocks keep their label and time inside, the wrap-up hangs from its end', () => {
    show()
    for (const f of block('focus')) {
      expect(f).not.toHaveAttribute('data-short')
      expect(f.querySelector('[data-block-caption]')).toBeNull()
    }
    // Wrap-up (16:30-17:12) would run past 17:30 from its start, so it ends at its block's end.
    const [wrap] = block('wrapUp')
    expect(wrap.querySelector('[data-block-caption]')).toHaveAttribute('data-block-caption', 'end')
    expect(within(wrap).getByText('16:30-17:12')).toBeInTheDocument()
  })

  test('test a short meeting keeps its click from the caption', () => {
    const spy = vi.fn()
    useTabs.setState({ openInSidepanel: spy })
    show()
    const [standup] = block('meeting')
    expect(standup).toHaveAttribute('data-short')
    fireEvent.click(within(standup).getByText('Line 3 standup'))
    expect(spy).toHaveBeenCalledWith({ kind: 'object', path: 'Meetings/Line 3 standup.md' })
  })

  test('test captions that would meet take the next row', () => {
    const b = (start: number, end: number, label: string): DayBlock => ({ start, end, kind: 'meeting', label, path: null })
    const blocks = [b(9 * 60, 9 * 60 + 15, 'Standup'), b(9 * 60 + 15, 9 * 60 + 30, 'Sync'), b(15 * 60, 15 * 60 + 20, 'Call')]
    const at640 = blockCaptions(blocks)
    expect(blocks.map((x) => at640.get(x)?.lane)).toEqual([0, 1, 0])
    // A long block gets no caption.
    expect(blockCaptions([b(10 * 60, 11 * 60, 'Long')]).size).toBe(0)
  })
})

// Audit 2026-11-07 #14: the now-line follows the page's clock alone (it used to add the time since
// the view showed on top of `now`, which already moves, so it ran at twice real speed).
describe('TodayView now-line follows the page clock', () => {
  test('test ten minutes later, with the page clock at 10:10, the line shows 10:10', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(NOW)
      useWorkData.setState({ board: BOARD, today: { day: '2026-11-05', now: NOW.toISOString(), nowLocal: '10:00', meetings: [] } })
      const data = useWorkData.getState()
      const { rerender } = render(<TodayView data={data} now={NOW} />)
      const line = () => (document.querySelector('[data-work-now-line]') as HTMLElement).getAttribute('data-time')
      expect(line()).toBe('10:00')
      act(() => {
        vi.advanceTimersByTime(10 * 60_000)
      })
      rerender(<TodayView data={data} now={new Date(NOW.getTime() + 10 * 60_000)} />)
      expect(line()).toBe('10:10')
    } finally {
      vi.useRealTimers()
    }
  })
})
