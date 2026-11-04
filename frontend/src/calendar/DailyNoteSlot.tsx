// A day's daily note: the inline note (its Tags row and body editor) when the note exists. Else,
// in the Day view, the note's placeholder rows (Tags, the body placeholder): clicking or typing in
// the body, or adding a tag, creates it then (`POST /api/daily-notes`) and carries the text or tag
// over; the multi-day views show the outlined "+ Daily Note" button instead. A 409 (a note for the
// day already exists) shows that note. Opening the calendar never creates a note.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, DailyNoteExistsError } from '@/api/client'
import { Icon } from '@/components/Icon'
import { invalidateLinkIndex } from '@/links/linkIndex'
import { ensureNewTags, HeaderTags } from '@/object/ObjectHeader'
import { ObjectView } from '@/object/ObjectView'
import type { Day } from './dates'

export const DAILY_NOTE_TEXT = {
  heading: 'Daily note',
  create: 'Daily Note',
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
  /** Without the heading: where the note's `…` menu is drawn (the multi-day views' date row). */
  menuSlot?: HTMLElement | null
  /** Each version the note's editor adopts (the multi-day Reviewed writes with it). */
  onVersion?(version: string): void
  /**
   * No note yet: draw the note's placeholder rows (Tags, the body placeholder) instead of the
   * "+ Daily Note" button. Default: with the heading (the Day view); the multi-day views keep the button.
   */
  emptyPlaceholders?: boolean
}

export function DailyNoteSlot({
  day,
  note,
  heading,
  onChanged,
  collapsed,
  onToggleCollapsed,
  headerExtra,
  menuSlot: ownerMenuSlot,
  onVersion,
  emptyPlaceholders,
}: DailyNoteSlotProps) {
  /** A note this slot created or found by a 409, shown before the range reload brings it. */
  const [local, setLocal] = useState<{ day: Day; path: string } | null>(null)
  const [focus, setFocus] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Where the note's own `…` menu (the object page's, in full) is drawn: the header pill. */
  const [menuSlot, setMenuSlot] = useState<HTMLElement | null>(null)

  /** The empty day's body placeholder: what is typed in it before the note's editor is ready. */
  const draftRef = useRef<HTMLDivElement | null>(null)
  const [draftEmpty, setDraftEmpty] = useState(true)
  /**
   * The note exists but its editor isn't ready yet: the draft stays shown (and keeps taking
   * keystrokes) while the note's view loads hidden; the editor then takes the whole text.
   */
  const [handover, setHandover] = useState(false)
  const handoverRef = useRef(false)
  const draftBoxRef = useRef<HTMLDivElement | null>(null)
  const noteBoxRef = useRef<HTMLDivElement | null>(null)
  const busyRef = useRef(false)
  const placeholders = emptyPlaceholders ?? !!heading

  const handoverOn = (on: boolean) => {
    handoverRef.current = on
    setHandover(on)
  }

  useEffect(() => {
    setError(null)
    setFocus(false)
    setDraftEmpty(true)
    handoverOn(false)
    if (draftRef.current) draftRef.current.textContent = ''
  }, [day])

  /**
   * Called once by the note's editor when it is ready (or its load failed): swap the views in
   * the DOM at once, so no keystroke lands between, and hand over everything typed so far.
   */
  const takeDraft = () => {
    const text = draftRef.current?.textContent || undefined
    if (draftBoxRef.current) draftBoxRef.current.hidden = true
    if (noteBoxRef.current) noteBoxRef.current.hidden = false
    handoverOn(false)
    return text
  }

  const localPath = local && local.day === day ? local.path : null
  const path = note?.path ?? localPath

  /** Create the day's note now (never before the user clicks, types or tags); `tags` go in with it. */
  const create = async (opts: { tags?: string[] } = {}) => {
    if (busyRef.current || handoverRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    let made: string | null = null
    try {
      try {
        const res = await api.createDailyNote(day)
        made = res.path
        void invalidateLinkIndex()
        if (opts.tags?.length) await addTags(res.path, opts.tags, [], res.version)
      } catch (e) {
        if (made || !(e instanceof DailyNoteExistsError && e.reason === 'exists' && e.path)) throw e
        // The day already has a note: open it, with the chosen tags added to its own.
        made = e.path
        if (opts.tags?.length) {
          const existing = await api.object(e.path)
          await addTags(e.path, opts.tags, existing.summary.tags ?? [], existing.version)
        }
      }
    } catch (e) {
      // Creating failed (nothing opens), or the note opens but a chosen tag didn't reach it.
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (made) {
        // From the placeholder rows, the draft stays until the note's editor takes its text.
        if (draftRef.current) handoverOn(true)
        setLocal({ day, path: made })
        setFocus(true)
      }
      busyRef.current = false
      setBusy(false)
      onChanged?.()
    }
  }

  const showDraft = placeholders && (!path || handover)
  const errorLine = error && (
    <p role="alert" className="mt-1 text-[13px] text-danger">
      {error}
    </p>
  )

  // One fragment with fixed slots, so the draft keeps its DOM (and what was typed in it) while
  // the note's view loads, hidden, beside it.
  const body = (
    <>
      {path && (
        <div ref={noteBoxRef} hidden={handover}>
          <ObjectView
            key={path}
            path={path}
            mode="inline"
            placeholder={DAILY_NOTE_TEXT.placeholder}
            autoFocus={focus}
            initialText={handover ? takeDraft : undefined}
            menuSlot={heading ? menuSlot : (ownerMenuSlot ?? null)}
            onVersion={onVersion}
            onDeleted={() => {
              setLocal(null)
              onChanged?.()
            }}
          />
          {/* The note opened, but a tag chosen before it existed didn't reach it. */}
          {errorLine}
        </div>
      )}
      {showDraft && (
        // No note yet: the note's placeholder rows. Nothing is written until a click, a keystroke or a tag.
        <div ref={draftBoxRef} data-testid="daily-note-empty" className="relative w-full">
          <HeaderTags className="mb-2" tags={[]} readOnly={busy || handover} onChange={(next) => void create({ tags: next })} />
          <div className="object-body-text relative">
            <div
              ref={draftRef}
              role="textbox"
              aria-label={DAILY_NOTE_TEXT.heading}
              aria-multiline
              contentEditable
              suppressContentEditableWarning
              tabIndex={0}
              onMouseDown={() => void create()}
              onInput={(e) => {
                setDraftEmpty((e.currentTarget.textContent ?? '') === '')
                void create()
              }}
              className="min-h-[1.5em] outline-none"
            />
            {draftEmpty && (
              <div aria-hidden data-testid="daily-note-placeholder" className="pointer-events-none absolute top-0 left-0 text-fg-muted">
                {DAILY_NOTE_TEXT.placeholder}
              </div>
            )}
          </div>
          {!path && errorLine}
        </div>
      )}
      {!path && !placeholders && (
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
      )}
    </>
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

/** Add `chosen` to a note's `existing` tags (no duplicates, ignoring case); writes only the tags. */
async function addTags(path: string, chosen: readonly string[], existing: readonly string[], version: string) {
  const had = new Set(existing.map((t) => t.toLowerCase()))
  const added = chosen.filter((t) => !had.has(t.toLowerCase()))
  if (!added.length) return
  const next = [...existing, ...added]
  ensureNewTags(existing, next)
  await api.updateProperties(path, { tags: next }, version)
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
