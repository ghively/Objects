// M23 Task 7: Today's timeline blocks (plan `2026-11-05-m23-work-section.md`; ported from the old
// dashboard: the fixed brief and wrap-up, gaps from now, the split, focus blocks ending early). Pure.
import type { FocusLine, MeetingSlot } from '@/api/types'
import { WORK_TEXT } from '../workText'

export interface DayBlock {
  /** Minutes after midnight. */
  start: number
  end: number
  kind: 'brief' | 'meeting' | 'focus' | 'wrapUp'
  label: string
  path: string | null
}

const DAY_START = 7 * 60 // 07:00
const DAY_END = 17 * 60 + 30 // 17:30
const BRIEF = { start: 7 * 60, end: 7 * 60 + 24 }
const WRAP_UP = { start: 16 * 60 + 30, end: 17 * 60 + 12 }
const EARLIEST_GAP = 8 * 60
const MIN_GAP = 45
const SPLIT_OVER = 132
const FOCUS_EARLY = 3

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

export interface DayRange {
  /** Minutes after midnight. */
  start: number
  end: number
}

/** 07:00-17:30: the least the timeline shows. */
export const DEFAULT_DAY_RANGE: DayRange = { start: DAY_START, end: DAY_END }

/** A meeting's minutes; one that ends past midnight (or before it starts) ends at midnight. */
function meetingSpan(m: MeetingSlot): [number, number] {
  const a = minutes(m.startLocal)
  const b = minutes(m.endLocal)
  return [a, b <= a ? 24 * 60 : b]
}

/**
 * The timeline's range (fix pass H): 07:00-17:30, widened to the whole hour of any meeting that
 * starts earlier or ends later, so evening and early meetings are on it.
 */
export function dayRange(meetings: MeetingSlot[]): DayRange {
  let { start, end } = DEFAULT_DAY_RANGE
  for (const m of meetings) {
    const [a, b] = meetingSpan(m)
    if (a < start) start = Math.max(0, Math.floor(a / 60) * 60)
    if (b > end) end = Math.min(24 * 60, Math.ceil(b / 60) * 60)
  }
  return { start, end }
}

/** The day's blocks by start: the brief, meetings, focus lines in the free gaps, the wrap-up. */
export function dayBlocks(meetings: MeetingSlot[], focus: FocusLine[], nowMinutes: number): DayBlock[] {
  const blocks: DayBlock[] = [{ ...BRIEF, kind: 'brief', label: WORK_TEXT.morningBrief, path: null }]
  const meetingBlocks: DayBlock[] = meetings.map((m) => ({
    start: meetingSpan(m)[0],
    end: meetingSpan(m)[1],
    kind: 'meeting',
    label: m.title,
    path: m.path,
  }))
  blocks.push(...meetingBlocks)
  const busy = [...meetingBlocks.map((b) => [b.start, b.end]), [WRAP_UP.start, WRAP_UP.end]].sort((a, b) => a[0] - b[0])
  const gaps: [number, number][] = []
  let from = Math.max(EARLIEST_GAP, Math.ceil(nowMinutes / 15) * 15)
  for (const [a, b] of busy) {
    if (a - from >= MIN_GAP) gaps.push([from, a])
    from = Math.max(from, b)
  }
  const slots: [number, number][] = []
  for (const [a, b] of gaps) {
    if (b - a > SPLIT_OVER) {
      const mid = Math.round(a + (b - a) / 2)
      slots.push([a, mid], [mid, b])
    } else slots.push([a, b])
  }
  focus.forEach((line, k) => {
    const slot = slots[k]
    if (!slot) return
    const path = line.links.find((l) => l.path)?.path ?? null
    blocks.push({ start: slot[0], end: slot[1] - FOCUS_EARLY, kind: 'focus', label: line.label, path })
  })
  blocks.push({ ...WRAP_UP, kind: 'wrapUp', label: WORK_TEXT.wrapUp, path: null })
  const range = dayRange(meetings)
  return blocks.filter((b) => b.end > range.start && b.start < range.end).sort((a, b) => a.start - b.start)
}
