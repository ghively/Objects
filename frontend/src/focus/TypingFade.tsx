/**
 * Focus while typing: as you type in an editor the surrounding chrome (the top bar with the tabs,
 * the page and peek header buttons) fades out, and comes back as soon as the pointer moves.
 * Object does this always (no setting); it is separate from the explicit focus mode
 * (`FocusMode.tsx`), which hides chrome until it is left.
 *
 * The chrome opts in with the `data-typing-fade` attribute; while `<html>` has `data-typing`,
 * its children fade out and take no pointer events. The values are Object's own
 * (`.glass-chrome-fade>*{transition:opacity .22s ease-out}`, `.is-faded-out>*{opacity:0}`, pointer
 * events off, no transition under reduced motion). Mounted once, by `FocusMode`.
 */
import { useEffect } from 'react'

/** The `<html>` attribute set while the chrome is faded. */
export const TYPING_ATTR = 'data-typing'
/** The attribute that marks a piece of chrome that fades while typing. */
export const TYPING_FADE_ATTR = 'data-typing-fade'

export const TYPING_FADE_CSS = `[${TYPING_FADE_ATTR}] > * { transition: opacity .22s ease-out; }
html[${TYPING_ATTR}] [${TYPING_FADE_ATTR}] > * { opacity: 0; }
html[${TYPING_ATTR}] [${TYPING_FADE_ATTR}], html[${TYPING_ATTR}] [${TYPING_FADE_ATTR}] * { pointer-events: none !important; }
@media (prefers-reduced-motion: reduce) { [${TYPING_FADE_ATTR}] > * { transition: none !important; } }`

/** Keys that edit text without a modifier: what counts as typing (our reading of "while typing"). */
export function isTypingKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false
  return e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter'
}

/** Whether `target` is in a rich-text editor (the page body, a peek, a text block cell). */
function inEditor(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('.ProseMirror')
}

export function TypingFade() {
  useEffect(() => {
    const root = document.documentElement
    const style = document.createElement('style')
    style.setAttribute('data-typing-fade-style', '')
    style.textContent = TYPING_FADE_CSS
    document.head.appendChild(style)

    // The pointer's last position: a mouse event at the same spot (fired by a scroll or a
    // layout change under a still pointer) is not a move.
    let last: { x: number; y: number } | null = null
    const onKey = (e: KeyboardEvent) => {
      if (isTypingKey(e) && inEditor(e.target)) root.setAttribute(TYPING_ATTR, '')
    }
    const onMove = (e: MouseEvent) => {
      const moved = !last || last.x !== e.clientX || last.y !== e.clientY
      last = { x: e.clientX, y: e.clientY }
      if (moved) root.removeAttribute(TYPING_ATTR)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousemove', onMove, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousemove', onMove, true)
      root.removeAttribute(TYPING_ATTR)
      style.remove()
    }
  }, [])
  return null
}

export default TypingFade
