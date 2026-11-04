// The Day header: the weekday in its colour, the Today pill (today only), the large date and the
// muted "Week {n}". `size='sm'` is the multi-day views' header.
// `ReviewedButton` is the daily note's Reviewed flag shown beside it.
import { useState, type ReactNode } from 'react'
import { api, ConflictError } from '@/api/client'
import { Icon } from '@/components/Icon'
import { typeOf, useLinkIndex } from '@/links/linkIndex'
import { cn } from '@/lib/utils'
import { formatLong, isoWeekday, weekNumber, weekdayColor, weekdayName, type Day, type WeekStart } from './dates'

export const DAY_TEXT = {
  today: 'Today',
  week: 'Week',
  reviewed: 'Reviewed',
}

export function DayHeader({
  day,
  today,
  weekStart,
  size = 'lg',
  aside,
}: {
  day: Day
  /** The viewer's local day. */
  today: Day
  weekStart: WeekStart
  size?: 'lg' | 'sm'
  /** Beside the header, right-aligned (the Reviewed button). */
  aside?: ReactNode
}) {
  const sm = size === 'sm'
  return (
    <header data-testid="day-header" data-day={day} className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <div className={cn('flex items-center gap-2', sm ? 'text-[14px]' : 'text-[18px]')}>
          <span data-testid="day-weekday" className={cn('font-medium', weekdayColor(isoWeekday(day)))}>
            {weekdayName(day)}
          </span>
          {day === today && (
            <span
              data-testid="today-pill"
              className="rounded-md bg-red-50/50 px-1.5 py-[1px] text-red-500 dark:bg-red-400/10 dark:text-red-500"
            >
              {DAY_TEXT.today}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className={cn('font-bold tracking-tight text-fg', sm ? 'text-[18px] leading-7' : 'main-heading text-[36px] leading-tight')}>
            {formatLong(day)}
          </h1>
          <span data-testid="day-week" className={cn('text-fg-muted', sm ? 'text-[13px]' : 'text-[16px]')}>
            {`${DAY_TEXT.week} ${weekNumber(day, weekStart)}`}
          </span>
        </div>
      </div>
      {aside && <div className="shrink-0 pb-1.5">{aside}</div>}
    </header>
  )
}

/**
 * The daily note's Reviewed flag: a small checkbox button that writes `reviewed` on the note.
 * Hidden when the day has no note or the DailyNote type has `hideReviewing`.
 */
export function ReviewedButton({
  note,
  version,
  onWritten,
}: {
  note: { path: string; reviewed: boolean } | null
  /** The note's current version (from its row); the button waits for it. */
  version: string | undefined
  /** After a write (or a 409): the owner reloads the day. */
  onWritten?(): void
}) {
  useLinkIndex((s) => s.revision)
  const [optimistic, setOptimistic] = useState<{ path: string; value: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  if (!note || typeOf('dailynote')?.hideReviewing) return null
  const checked = optimistic && optimistic.path === note.path ? optimistic.value : note.reviewed

  const toggle = async () => {
    if (busy || !version) return
    const value = !checked
    setBusy(true)
    setOptimistic({ path: note.path, value })
    try {
      await api.updateProperties(note.path, { reviewed: value }, version)
    } catch (e) {
      setOptimistic(null)
      if (!(e instanceof ConflictError)) console.warn('Could not save Reviewed:', e)
    } finally {
      setBusy(false)
      onWritten?.()
    }
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={DAY_TEXT.reviewed}
      disabled={busy || !version}
      onClick={() => void toggle()}
      className={cn(
        // Borderless: it sits inside the Daily note header's pill, beside the `…` menu.
        'flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-fg transition-colors hover:bg-hover',
        checked && 'bg-hover',
      )}
    >
      <span
        className={cn(
          'flex size-[14px] items-center justify-center rounded-[4px] border',
          checked ? 'border-transparent bg-fg text-app' : 'border-fg-muted',
        )}
      >
        {checked && <Icon name="ph-check-bold" size={10} />}
      </span>
      {DAY_TEXT.reviewed}
    </button>
  )
}
