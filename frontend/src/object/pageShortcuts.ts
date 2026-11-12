/**
 * M31, the catalog's Page group (§2): "Select all top-level blocks", "Copy deep link" and
 * "Scroll to top Home, bottom End, page up/down" (ids and keys in `lib/shortcuts.ts`
 * `PAGE_SHORTCUTS`).
 *
 * They act on the active object view (`keyIsForView`): the view holding focus (the page, the peek,
 * or an object in the side panel), or, with focus on the body, the main page while no dialog,
 * collection peek or object peek is open. Select all and Copy deep link work with the caret in the
 * editor too; the scroll keys only outside editable fields (in a field Home and End move the
 * caret), without modifiers, and not when something else already took the key (a list's own
 * Home/End).
 *
 * The deep link is the object reference Object's other Copy actions write (`[[Title]]`, as the
 * `…` menu's Copy > "Copy object reference"; the path when the title can't be a link target):
 * pasted into any object it links back here, and it survives a restart. Object has no URL scheme
 * of its own, and a `127.0.0.1` address changes with every launch (our call).
 */
import { useEffect, useRef, type RefObject } from 'react'
import type { ObjectSummary } from '@/api/types'
import { showToast } from '@/editor/media/upload'
import { wikilinkMarkdown, wikilinkTargetFor } from '@/editor/extensions/wikilink'
import type { BodyEditorHandle } from '@/editor/useAutosave'
import { isEditableTarget, keysFor, matches } from '@/lib/shortcuts'
import { useCollectionPeek, usePeek } from '@/nav/tabs'

export const DEEP_LINK_TEXT = {
  copied: 'Deep link copied', // our string
} as const

export type ScrollAction = 'scrollToTop' | 'scrollToBottom' | 'scrollPageUp' | 'scrollPageDown'

const SCROLL_ACTIONS: readonly ScrollAction[] = ['scrollToTop', 'scrollToBottom', 'scrollPageUp', 'scrollPageDown']

/** How much of the visible height a page key scrolls (our call: the browser's own keeps a little overlap too). */
const PAGE_STEP = 0.9

/** The link "Copy deep link" copies. */
export function deepLinkFor(summary: Pick<ObjectSummary, 'title' | 'path'>): string {
  return wikilinkMarkdown(wikilinkTargetFor(summary), null)
}

/** Scroll `el` by one of the page keys. */
export function scrollPage(el: HTMLElement, action: ScrollAction): void {
  const max = el.scrollHeight
  if (action === 'scrollToTop') el.scrollTop = 0
  else if (action === 'scrollToBottom') el.scrollTop = max
  else {
    const step = Math.round(el.clientHeight * PAGE_STEP)
    el.scrollTop = Math.max(0, Math.min(max, el.scrollTop + (action === 'scrollPageDown' ? step : -step)))
  }
}

/** The nearest ancestor of `el` (itself included) that scrolls vertically. */
export function scrollContainerOf(el: Element | null): HTMLElement | null {
  for (let cur = el; cur; cur = cur.parentElement) {
    if (!(cur instanceof HTMLElement)) continue
    const overflow = getComputedStyle(cur).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return cur
  }
  return null
}

/** The body element of this object in the view `root` (`[data-object-path]` under `[data-object-view]`). */
function bodyOf(root: HTMLElement | null, path: string): Element | null {
  for (const el of root?.querySelectorAll('[data-object-path]') ?? []) {
    if (el.getAttribute('data-object-path') === path) return el
  }
  return null
}

/** Nothing in particular holds it: the page itself (`<body>`, the document, the window) or nothing at all. */
export const isDocumentLevel = (n: unknown) => n == null || n === document.body || n === document.documentElement || n === document || n === window

/**
 * Whether a key event belongs to the object view whose root (`[data-object-view]`) is `root`:
 * focus (the event's target or the active element) is inside it, or inside the peek's own dialog
 * frame for a peek; or, with focus on the body, this is the main page (not an object in the side
 * panel) and no dialog (Settings, any other), collection peek or object peek is open over it.
 * The page keys, Ctrl+E/Ctrl+I and Pin all ask it, so a hidden or second view never acts.
 */
export function keyIsForView(e: KeyboardEvent, root: HTMLElement | null, mode: 'page' | 'peek'): boolean {
  if (!root || !root.isConnected) return false
  const active = document.activeElement
  const inside = (n: unknown, box: Element) => !isDocumentLevel(n) && n instanceof Node && box.contains(n)
  if (inside(e.target, root) || inside(active, root)) return true
  if (mode === 'peek') {
    const frame = root.closest('[role="dialog"]')
    return !!frame && (inside(e.target, frame) || inside(active, frame))
  }
  if (!isDocumentLevel(active) || !isDocumentLevel(e.target)) return false
  return (
    root.closest('[data-sidepanel-entry]') === null &&
    document.querySelector('[role="dialog"], [role="alertdialog"]') === null &&
    useCollectionPeek.getState().id === null &&
    usePeek.getState().path === null
  )
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text)
    showToast(DEEP_LINK_TEXT.copied)
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e))
  }
}

export interface PageShortcutsOptions {
  mode: 'page' | 'peek' | 'inline'
  path: string
  summary: Pick<ObjectSummary, 'title' | 'path'> | undefined
  editorRef: RefObject<BodyEditorHandle | null>
  /** The view's root element (`[data-object-view]`): the keys act only for this view (`keyIsForView`). */
  rootRef: RefObject<HTMLElement | null>
  /** Writes the deep link (tests); the clipboard and a toast by default. */
  copy?: (text: string) => void
}

/** Bind the Page group's keys for the object view showing `path`. */
export function usePageShortcuts({ mode, path, summary, editorRef, rootRef, copy }: PageShortcutsOptions): void {
  const live = useRef({ summary, copy })
  useEffect(() => {
    live.current = { summary, copy }
  })
  useEffect(() => {
    if (mode === 'inline') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const root = rootRef.current
      if (!keyIsForView(e, root, mode)) return
      if (matches(e, keysFor('copyDeepLink'))) {
        const s = live.current.summary
        if (!s) return
        e.preventDefault()
        const link = deepLinkFor(s)
        if (live.current.copy) live.current.copy(link)
        else void copyToClipboard(link)
        return
      }
      if (matches(e, keysFor('selectAllTopLevelBlocks'))) {
        const select = editorRef.current?.selectTopLevelBlocks
        if (!select) return
        e.preventDefault()
        select()
        return
      }
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return
      const action = SCROLL_ACTIONS.find((id) => matches(e, keysFor(id)))
      if (!action) return
      const scroller = scrollContainerOf(bodyOf(root, path))
      if (!scroller) return
      e.preventDefault()
      scrollPage(scroller, action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, path, editorRef, rootRef])
}
