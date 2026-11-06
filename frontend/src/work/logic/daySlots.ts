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

/** The day's blocks by start: the brief, meetings, focus lines in the free gaps, the wrap-up. */
export function dayBlocks(meetings: MeetingSlot[], focus: FocusLine[], nowMinutes: number): DayBlock[] {
  const blocks: DayBlock[] = [{ ...BRIEF, kind: 'brief', label: WORK_TEXT.morningBrief, path: null }]
  const meetingBlocks: DayBlock[] = meetings.map((m) => ({
    start: minutes(m.startLocal),
    end: minutes(m.endLocal),
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
  return blocks.filter((b) => b.end > DAY_START && b.start < DAY_END).sort((a, b) => a.start - b.start)
}
