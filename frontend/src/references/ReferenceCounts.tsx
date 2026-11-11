// The quiet count beside a note's header items (the M32 walk's W10): "2 backlinks · 1 mention",
// each part only when it is not zero, nothing at all when both are. The references section sits
// under the text, below the window on most notes; this says above the fold that there is
// something there. A click (or Enter) on a part scrolls to the section and opens that tab. The
// numbers are the section's own (`referenceCounts.ts`): nothing is fetched here.
import { Fragment } from 'react'
import { askForReferencesTab, useReferenceCounts, type CountedTab } from './referenceCounts'

/** Our strings. */
export const REFERENCE_COUNTS_TEXT = {
  backlinks: (n: number) => `${n} ${n === 1 ? 'backlink' : 'backlinks'}`,
  mentions: (n: number) => `${n} ${n === 1 ? 'mention' : 'mentions'}`,
  /** The tooltip of a part. */
  show: 'Show below',
} as const

export function ReferenceCounts({ path }: { path: string }) {
  const counts = useReferenceCounts(path)
  if (!counts) return null
  const parts: [CountedTab, string][] = []
  if (counts.backlinks > 0) parts.push(['backlinks', REFERENCE_COUNTS_TEXT.backlinks(counts.backlinks)])
  if (counts.mentions > 0) parts.push(['mentions', REFERENCE_COUNTS_TEXT.mentions(counts.mentions)])
  if (parts.length === 0) return null
  return (
    <span data-testid="reference-counts" className="inline-flex items-center text-[13px] text-fg-muted">
      {parts.map(([tab, text], i) => (
        <Fragment key={tab}>
          {i > 0 && <span aria-hidden="true">{' · '}</span>}
          <button
            type="button"
            title={REFERENCE_COUNTS_TEXT.show}
            aria-label={text}
            onClick={() => askForReferencesTab(path, tab)}
            className="rounded-md px-1 py-0.5 hover:bg-hover hover:text-fg"
          >
            {text}
          </button>
        </Fragment>
      ))}
    </span>
  )
}
