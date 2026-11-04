// One day of the multi-day views (Week, Three days): the small day header over the day's daily
// note slot. For an existing note the header's date row ends in a pill: the
// Reviewed flag, an expand button that opens the note as a page, and the note's own `…` menu.
import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { useTabs } from '@/nav/tabs'
import { DailyNoteSlot } from './DailyNoteSlot'
import { DayHeader, ReviewedButton } from './DayHeader'
import type { Day, WeekStart } from './dates'

export const MULTI_DAY_TEXT = {
  openAsPage: 'Open as Page',
}

export interface MultiDayDayProps {
  day: Day
  today: Day
  weekStart: WeekStart
  /** Undefined while the range loads (no slot yet); null: the day has no note. */
  note: { path: string; reviewed: boolean } | null | undefined
  onChanged?(): void
}

export function MultiDayDay({ day, today, weekStart, note, onChanged }: MultiDayDayProps) {
  const [menuSlot, setMenuSlot] = useState<HTMLElement | null>(null)
  const [version, setVersion] = useState<{ path: string; version: string } | null>(null)
  const path = note?.path ?? null

  const pill = note && (
    <div data-testid="day-note-pill" className="flex h-9 items-center gap-0.5 rounded-xl border border-line pr-1 pl-1">
      <ReviewedButton note={note} version={version && version.path === note.path ? version.version : undefined} onWritten={onChanged} />
      <button
        type="button"
        aria-label={MULTI_DAY_TEXT.openAsPage}
        title={MULTI_DAY_TEXT.openAsPage}
        onClick={() => useTabs.getState().open({ kind: 'object', path: note.path }, { via: 'link' })}
        className="flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
      >
        <Icon name="ph-arrows-out-simple" size={15} />
      </button>
      <div ref={setMenuSlot} className="flex items-center" />
    </div>
  )

  return (
    <>
      <DayHeader day={day} today={today} weekStart={weekStart} size="sm" aside={pill || undefined} />
      {note !== undefined && (
        <DailyNoteSlot
          day={day}
          note={note}
          onChanged={onChanged}
          menuSlot={menuSlot}
          onVersion={(v) => path && setVersion({ path, version: v })}
        />
      )}
    </>
  )
}
