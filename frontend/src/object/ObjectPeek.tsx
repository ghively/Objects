import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ObjectDetail } from '@/api/types'
import { ReviewedButton } from '@/calendar/DayHeader'
import { useCalendar } from '@/calendar/useCalendar'
import { CollectionPeek } from '@/collections/CollectionPeek'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Icon } from '@/components/Icon'
import { NOTE } from '@/lib/words'
import { stemOf, summaryOf, typeOf, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { useIsWhiteboard } from '@/whiteboard/isWhiteboard'
import { isDailyNoteType } from './ObjectHeader'
import { ObjectView } from './ObjectView'
import { WhiteboardPageLazy } from './WhiteboardLazy'

export const PEEK_TEXT = {
  /** Catalog section 5: a daily note's peek adds a "Calendar" button (jump to that day). */
  calendar: 'Calendar',
}

const DAY_PREFIX = /^(\d{4}-\d{2}-\d{2})/

/** The day a daily note is for: its `date` property, else its title, else its file stem (as the server). */
function dailyNoteDay(frontmatter: Record<string, unknown>, title: string, path: string): string | null {
  for (const v of [frontmatter.date, frontmatter.title, title, stemOf(path)]) {
    if (typeof v !== 'string') continue
    const m = DAY_PREFIX.exec(v.trim())
    if (m) return m[1]
  }
  return null
}

/** What the daily note's header shows, read from the view's detail (`dailyNoteOf`). */
interface DailyNote {
  path: string
  reviewed: boolean
  day: string | null
}

function dailyNoteOf(d: ObjectDetail): DailyNote {
  return { path: d.summary.path, reviewed: d.frontmatter.reviewed === true, day: dailyNoteDay(d.frontmatter, d.summary.title, d.summary.path) }
}

/**
 * A daily note's peek header controls: the Reviewed checkbox (the calendar's own) and "Calendar",
 * which opens the calendar's Day view on that day. `note` and `version` are the peek's view's own
 * (its detail and the version it holds), so the header reads nothing itself and the Reviewed
 * write never races a body save; after the write the view's change handling updates `note`.
 */
function DailyNoteControls({ path, note, version, onDismiss }: { path: string; note: DailyNote | null; version: string | undefined; onDismiss(): void }) {
  if (!note || note.path !== path) return null
  const openCalendar = () => {
    if (note.day) {
      const cal = useCalendar.getState()
      cal.setView('day')
      cal.setAnchor(note.day)
    }
    useTabs.getState().open({ kind: 'calendar' })
    onDismiss()
  }
  return (
    <div className="absolute top-3.5 left-1/2 z-10 flex h-10 -translate-x-1/2 items-center gap-0.5 rounded-xl border border-[var(--float-border)] bg-[var(--float-bg)] px-1">
      <ReviewedButton note={note} version={version} />
      <button
        type="button"
        onClick={openCalendar}
        className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-fg transition-colors hover:bg-hover"
      >
        <Icon name="ph-calendar-blank" size={14} />
        {PEEK_TEXT.calendar}
      </button>
    </div>
  )
}

/**
 * M33: the pager button the last step was made with, and the note it stepped to. Each note's view
 * draws its own pager (twice: while it loads, then loaded), so the button a step was made with is
 * gone the moment it is used and the focus fell back to the peek's frame. The new pager takes the
 * focus back, so the same key steps on (and never lands in the note the step just showed, nor
 * does an empty note take the caret from the pager). Forgotten when the person moves the focus
 * elsewhere, and when the peek closes.
 */
let stepped: { path: string; button: 'prev' | 'next' } | null = null

function Pager() {
  const { index, list, next, prev, path } = usePeek()
  const prevRef = useRef<HTMLButtonElement | null>(null)
  const nextRef = useRef<HTMLButtonElement | null>(null)
  useLayoutEffect(() => {
    if (!stepped || stepped.path !== path) return
    const wanted = stepped.button === 'next' ? nextRef.current : prevRef.current
    // At either end of the list the button is off: the other one is the way back.
    const el = wanted && !wanted.disabled ? wanted : stepped.button === 'next' ? prevRef.current : nextRef.current
    el?.focus({ preventScroll: true })
  }, [path])
  if (list.length < 2) return null
  const step = (button: 'prev' | 'next') => {
    if (button === 'next') next()
    else prev()
    const now = usePeek.getState().path
    stepped = now !== null && now !== path ? { path: now, button } : null
  }
  // A blur means the person moved the focus (a button that is removed fires none).
  const forget = () => {
    stepped = null
  }
  return (
    <div className="flex items-center gap-1 rounded-xl border border-line bg-raised-2 py-1 pr-1 pl-3 text-[15px]">
      <span className="tabular-nums">{`${index + 1} / ${list.length}`}</span>
      <button
        ref={prevRef}
        type="button"
        aria-label="Previous"
        onClick={() => step('prev')}
        onBlur={forget}
        disabled={index <= 0}
        className="flex size-8 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Icon name="ph-caret-left" size={16} />
      </button>
      <button
        ref={nextRef}
        type="button"
        aria-label="Next"
        onClick={() => step('next')}
        onBlur={forget}
        disabled={index >= list.length - 1}
        className="flex size-8 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Icon name="ph-caret-right" size={16} />
      </button>
    </div>
  )
}

/**
 * The object "peek": a large modal over the current page, with a pager through the list it came from.
 * M31: the collection peek (`CollectionPeek`) is mounted here beside it, so an object opened from a
 * collection's peek shows over it.
 */
export function ObjectPeek() {
  const path = usePeek((s) => s.path)
  const close = usePeek((s) => s.close)
  useLinkIndex((s) => s.revision)
  const whiteboard = useIsWhiteboard(path)
  const summary = path ? summaryOf(path) : undefined
  const title = path ? (summary?.title ?? stemOf(path)) : ''
  const dailyNote = !!summary && isDailyNoteType(typeOf(summary.type), summary.type)
  // The version the peek's view adopts (load, saves, reloads) and its detail; reset with the path.
  const [version, setVersion] = useState<{ path: string; version: string } | null>(null)
  const [note, setNote] = useState<DailyNote | null>(null)
  // The peek closed: a pager step made in it is over (`stepped`).
  useEffect(() => {
    if (path === null) stepped = null
  }, [path])

  return (
    <>
      <CollectionPeek />
      <Dialog open={path !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[min(850px,calc(100vh-48px))] w-[min(1240px,calc(100vw-48px))] max-w-none gap-0 overflow-hidden rounded-2xl border-line bg-panel p-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <DialogDescription className="sr-only">{`${NOTE} preview`}</DialogDescription>
          {path &&
            (whiteboard ? (
              <WhiteboardPageLazy
                key={path}
                path={path}
                mode="peek"
                onExpand={() => {
                  useTabs.getState().open({ kind: 'object', path }, { via: 'link' })
                  close()
                }}
                onDismiss={close}
                footer={<Pager />}
              />
            ) : (
              <ObjectView
                key={path}
                path={path}
                mode="peek"
                onVersion={(v) => setVersion({ path, version: v })}
                onDetail={(d) => setNote(dailyNoteOf(d))}
                onExpand={() => {
                  useTabs.getState().open({ kind: 'object', path }, { via: 'link' })
                  close()
                }}
                onDismiss={close}
                footer={<Pager />}
              />
            ))}
          {path && dailyNote && !whiteboard && (
            <DailyNoteControls
              path={path}
              note={note?.path === path ? note : null}
              version={version?.path === path ? version.version : undefined}
              onDismiss={close}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
