// M23 Task 7: Stuck (plan `2026-11-05-m23-work-section.md`, our call 13). Pure.
import type { WorkBoardItem } from '@/api/types'
import { quietDays, score, STALE_DAYS } from './scoring'

const isBlocked = (i: WorkBoardItem): boolean =>
  !!i.blockedOn || (i.ticket?.deskStatus ?? '').trim().toLowerCase() === 'blocked' || i.stage === 'parked'

/**
 * `blocked`: active items with Blocked on, Desk status Blocked or parked, quiet 7+ days.
 * `waitingOn`: active items whose Blocked on links a person, not already in `blocked`. Each by score.
 */
export function stuck(items: WorkBoardItem[], now: Date): { blocked: WorkBoardItem[]; waitingOn: WorkBoardItem[] } {
  const active = items.filter((i) => !i.done)
  const blocked = active.filter((i) => isBlocked(i) && quietDays(i, now) >= STALE_DAYS)
  const inBlocked = new Set(blocked.map((i) => i.path))
  const waitingOn = active.filter((i) => i.blockedOnPeople.length > 0 && !inBlocked.has(i.path))
  const byScore = (a: WorkBoardItem, b: WorkBoardItem) => score(b, now) - score(a, now)
  return { blocked: blocked.sort(byScore), waitingOn: waitingOn.sort(byScore) }
}
