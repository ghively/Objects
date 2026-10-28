// The overdue catch-up dialog (`RecurringTaskOverdueModal.*`): a recurring task with two or more
// missed occurrences asks which one the checkbox, "Skip" or "Excuse" acts on. Each choice is a
// button "Mark as done for {date}" / "Skip to {date}" / "Excuse for {date}" with its hint; Excuse
// offers only the first two choices (our choice). The dates are our reading of the hint strings:
// "This occurrence only" acts on the current date; "All missed before today" on the latest missed
// one; skipping names the day it moves to.
import type { CatchUp, OccurrenceAction, OverdueInfo, RepeatRule } from './taskContract'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { formatDate } from '@/properties/format'
import { localDayOf, nextDay, type WeekStart } from './repeat'

export const OVERDUE_TEXT = {
  title: {
    complete: 'Mark recurring task done',
    skip: 'Skip recurring task',
    excuse: 'Excuse recurring occurrence',
  },
  description: {
    complete: '"{title}" is overdue by {count} occurrences. Which instance are you marking done?',
    skip: '"{title}" is overdue by {count} occurrences. Which instance are you skipping?',
    excuse: '"{title}" is overdue by {count} occurrences. Which occurrence are you excusing?',
  },
  action: {
    complete: 'Mark as done for {date}',
    skip: 'Skip to {date}',
    excuse: 'Excuse for {date}',
  },
  hint: {
    advanceOne: 'This occurrence only',
    catchUpBeforeNow: 'All missed before today',
    catchUpThroughNow: { complete: 'Also logs all missed as done', skip: 'Also skips all missed' },
  },
  capped: '{count}+',
} as const

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m)

const pad = (n: number) => String(n).padStart(2, '0')
/** The local day `YYYY-MM-DD` of a scheduled day or instant. */
function dayOf(point: string): string {
  const d = localDayOf(point)
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : point.slice(0, 10)
}

/** A scheduled day or instant as the picker shows dates. */
function showPoint(point: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(point) ? formatDate({ start: point, resolution: 'day' }) : formatDate({ start: point, resolution: 'time' })
}

export interface OverdueChoice {
  catchUp: CatchUp
  label: string
  hint: string
}

/** The dialog's choices for `action`, in order. */
export function overdueChoices(action: OccurrenceAction, info: OverdueInfo, rule: RepeatRule | null, weekStart: WeekStart = 'monday'): OverdueChoice[] {
  const current = info.current?.start ?? info.missed[0] ?? info.today
  const latest = info.missed[info.missed.length - 1] ?? current
  const caughtUp = (rule && nextDay(rule, dayOf(latest), info.today, weekStart)) ?? info.today
  const label = (point: string) => fill(OVERDUE_TEXT.action[action], { date: showPoint(point) })
  if (action === 'skip') {
    const after = info.missed[1] ?? caughtUp
    return [
      { catchUp: 'advanceOne', label: label(after), hint: OVERDUE_TEXT.hint.advanceOne },
      { catchUp: 'catchUpBeforeNow', label: label(caughtUp), hint: OVERDUE_TEXT.hint.catchUpBeforeNow },
      { catchUp: 'catchUpThroughNow', label: label(caughtUp), hint: OVERDUE_TEXT.hint.catchUpThroughNow.skip },
    ]
  }
  const out: OverdueChoice[] = [
    { catchUp: 'advanceOne', label: label(current), hint: OVERDUE_TEXT.hint.advanceOne },
    { catchUp: 'catchUpBeforeNow', label: label(latest), hint: OVERDUE_TEXT.hint.catchUpBeforeNow },
  ]
  if (action === 'complete')
    out.push({ catchUp: 'catchUpThroughNow', label: label(latest), hint: OVERDUE_TEXT.hint.catchUpThroughNow.complete })
  return out
}

/** The count as the description shows it: "{count}+" when the server capped it. */
export const overdueCount = (info: OverdueInfo): string =>
  info.capped ? fill(OVERDUE_TEXT.capped, { count: String(info.count) }) : String(info.count)

export interface RecurringOverdueDialogProps {
  open: boolean
  action: OccurrenceAction
  /** The task's title. */
  title: string
  info: OverdueInfo
  rule: RepeatRule | null
  weekStart?: WeekStart
  busy?: boolean
  onChoose(catchUp: CatchUp): void
  onOpenChange(open: boolean): void
}

export function RecurringOverdueDialog({ open, action, title, info, rule, weekStart, busy, onChoose, onOpenChange }: RecurringOverdueDialogProps) {
  const choices = overdueChoices(action, info, rule, weekStart)
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-line bg-raised text-fg" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{OVERDUE_TEXT.title[action]}</AlertDialogTitle>
          <AlertDialogDescription>{fill(OVERDUE_TEXT.description[action], { title, count: overdueCount(info) })}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-1.5">
          {choices.map((c) => (
            <button
              key={c.catchUp}
              type="button"
              disabled={busy}
              data-catch-up={c.catchUp}
              aria-description={c.hint}
              onClick={() => onChoose(c.catchUp)}
              className="flex flex-col items-start rounded-md border border-line px-3 py-2 text-left hover:bg-hover disabled:opacity-50"
            >
              <span className="text-[14px] font-medium">{c.label}</span>
              <span className="text-[12px] text-fg-muted">{c.hint}</span>
            </button>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
