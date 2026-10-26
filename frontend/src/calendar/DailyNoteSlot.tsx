// A day's daily note: the inline body editor when the note exists, else the outlined "+ Daily Note"
// button, which creates it (`POST /api/daily-notes`) and shows the editor focused. A 409 (a note
// for the day already exists) shows that note. Opening the calendar never creates a note.
import { useEffect, useRef, useState } from 'react'
import { api, ConflictError, DailyNoteExistsError } from '@/api/client'
import { Icon } from '@/components/Icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { invalidateLinkIndex } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { DeleteObjectDialog } from '@/object/DeleteObjectDialog'
import { ObjectView } from '@/object/ObjectView'
import type { Day } from './dates'

export const DAILY_NOTE_TEXT = {
  /** `CalendarDaily.dailyNote.heading` */
  heading: 'Daily note',
  /** `components.RootDailyNote.name` */
  create: 'Daily Note',
  /** `components.RootDailyNote.placeholder` */
  placeholder: 'Start your daily note',
  /** `components.RootDailyNote.openAsPage` */
  openAsPage: 'Open as Page',
  openInNewTab: 'Open in new tab',
  delete: 'Delete',
  /** Our string. */
  more: 'Daily note options',
}

export interface DailyNoteSlotProps {
  day: Day
  /** The day's note from the calendar range (null: none yet). */
  note: { path: string } | null
  /** Show the "Daily note" heading with its `…` menu (the Day view; the multi-day views don't). */
  heading?: boolean
  /** A note was created (or found) here: the owner reloads its range. */
  onChanged?(): void
  /** Heading collapsed (`ui.calendar.daily.hideDailyNote`); the heading toggles it when given. */
  collapsed?: boolean
  onToggleCollapsed?(): void
}

export function DailyNoteSlot({ day, note, heading, onChanged, collapsed, onToggleCollapsed }: DailyNoteSlotProps) {
  /** A note this slot created or found by a 409, shown before the range reload brings it. */
  const [local, setLocal] = useState<{ day: Day; path: string } | null>(null)
  const [focus, setFocus] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const versionRef = useRef<string | undefined>(undefined)

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
      if (e instanceof DailyNoteExistsError && e.path) {
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

  const remove = async () => {
    if (!path) return
    try {
      await api.deleteObject(path, versionRef.current ? { baseVersion: versionRef.current } : {})
    } catch (e) {
      if (e instanceof ConflictError) throw new Error('The note changed on disk. Try again.', { cause: e })
      throw e
    }
    setLocal(null)
    void invalidateLinkIndex()
    onChanged?.()
  }

  const body = path ? (
    <ObjectView
      key={path}
      path={path}
      mode="inline"
      placeholder={DAILY_NOTE_TEXT.placeholder}
      autoFocus={focus}
      onVersion={(v) => {
        versionRef.current = v
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={DAILY_NOTE_TEXT.more}
                title={DAILY_NOTE_TEXT.more}
                className="flex size-9 items-center justify-center rounded-lg border border-line text-fg-muted hover:bg-hover hover:text-fg"
              >
                <Icon name="ph-dots-three" size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 border-line bg-raised">
              <DropdownMenuItem onSelect={() => useTabs.getState().open({ kind: 'object', path })}>
                <Icon name="ph-arrows-out-simple" size={14} />
                {DAILY_NOTE_TEXT.openAsPage}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => useTabs.getState().open({ kind: 'object', path }, { newTab: true })}>
                <Icon name="ph-arrow-square-out" size={14} />
                {DAILY_NOTE_TEXT.openInNewTab}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                <Icon name="ph-trash" size={14} />
                {DAILY_NOTE_TEXT.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {!collapsed && body}
      <DeleteObjectDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={remove} />
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
