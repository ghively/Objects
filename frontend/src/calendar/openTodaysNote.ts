/**
 * Pop out today's daily note (2026-11-09, Gene): the note opens in the peek, the floating panel
 * over the app (the same pop-up an object gets from the Calendar's timeline), so it can be read
 * and written without leaving the page underneath. The note is created first when today has
 * none (the same call as the Calendar's "+ Daily Note"). Reached from the top bar's "Today's
 * note" button, Home's, the palette's "Pop out today's daily note" and Ctrl+Shift+D.
 *
 * M32: it asks for the caret at the end of the note's text (`nav/focusRequest`; the note's editor
 * takes the request when it is ready), so the next key typed lands in today's note.
 */
import { showToast } from '@/editor/media/upload'
import { invalidateLinkIndex } from '@/links/linkIndex'
import { requestBodyFocus } from '@/nav/focusRequest'
import { usePeek } from '@/nav/tabs'
import { ensureDailyNote } from '@/palette/paste'
import { todayYmd } from './dates'

export const TODAYS_NOTE_TEXT = {
  button: "Today's note", // our string
  action: "Pop out today's daily note", // our string
  failed: "Couldn't open today's daily note.", // our string
} as const

export async function openTodaysNote(day: string = todayYmd()): Promise<string | null> {
  try {
    const path = await ensureDailyNote(day)
    void invalidateLinkIndex()
    requestBodyFocus(path, 'end')
    // The pop-out is an explicit peek: it stays one while "Open notes as a full page" is on.
    usePeek.getState().show(path)
    return path
  } catch {
    showToast(TODAYS_NOTE_TEXT.failed)
    return null
  }
}
