// A day's daily note: the inline body editor when the note exists, else the outlined "+ Daily Note"
// button, which creates it (`POST /api/daily-notes`) and shows the editor focused. A 409 (a note
// for the day already exists) shows that note. Opening the calendar never creates a note.
import { useEffect, useState, type ReactNode } from 'react'
import { api, DailyNoteExistsError } from '@/api/client'
import { Icon } from '@/components/Icon'
import { invalidateLinkIndex } from '@/links/linkIndex'
import { ObjectView } from '@/object/ObjectView'
import type { Day } from './dates'

export const DAILY_NOTE_TEXT = {
  /** `CalendarDaily.dailyNote.heading` */
  heading: 'Daily note',
  /** `components.RootDailyNote.name` */
  create: 'Daily Note',
  /** `components.RootDailyNote.placeholder` */
  placeholder: 'Start your daily note',
}

export interface DailyNoteSlotProps {
  day: Day
  /** The day's note from the calendar range (null: none yet). */
  note: { path: string } | null
  /** Show the "Daily note" heading with its `…` menu (the Day view; the multi-day views don't). */
  heading?: boolean
  /** A note was created (or found, or deleted) here: the owner reloads its range. */
  onChanged?(): void
  /** Heading collapsed (`ui.calendar.daily.hideDailyNote`); the heading toggles it when given. */
  collapsed?: boolean
  onToggleCollapsed?(): void
  /** Heading only: drawn in the header's pill, left of the `…` menu (the Day view's Reviewed). */
  headerExtra?: ReactNode
}

export function DailyNoteSlot({ day, note, heading, onChanged, collapsed, onToggleCollapsed, headerExtra }: DailyNoteSlotProps) {
  /** A note this slot created or found by a 409, shown before the range reload brings it. */
  const [local, setLocal] = useState<{ day: Day; path: string } | null>(null)
  const [focus, setFocus] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Where the note's own `…` menu (the object page's, in full) is drawn: the header pill. */
  const [menuSlot, setMenuSlot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setError(null)
    setFocus(false)
  }, [day])

  const localPath = local && local.day === day ? local.path : null
  const path = note?.path ?? localPath

  const create = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.createDailyNote(day)
      setLocal({ day, path: res.path })
      setFocus(true)
      void invalidateLinkIndex()
    } catch (e) {
      if (e instanceof DailyNoteExistsError && e.reason === 'exists' && e.path) {
        setLocal({ day, path: e.path })
        setFocus(true)
      } else {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setBusy(false)
      onChanged?.()
    }
  }

  const body = path ? (
    <ObjectView
      key={path}
      path={path}
      mode="inline"
      placeholder={DAILY_NOTE_TEXT.placeholder}
      autoFocus={focus}
      menuSlot={heading ? menuSlot : null}
      onDeleted={() => {
        setLocal(null)
        onChanged?.()
      }}
    />
  ) : (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void create()}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[15px] text-fg hover:bg-hover"
      >
        <Icon name="ph-plus" size={15} />
        {DAILY_NOTE_TEXT.create}
      </button>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  )

  if (!heading) return <div data-testid="daily-note-slot" data-day={day}>{body}</div>

  return (
    <section data-testid="daily-note-slot" data-day={day} aria-label={DAILY_NOTE_TEXT.heading} className="flex flex-col gap-3">
      <div className="flex h-10 items-center justify-between gap-2">
        <SectionHeading label={DAILY_NOTE_TEXT.heading} collapsed={collapsed} onToggle={onToggleCollapsed} />
        {path && (
          <div data-testid="daily-note-pill" className="flex h-9 items-center gap-0.5 rounded-xl border border-line pr-1 pl-1">
            {headerExtra}
            <div ref={setMenuSlot} data-testid="daily-note-menu-slot" className="flex items-center" />
          </div>
        )}
      </div>
      {!collapsed && body}
    </section>
  )
}

/** A section's bold heading; with `onToggle` it collapses and expands the section. */
export function SectionHeading({ label, collapsed, onToggle }: { label: string; collapsed?: boolean; onToggle?(): void }) {
  if (!onToggle) return <h2 className="text-[16px] font-semibold text-fg">{label}</h2>
  return (
    <h2 className="text-[16px] font-semibold text-fg">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="group/heading -ml-1 flex items-center gap-1 rounded-md px-1 hover:bg-hover"
      >
        {label}
        <Icon
          name={collapsed ? 'ph-caret-right' : 'ph-caret-down'}
          size={13}
          className={collapsed ? 'text-fg-muted' : 'text-fg-muted opacity-0 group-hover/heading:opacity-100'}
        />
      </button>
    </h2>
  )
}
