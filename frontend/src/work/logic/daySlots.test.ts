// M23 Task 7: Today's blocks.
import { describe, expect, test } from 'vitest'
import type { FocusLine, MeetingSlot } from '@/api/types'
import { WORK_TEXT } from '../workText'
import { dayBlocks } from './daySlots'

const meeting = (title: string, start: string, end: string): MeetingSlot => ({
  path: `Meetings/${title}.md`,
  title,
  start: `2026-11-05T${start}:00.000Z`,
  end: `2026-11-05T${end}:00.000Z`,
  startLocal: start,
  endLocal: end,
})
const focus = (n: number, path: string | null = null): FocusLine => ({
  n,
  text: `Focus ${n}`,
  label: `Focus ${n}`,
  links: path ? [{ target: 'X', path }] : [],
})
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const show = (blocks: ReturnType<typeof dayBlocks>) => blocks.map((b) => `${b.kind} ${hm(b.start)}-${hm(b.end)} ${b.label}`)

describe('day slots', () => {
  test('the brief, meetings, focus lines in the gaps and the wrap-up', () => {
    const meetings = [meeting('Line 3 standup', '09:00', '09:30'), meeting('Vendor call', '13:00', '13:30')]
    const blocks = dayBlocks(meetings, [focus(1, 'Tasks/A.md'), focus(2), focus(3), focus(4), focus(5), focus(6)].slice(0, 3), at('08:10'))
    // gaps from 08:15: 08:15-09:00, 09:30-13:00 (split at 11:15), 13:30-16:30 (split at 15:00)
    expect(show(blocks)).toEqual([
      `brief 07:00-07:24 ${WORK_TEXT.morningBrief}`,
      'focus 08:15-08:57 Focus 1',
      'meeting 09:00-09:30 Line 3 standup',
      'focus 09:30-11:12 Focus 2',
      'focus 11:15-12:57 Focus 3',
      'meeting 13:00-13:30 Vendor call',
      `wrapUp 16:30-17:12 ${WORK_TEXT.wrapUp}`,
    ])
    expect(blocks.find((b) => b.label === 'Focus 1')!.path).toBe('Tasks/A.md')
    expect(blocks.find((b) => b.kind === 'meeting')!.path).toBe('Meetings/Line 3 standup.md')
    // five focus lines fill all five slots, the later halves too
    const five = dayBlocks(meetings, [1, 2, 3, 4, 5, 6].map((n) => focus(n)), at('08:10'))
    expect(show(five.filter((b) => b.kind === 'focus')).slice(3)).toEqual([
      'focus 13:30-14:57 Focus 4',
      'focus 15:00-16:27 Focus 5',
    ])
  })

  test('a 40-minute gap is skipped, and gaps never start before 08:00', () => {
    const meetings = [meeting('A', '09:00', '09:30'), meeting('B', '10:10', '16:30')]
    const blocks = dayBlocks(meetings, [focus(1), focus(2)], at('06:00'))
    expect(show(blocks.filter((b) => b.kind === 'focus'))).toEqual(['focus 08:00-08:57 Focus 1'])
  })

  test('gaps start at now rounded up to the quarter hour', () => {
    const blocks = dayBlocks([], [focus(1)], at('14:31'))
    expect(show(blocks.filter((b) => b.kind === 'focus'))).toEqual(['focus 14:45-16:27 Focus 1'])
  })

  test('blocks outside 07:00-17:30 are dropped', () => {
    const blocks = dayBlocks([meeting('Early', '06:00', '06:30'), meeting('Late', '18:00', '18:30')], [], at('08:00'))
    expect(blocks.map((b) => b.kind)).toEqual(['brief', 'wrapUp'])
  })
})
