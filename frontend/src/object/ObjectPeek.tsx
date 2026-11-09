import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { ReviewedButton } from '@/calendar/DayHeader'
import { useCalendar } from '@/calendar/useCalendar'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Icon } from '@/components/Icon'
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

/**
 * A daily note's peek header controls: the Reviewed checkbox (the calendar's own) and "Calendar",
 * which opens the calendar's Day view on that day. `version` is the one the peek's view holds, so
 * the Reviewed write never races a body save; the note's `reviewed` and day are read once per version.
 */
function DailyNoteControls({ path, version, onDismiss }: { path: string; version: string | undefined; onDismiss(): void }) {
  const [note, setNote] = useState<{ path: string; reviewed: boolean; day: string | null } | null>(null)
  // Bumped after a Reviewed write: a 409 (the note changed meanwhile) re-reads `reviewed` as it is.
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    let live = true
    api
      .object(path)
      .then((d) => {
        if (!live) return
        setNote({ path, reviewed: d.frontmatter.reviewed === true, day: dailyNoteDay(d.frontmatter, d.summary.title, path) })
      })
      .catch(() => {
        /* the view shows the load's error */
      })
    return () => {
      live = false
    }
  }, [path, version, reloads])
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
      <ReviewedButton note={note} version={version} onWritten={() => setReloads((n) => n + 1)} />
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

function Pager() {
  const { index, list, next, prev } = usePeek()
  if (list.length < 2) return null
  return (
    <div className="flex items-center gap-1 rounded-xl border border-line bg-raised-2 py-1 pr-1 pl-3 text-[15px]">
      <span className="tabular-nums">{`${index + 1} / ${list.length}`}</span>
      <button
        type="button"
        aria-label="Previous"
        onClick={prev}
        disabled={index <= 0}
        className="flex size-8 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Icon name="ph-caret-left" size={16} />
      </button>
      <button
        type="button"
        aria-label="Next"
        onClick={next}
        disabled={index >= list.length - 1}
        className="flex size-8 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Icon name="ph-caret-right" size={16} />
      </button>
    </div>
  )
}

/** The object "peek": a large modal over the current page, with a pager through the list it came from. */
export function ObjectPeek() {
  const path = usePeek((s) => s.path)
  const close = usePeek((s) => s.close)
  useLinkIndex((s) => s.revision)
  const whiteboard = useIsWhiteboard(path)
  const summary = path ? summaryOf(path) : undefined
  const title = path ? (summary?.title ?? stemOf(path)) : ''
  const dailyNote = !!summary && isDailyNoteType(typeOf(summary.type), summary.type)
  // The version the peek's view adopts (load, saves, reloads); reset with the path.
  const [version, setVersion] = useState<{ path: string; version: string } | null>(null)

  return (
    <Dialog open={path !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(850px,calc(100vh-48px))] w-[min(1240px,calc(100vw-48px))] max-w-none gap-0 overflow-hidden rounded-2xl border-line bg-panel p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">Object preview</DialogDescription>
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
              onExpand={() => {
                useTabs.getState().open({ kind: 'object', path }, { via: 'link' })
                close()
              }}
              onDismiss={close}
              footer={<Pager />}
            />
          ))}
        {path && dailyNote && !whiteboard && (
          <DailyNoteControls path={path} version={version?.path === path ? version.version : undefined} onDismiss={close} />
        )}
      </DialogContent>
    </Dialog>
  )
}
