// M23 Task 7: Make it smaller's splitter (plan `2026-11-05-m23-work-section.md`; the split is
// ported from the old dashboard, the framing lines are ours) and an item's short reference. Pure.
import type { TicketInfo } from '@/api/types'
import { WORK_TEXT } from '../workText'

const MAX_PIECES = 4

/** A step's text in at most 4 pieces; under 2 pieces, the step framed by two lines of ours. */
export function splitStep(text: string): string[] {
  const pieces = text
    .split(/;|,| and | then |\(/)
    .map((p) => p.replace(/\)$/, '').trim())
    .filter((p) => p.length > 3)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .slice(0, MAX_PIECES)
  if (pieces.length < 2) return [WORK_TEXT.splitGet, text, WORK_TEXT.splitWrite]
  return pieces
}

/** The ticket id when there is one, else the title. */
export function itemRef(i: { ticket: TicketInfo | null; title: string }): string {
  return i.ticket?.id || i.title
}
