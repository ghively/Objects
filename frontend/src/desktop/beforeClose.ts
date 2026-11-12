/**
 * M33: closing the desktop window loses nothing. The shell asks the page before it closes the
 * window (`onBeforeClose`) and waits for the answer, 3 seconds at most. The handler here:
 *
 * 1. makes everything save, the way a closing browser window does: it dispatches `pagehide` on the
 *    window, which every saver already listens for (`editor/useAutosave.ts` sends unsaved text and
 *    keeps it for the next open until the save lands; `object/ObjectView.tsx` commits a typed
 *    title; `whiteboard/useBoard.ts` and `whiteboard/ink/useInkDoc.ts` flush). None of those files
 *    is touched, and the real `pagehide` that follows the close finds nothing left to send;
 * 2. answers when no save is waiting or on its way:
 *    - the open notes' text and titles, as `editor/saveStateStore.ts` publishes them (`SaveWatch`
 *      reports them here): 'unsaved' and 'saving' are waited for;
 *    - every write request not yet answered (`writesInFlight.ts`): whiteboards, drawings and
 *      property edits publish no state, and a note shown some other way has no watcher;
 *    then a short quiet spell, because one save can start the next (newer text behind the one in
 *    flight, a title's rename after its text);
 * 3. answers anyway after 2.5 seconds, so the shell's 3 are never reached. A failed save answers
 *    too ('error', or a request refused): its text is kept for the next open (`editor/unsaved.ts`).
 *
 * Nothing was waiting: it answers on the next turn of the event loop.
 */
import type { SaveState } from '@/editor/useAutosave'
import { desktop } from './bridge'
import { trackWrites, writesInFlight } from './writesInFlight'

/** The handler's own upper limit (the shell waits 3 seconds). */
export const BEFORE_CLOSE_LIMIT_MS = 2500
/** How long nothing must be waiting or on its way, once something was, before the answer. */
export const SETTLE_QUIET_MS = 100
const POLL_MS = 20

/** The open notes' save states (text and title together), by path (`SaveWatch`). */
const notes = new Map<string, SaveState>()

/** `SaveWatch` says where the note at `path` stands; null when it is no longer open. */
export function reportSaveState(path: string, state: SaveState | null): void {
  if (state === null) notes.delete(path)
  else notes.set(path, state)
}

/** Whether a save waits to be sent or is on its way. */
export function savesPending(): boolean {
  if (writesInFlight() > 0) return true
  for (const state of notes.values()) if (state === 'unsaved' || state === 'saving') return true
  return false
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function pageHideEvent(): Event {
  return typeof PageTransitionEvent === 'function' ? new PageTransitionEvent('pagehide', { persisted: false }) : new Event('pagehide')
}

/** Save everything now and resolve when it is saved, or after `limitMs`. Never rejects. */
export async function saveEverything(limitMs: number = BEFORE_CLOSE_LIMIT_MS): Promise<void> {
  const started = Date.now()
  try {
    window.dispatchEvent(pageHideEvent())
  } catch {
    // A listener that throws must not keep the window open; the others have run.
  }
  // What the listeners started (requests, published states) is visible a turn later.
  await sleep(0)
  if (!savesPending()) return
  let quietSince: number | null = null
  for (;;) {
    const now = Date.now()
    const left = limitMs - (now - started)
    if (left <= 0) return
    if (savesPending()) quietSince = null
    else {
      quietSince ??= now
      if (now - quietSince >= SETTLE_QUIET_MS) return
    }
    await sleep(Math.min(POLL_MS, left))
  }
}

let unregister: (() => void) | null = null

/**
 * Register the handler with the shell, once (`main.tsx`, before the app renders, so every write is
 * counted from the first). In a browser tab and in the pywebview window: nothing.
 */
export function registerBeforeClose(): () => void {
  const d = desktop()
  if (!d) return () => undefined
  if (!unregister) {
    trackWrites()
    const off = d.onBeforeClose(() => saveEverything().catch(() => undefined))
    unregister = () => {
      off()
      unregister = null
    }
  }
  return unregister
}

/** Tests: nothing registered, nothing reported. */
export function resetBeforeClose(): void {
  unregister?.()
  unregister = null
  notes.clear()
}
