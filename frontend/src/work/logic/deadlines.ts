// M23 Task 7: deadline countdowns (plan `2026-11-05-m23-work-section.md`: within 60 days, ours). Pure.
import type { WorkBoardItem } from '@/api/types'

export const DEADLINE_DAYS = 60

const dayNumber = (ymd: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000 : null
}

/** Active items with a deadline from today to 60 days ahead, soonest first. */
export function deadlines(
  items: WorkBoardItem[],
  today: string,
): { path: string; title: string; deadline: string; daysLeft: number }[] {
  const t = dayNumber(today)
  if (t === null) return []
  const out: { path: string; title: string; deadline: string; daysLeft: number }[] = []
  for (const i of items) {
    if (i.done || !i.deadline) continue
    const d = dayNumber(i.deadline)
    if (d === null) continue
    const daysLeft = d - t
    if (daysLeft >= 0 && daysLeft <= DEADLINE_DAYS) out.push({ path: i.path, title: i.title, deadline: i.deadline, daysLeft })
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.title.localeCompare(b.title))
}
