/**
 * M33, choice 1: the keyboard reaches the text of an open note.
 *
 * With a note open as the page (or as the peek) and nothing focused, **Enter** puts the caret at
 * the end of the text and **ArrowDown** at its start (raw mode the same). A note whose text is
 * empty opens with the caret in the text (`canTakeCaretOnOpen`; `ObjectView` asks it once, when
 * the note has loaded). Nothing else changes: Space and Page Down still scroll, a letter does
 * nothing, and a note with text is never focused by itself, so no stray key edits it.
 *
 * "Nothing focused" is the focus on the page itself (`<body>`) or, for the peek, on its frame
 * (where a dialog's focus rests when no field of it has it): never a field, an editor, a button
 * or a link, whose keys are their own. The view must be the one in front (`viewInFront`): the
 * active tab's page (a note in the side panel is not it), or the open peek, which wins while it
 * is open; never while a dialog, a pop-over, the palette, a menu or a list is open over it. A
 * layer that is closing no longer counts, and a key pressed into its field in that moment (the
 * palette's, right after it opened the note) is the note's.
 *
 * Placing the caret is a change of selection only: nothing is typed and nothing is saved.
 */
import { useEffect, type RefObject } from 'react'
import { useCollectionPeek, usePeek } from '@/nav/tabs'
import { placeBodyCaret } from './bodyCaret'
import { isDocumentLevel } from './pageShortcuts'

/** What can be open over a note: dialogs (a pop-over and the palette are dialogs), menus, lists. */
const LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/**
 * A layer on its way out (its closing animation still runs), or a part of one (the palette's
 * list): it is no longer in the way.
 */
const isClosing = (layer: Element | null) => !!layer?.closest('[data-state="closed"]')

const frameOf = (root: HTMLElement) => root.closest('[role="dialog"]')

/**
 * Whether the note view under `root` (`[data-object-view]`) is the one in front. The page: in the
 * main panel, with no layer and no peek open. The peek: its own frame is open and nothing is open
 * over it (a layer inside it, or one that came after it; a collection's peek under it is not).
 */
export function viewInFront(root: HTMLElement | null, mode: 'page' | 'peek'): boolean {
  if (!root || !root.isConnected) return false
  const layers = [...document.querySelectorAll(LAYER)].filter((l) => !isClosing(l))
  if (mode === 'peek') {
    const frame = frameOf(root)
    if (!frame || isClosing(frame)) return false
    return layers.every((l) => l === frame || (!frame.contains(l) && !!(l.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING)))
  }
  return (
    root.closest('[data-sidepanel-entry]') === null &&
    layers.length === 0 &&
    useCollectionPeek.getState().id === null &&
    usePeek.getState().path === null
  )
}

/** Nothing in particular holds the focus: it is on the page, or on the peek's own frame. */
function isUnfocused(node: unknown, root: HTMLElement, mode: 'page' | 'peek'): boolean {
  return isDocumentLevel(node) || (mode === 'peek' && node === frameOf(root))
}

/**
 * Whether a note that has just loaded may take the caret by itself (it does when its text is
 * empty): its view is in front and nothing holds the focus. A field, a button or a row that has
 * it keeps it (a list or a pager the person is keyboarding through, the title of a new note);
 * only a layer on its way out does not count (the palette that opened the note keeps its field
 * focused until its closing animation ends).
 */
export function canTakeCaretOnOpen(root: HTMLElement | null, mode: 'page' | 'peek'): boolean {
  if (!root || !viewInFront(root, mode)) return false
  const active = document.activeElement
  if (isUnfocused(active, root, mode)) return true
  return isClosing(active?.closest(LAYER) ?? null)
}

/**
 * A key that is still down when the caret lands in the text must not go on to type: the Enter
 * that put it there (held a moment too long, it would break lines), or whatever key opened an
 * empty note (Enter on a list's row, the Work page's Space). Its repeats are dropped until a key
 * is let go or a new one is pressed. Only repeats: a key pressed afresh is never touched.
 */
let dropping: 'Enter' | 'any' | null = null

function onRepeat(e: KeyboardEvent): void {
  if (!dropping) return
  if (!e.repeat) {
    // A new press: the held key was let go where we could not hear it.
    release()
    return
  }
  if (dropping === 'Enter' && e.key !== 'Enter') return
  e.preventDefault()
  e.stopImmediatePropagation()
}

function release(): void {
  dropping = null
  window.removeEventListener('keydown', onRepeat, true)
  window.removeEventListener('keyup', onRelease, true)
  window.removeEventListener('blur', release)
}

function onRelease(e: KeyboardEvent): void {
  if (dropping === 'any' || e.key === 'Enter') release()
}

function dropRepeats(of: 'Enter' | 'any'): void {
  if (!dropping) {
    // Capture phase: the editor never sees a repeat.
    window.addEventListener('keydown', onRepeat, true)
    window.addEventListener('keyup', onRelease, true)
    window.addEventListener('blur', release)
  }
  dropping = of
}

/** The caret was placed by itself (an empty note opened): a key held since before types nothing. */
export function dropHeldKeys(): void {
  dropRepeats('any')
}

/** The node sits in a layer on its way out (the field of the palette that just opened the note). */
const isLeaving = (node: unknown) => node instanceof Element && isClosing(node.closest(LAYER))

/** Bind Enter (the end of the text) and ArrowDown (its start) for the note view under `rootRef`. */
export function useBodyEntryKeys(mode: 'page' | 'peek' | 'inline', rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (mode === 'inline') return
    const enter = (e: KeyboardEvent, free: (node: unknown, root: HTMLElement) => boolean): boolean => {
      if (e.key !== 'Enter' && e.key !== 'ArrowDown') return false
      if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false
      const root = rootRef.current
      if (!root || !free(e.target, root) || !free(document.activeElement, root)) return false
      if (!viewInFront(root, mode)) return false
      if (!placeBodyCaret(root, e.key === 'Enter' ? 'end' : 'start')) return false
      e.preventDefault()
      if (e.key === 'Enter') dropRepeats('Enter')
      return true
    }
    const onKeyDown = (e: KeyboardEvent) => {
      enter(e, (node, root) => isUnfocused(node, root, mode))
    }
    // A layer on its way out keeps the focus in its field until its closing animation ends (the
    // palette, for a fifth of a second after it opened the note): a key pressed then is for the
    // note. It is taken before the leaving layer reads it (the palette would run its row again).
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (!isLeaving(e.target)) return
      if (enter(e, (node, root) => isLeaving(node) || isUnfocused(node, root, mode))) e.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keydown', onKeyDownCapture, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keydown', onKeyDownCapture, true)
    }
  }, [mode, rootRef])
}
