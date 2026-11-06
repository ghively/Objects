// M22: the resolution note of a ticket (plan `2026-11-05-m22-work-model.md`, Contract "Editors" and
// "Resolution note"): two copy-ready blocks, "Work notes" and "Close notes", each in a monospace
// block with a Copy button (a failed copy shows a toast; success shows nothing), and "{gaps} to fill
// in" when the server counted `[fill in: …]` gaps. Never shown as JSON. `ResolutionNoteSection` is
// the collapsible "Resolution note" under the property panel (collapsed by default); it reads the
// work item when opened, and again when the object's version changes while it is open. M23 moves
// the note into the work header.
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { ResolutionNote as Note } from '@/api/types'
import { Icon } from '@/components/Icon'
import { showToast } from '@/editor/media/upload'

export const RESOLUTION_TEXT = {
  heading: 'Resolution note', // our string (plan T12)
  workNotes: 'Work notes', // our string
  closeNotes: 'Close notes', // our string
  copy: 'Copy', // our string
  copyFailed: "Couldn't copy to the clipboard.", // our string
  gaps: (n: number) => `${n} to fill in`, // our string
  loading: 'Loading…', // our string
} as const

const T = RESOLUTION_TEXT

async function copy(text: string): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error('no clipboard')
    await navigator.clipboard.writeText(text)
  } catch {
    showToast(T.copyFailed)
  }
}

function Block({ title, text }: { title: string; text: string }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <h4 className="text-[13px] font-semibold text-fg-muted">{title}</h4>
        <button
          type="button"
          onClick={() => void copy(text)}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-line bg-raised px-2 text-[13px] font-medium text-fg hover:bg-hover"
        >
          <Icon name="ph-copy" size={13} />
          {T.copy}
        </button>
      </div>
      <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-hover/40 p-2.5 font-mono text-[12.5px] leading-[1.5] text-fg">
        {text}
      </pre>
    </section>
  )
}

export function ResolutionNote({ note }: { note: Note }) {
  return (
    <div className="flex flex-col gap-3">
      {note.gaps > 0 && <p className="text-[13px] text-fg-muted">{T.gaps(note.gaps)}</p>}
      <Block title={T.workNotes} text={note.workNotes} />
      <Block title={T.closeNotes} text={note.closeNotes} />
    </div>
  )
}

export interface ResolutionNoteSectionProps {
  path: string
  /** The object's version: an open section reads the note again when it changes. */
  version: string
  /** The note a work write just handed back (used as is, no read). */
  note?: Note | null
}

/** "Resolution note" under the property panel of a ticket: collapsed by default. */
export function ResolutionNoteSection({ path, version, note }: ResolutionNoteSectionProps) {
  const [open, setOpen] = useState(false)
  const [read, setRead] = useState<{ path: string; version: string; note: Note | null } | null>(null)
  const given = note !== undefined && note !== null

  useEffect(() => {
    if (!open || given) return
    let alive = true
    api
      .workItem(path)
      .then((item) => alive && setRead({ path, version, note: item.resolution ?? null }))
      .catch(() => alive && setRead({ path, version, note: null }))
    return () => {
      alive = false
    }
  }, [open, given, path, version])

  const shown = given ? note : read && read.path === path ? read.note : null
  const loading = open && !given && (!read || read.path !== path)

  return (
    <section aria-label={T.heading} className="mt-6 px-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[15px] font-medium text-fg hover:text-fg"
      >
        <Icon name={open ? 'ph-caret-down' : 'ph-caret-right'} size={12} />
        {T.heading}
      </button>
      {open && <div className="mt-3">{shown ? <ResolutionNote note={shown} /> : loading ? <p className="text-[13px] text-fg-muted">{T.loading}</p> : null}</div>}
    </section>
  )
}
