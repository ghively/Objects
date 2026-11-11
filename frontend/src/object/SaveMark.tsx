/**
 * M32, item 1: the save mark in a note's toolbar (page and peek). It reads the state the note's
 * editor publishes (`editor/saveStateStore`): "Saving…" while edits wait for a save or one runs,
 * then "Saved", which fades to the check alone after a moment. A note nobody typed in shows
 * nothing, and a failed save shows nothing new here (the editor's own "Changes not saved.
 * Retrying…" stays). A polite live region, so a screen reader hears the change without losing
 * its place.
 */
import { useEffect, useState } from 'react'
import { Icon } from '@/components/Icon'
import { useSaveState } from '@/editor/saveStateStore'
import { cn } from '@/lib/utils'

export const SAVE_MARK_TEXT = {
  saving: 'Saving…',
  saved: 'Saved',
} as const

/** How long "Saved" stays written out before it fades to the check alone. */
export const SAVED_TEXT_MS = 2000

export function SaveMark({ path, className }: { path: string; className?: string }) {
  const state = useSaveState(path)
  const busy = state === 'saving' || state === 'unsaved'
  /** Something was typed in this view: only then is "Saved" worth saying. */
  const [edited, setEdited] = useState(false)
  if (busy && !edited) setEdited(true)
  const saved = state === 'saved' && edited
  /** "Saved" has faded to the check; written out again with each new save. */
  const [quiet, setQuiet] = useState(false)
  const [wasSaved, setWasSaved] = useState(saved)
  if (wasSaved !== saved) {
    setWasSaved(saved)
    setQuiet(false)
  }
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setQuiet(true), SAVED_TEXT_MS)
    return () => clearTimeout(t)
  }, [saved])

  return (
    <span
      data-save-mark={busy ? 'saving' : saved ? 'saved' : ''}
      data-quiet={saved ? String(quiet) : undefined}
      aria-live="polite"
      // Stays while the toolbar's buttons fade for typing (`focus/TypingFade`).
      data-typing-stay=""
      className={cn('flex h-10 shrink-0 items-center gap-1 px-1 text-[13px] whitespace-nowrap text-fg-muted select-none', className)}
    >
      {busy && SAVE_MARK_TEXT.saving}
      {saved && (
        <>
          <Icon name="ph-check" size={14} />
          {/* Faded, not removed: the word stays in the live region. */}
          <span className={cn('overflow-hidden transition-[max-width,opacity] duration-500', quiet ? 'max-w-0 opacity-0' : 'max-w-[4em]')}>
            {SAVE_MARK_TEXT.saved}
          </span>
        </>
      )}
    </span>
  )
}
