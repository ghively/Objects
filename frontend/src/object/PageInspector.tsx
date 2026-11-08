/**
 * The page's floating inspector (M9, on every page, which took
 * over the old encyclopedia sidebar's table of contents and text stats):
 * - "Outline": the page's headings in order; a click scrolls to the heading. Empty: "No headings
 *   in this page". The headings are read from the rendered body (an embed's own headings, inside
 *   a non-editable node view, are left out) and follow edits.
 * - "Stats": words, sentences, paragraphs, characters, "Created at" (not for daily notes) and
 *   "Last updated" (`textStats.ts`), counted on the page's Markdown.
 * - "Pin" / "Unpin": a pinned inspector opens with every page (kept per viewer in localStorage).
 * The look follows the whiteboard's `FloatingInspector`; the toggle button ("Inspector") and its
 * place are our choice, as there.
 */
import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { ObjectSummary } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { plainText, statRows, textStats, type StatRow } from './textStats'

export type PageInspectorTab = 'outline' | 'stats'

/** The inspector's strings, plus our toggle's name. */
export const PAGE_INSPECTOR_TEXT = {
  outline: 'Outline',
  stats: 'Stats',
  emptyOutline: 'This page has no headings',
  pin: 'Pin',
  unpin: 'Unpin',
  /** Our string (as the whiteboard's toggle). */
  inspector: 'Inspector',
} as const

const PIN_KEY = 'object.page.inspectorPinned'

/** Whether this viewer pinned the page inspector open (a per-viewer convenience). */
export function loadPageInspectorPinned(): boolean {
  try {
    return localStorage.getItem(PIN_KEY) === '1'
  } catch {
    return false
  }
}

export function savePageInspectorPinned(pinned: boolean): void {
  try {
    if (pinned) localStorage.setItem(PIN_KEY, '1')
    else localStorage.removeItem(PIN_KEY)
  } catch {
    /* storage blocked: the pin lasts for this visit */
  }
}

interface Heading {
  level: number
  text: string
  el: HTMLElement
}

/** The page's own headings: in the editor, not inside a non-editable node view (an embed). */
function readHeadings(root: HTMLElement | null): Heading[] {
  if (!root) return []
  const scope = root.querySelector<HTMLElement>('.ProseMirror') ?? root
  const out: Heading[] = []
  for (const el of scope.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
    const ce = el.closest('[contenteditable]')
    if (ce && ce !== scope && ce.getAttribute('contenteditable') === 'false') continue
    const text = el.textContent?.trim() ?? ''
    if (text) out.push({ level: Number(el.tagName[1]), text, el })
  }
  return out
}

/** Bumps when the body's DOM changes (debounced), so the outline and stats follow edits. */
function useBodyRevision(ref: RefObject<HTMLElement | null>): number {
  const [rev, setRev] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof MutationObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | null = null
    const mo = new MutationObserver(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setRev((r) => r + 1), 300)
    })
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => {
      mo.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [ref])
  return rev
}

export interface PageInspectorProps {
  /** The element holding the page body; its headings make the Outline. */
  bodyRef: RefObject<HTMLElement | null>
  /** The page's current Markdown body (the editor's, with unsaved edits). */
  getMarkdown(): string
  summary: ObjectSummary
  dailyNote: boolean
  pinned: boolean
  onPin(pinned: boolean): void
  initialTab?: PageInspectorTab
}

const TABS: { id: PageInspectorTab; label: string }[] = [
  { id: 'outline', label: PAGE_INSPECTOR_TEXT.outline },
  { id: 'stats', label: PAGE_INSPECTOR_TEXT.stats },
]

export function PageInspector({
  bodyRef,
  getMarkdown,
  summary,
  dailyNote,
  pinned,
  onPin,
  initialTab = 'outline',
}: PageInspectorProps) {
  const [tab, setTab] = useState<PageInspectorTab>(initialTab)
  const rev = useBodyRevision(bodyRef)
  const [outline, setOutline] = useState<Heading[]>([])
  // Read after the body has rendered (the ref is set by then), and again on each change.
  useEffect(() => {
    setOutline(readHeadings(bodyRef.current))
  }, [bodyRef, rev])
  const rows = useMemo(
    () => (tab === 'stats' ? statRows(textStats(plainText(getMarkdown())), summary, { dailyNote }) : []),
    // `rev` re-reads the Markdown after an edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, rev, summary, dailyNote, getMarkdown],
  )
  const minLevel = outline.reduce((m, h) => Math.min(m, h.level), 6)

  return (
    <div
      role="complementary"
      aria-label={PAGE_INSPECTOR_TEXT.inspector}
      data-testid="page-inspector"
      className="flex max-h-[60vh] w-[260px] flex-col rounded-xl border border-line bg-raised text-[13px] text-fg shadow-lg"
    >
      <div className="flex items-center gap-1 border-b border-line p-1">
        <div role="tablist" className="flex flex-1 gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={cn(
                'rounded-md px-2 py-1 text-fg-muted hover:bg-hover hover:text-fg',
                tab === t.id && 'bg-hover text-fg',
              )}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={pinned ? PAGE_INSPECTOR_TEXT.unpin : PAGE_INSPECTOR_TEXT.pin}
          title={pinned ? PAGE_INSPECTOR_TEXT.unpin : PAGE_INSPECTOR_TEXT.pin}
          aria-pressed={pinned}
          className="flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
          onClick={() => onPin(!pinned)}
        >
          <Icon name={pinned ? 'ph-push-pin-slash' : 'ph-push-pin'} size={14} />
        </button>
      </div>
      <div role="tabpanel" className="overflow-y-auto p-1">
        {tab === 'outline' &&
          (outline.length === 0 ? (
            <p className="px-2 py-3 text-fg-muted">{PAGE_INSPECTOR_TEXT.emptyOutline}</p>
          ) : (
            <ul data-testid="inspector-outline">
              {outline.map((h, i) => (
                <li key={i}>
                  <button
                    type="button"
                    data-level={h.level}
                    className="w-full truncate rounded-md py-1 pr-2 text-left hover:bg-hover"
                    style={{ paddingLeft: 8 + (h.level - minLevel) * 12 }}
                    onClick={() => h.el.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  >
                    {h.text}
                  </button>
                </li>
              ))}
            </ul>
          ))}
        {tab === 'stats' && <TextStatsRows rows={rows} testId="inspector-stats" />}
      </div>
    </div>
  )
}

/** The stats rows, shared with the `…` menu's "Text Stats". */
export function TextStatsRows({ rows, testId }: { rows: StatRow[]; testId?: string }) {
  return (
    <div data-testid={testId} className="flex flex-col gap-1 px-2 py-1">
      {rows.map((r) =>
        r.kind === 'count' ? (
          <div key={r.key} data-stat={r.key}>
            <span className="tabular-nums">{r.value}</span> <span className="text-fg-muted">{r.label}</span>
          </div>
        ) : (
          <div key={r.key} data-stat={r.key} className="flex justify-between gap-3">
            <span className="text-fg-muted">{r.label}</span>
            <span className="text-right tabular-nums">{r.value}</span>
          </div>
        ),
      )}
    </div>
  )
}
