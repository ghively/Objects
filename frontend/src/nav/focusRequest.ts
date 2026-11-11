// A one-shot request to put the caret in a note's body once its editor is ready (M32): "Today's
// note" asks for the end of the text, a new note's title hands over to the start. Whoever opens the
// note asks (lane B); the note page takes the request when its editor mounts (lane E).
export type BodyFocus = 'start' | 'end'

const pending = new Map<string, BodyFocus>()

/** Ask for the caret in the body of the note at `path` the next time it is shown. */
export function requestBodyFocus(path: string, at: BodyFocus): void {
  pending.set(path, at)
}

/** Take (and clear) the request for `path`, or null when nobody asked. */
export function takeBodyFocus(path: string): BodyFocus | null {
  const at = pending.get(path) ?? null
  pending.delete(path)
  return at
}
