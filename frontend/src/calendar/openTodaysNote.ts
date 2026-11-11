/**
 * Pop out today's daily note (2026-11-09, Gene): the note opens in the peek, the floating panel
 * over the app (the same pop-up an object gets from the Calendar's timeline), so it can be read
 * and written without leaving the page underneath. The note is created first when today has
 * none (the same call as the Calendar's "+ Daily Note"). Reached from the top bar's "Today's
 * note" button, Home's, the palette's "Pop out today's daily note" and Ctrl+Shift+D.
 *
 * M32: it asks for the caret at the end of the note's text (`nav/focusRequest`; the note's editor
 * takes the request when it is ready), so the next key typed lands in today's note. Asked for
 * while the note is already popped out, or is the page in view, the caret goes to the end of the
 * text that is open, at once: no request is left behind for a later opening to take.
 */
import { showToast } from '@/editor/media/upload'
import { invalidateLinkIndex } from '@/links/linkIndex'
import { requestBodyFocus } from '@/nav/focusRequest'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { focusBody } from '@/object/bodyCaret'
import { ensureDailyNote } from '@/palette/paste'
import { todayYmd } from './dates'

export const TODAYS_NOTE_TEXT = {
  button: "Today's note", // our string
  action: "Pop out today's daily note", // our string
  failed: "Couldn't open today's daily note.", // our string
} as const

/** The view (`peek` or `page`) showing the note at `path` now, or null. */
function openViewOf(path: string, mode: 'peek' | 'page'): Element | null {
  for (const view of document.querySelectorAll(`[data-object-view="${mode}"]`)) {
    for (const el of view.querySelectorAll('[data-object-path]')) if (el.getAttribute('data-object-path') === path) return view
  }
  return null
}

export async function openTodaysNote(day: string = todayYmd()): Promise<string | null> {
  try {
    const path = await ensureDailyNote(day)
    void invalidateLinkIndex()
    // Already open: the caret goes to the end of the text where it is shown (the pop-out first).
    const inPeek = usePeek.getState().path === path
    const target = currentTarget(useTabs.getState())
    const isPage = usePeek.getState().path === null && target?.kind === 'object' && target.path === path
    if ((inPeek || isPage) && focusBody(openViewOf(path, inPeek ? 'peek' : 'page'), 'end')) return path
    requestBodyFocus(path, 'end')
    // The pop-out is an explicit peek: it stays one while "Open notes as a full page" is on.
    usePeek.getState().show(path)
    return path
  } catch {
    showToast(TODAYS_NOTE_TEXT.failed)
    return null
  }
}
