// "N days left" / "Missed" beside a task's deadline, and "Scheduled
// after deadline" when the task's date is after it.
import type { DateValue } from '@/api/types'
import { cn } from '@/lib/utils'
import { zonedDayDate } from '@/lib/zonedShell'
import { localDayOf } from './repeat'

const DAY_MS = 86_400_000

/** Whole calendar days from `a` to `b` (local days, DST-safe). */
function dayDiff(a: Date, b: Date): number {
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS)
}

/** Whole calendar months from `a` to `b` (a month counts once the day of month is reached). */
function monthDiff(a: Date, b: Date): number {
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (b.getDate() < a.getDate()) m -= 1
  return m
}

/** The label for a deadline seen from `today` (default: today in the Time zone setting); null without a deadline. */
export function deadlineText(deadline: DateValue | null | undefined, today: Date = zonedDayDate()): string | null {
  const due = deadline?.start ? localDayOf(deadline.start) : null
  if (!due) return null
  const days = dayDiff(today, due)
  if (days < 0) return 'Missed'
  const months = monthDiff(today, due)
  if (months >= 12) {
    const years = Math.floor(months / 12)
    return years === 1 ? '1 year left' : `${years} years left`
  }
  if (months >= 1) return months === 1 ? '1 month left' : `${months} months left`
  return days === 1 ? '1 day left' : `${days} days left`
}

/** True when the task's date (its day) is after its deadline's day. */
export function scheduledAfterDeadline(date: DateValue | null | undefined, deadline: DateValue | null | undefined): boolean {
  const d = date?.start ? localDayOf(date.start) : null
  const due = deadline?.start ? localDayOf(deadline.start) : null
  return !!d && !!due && dayDiff(due, d) > 0
}

export function DeadlineLabel({
  deadline,
  date,
  today,
  className,
}: {
  deadline: DateValue | null | undefined
  /** The task's date, for "Scheduled after deadline". */
  date?: DateValue | null
  today?: Date
  className?: string
}) {
  const text = deadlineText(deadline, today)
  if (!text) return null
  const missed = text === 'Missed'
  return (
    <span data-testid="deadline-label" className={cn('inline-flex items-center gap-1.5 text-[13px]', className)}>
      <span className={missed ? 'text-[var(--danger)]' : 'text-fg-muted'}>{text}</span>
      {scheduledAfterDeadline(date, deadline) && <span className="text-[var(--warning)]">Scheduled after deadline</span>}
    </span>
  )
}
