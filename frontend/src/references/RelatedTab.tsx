/**
 * The Related Content tab: our lexical stand-in for Capacities' semantic related content (objects
 * sharing this one's strongest terms). "Show more" asks for 20 more.
 */
import type { ObjectSummary, RelatedEntry } from '@/api/types'
import { EmptyState, EntryHeader } from './BacklinksTab'
import { REFERENCES_TEXT } from './referencesUi'

export interface RelatedTabProps {
  entries: RelatedEntry[]
  summaries: Record<string, ObjectSummary>
  /** The limit the entries were asked with: a full page may have more. */
  limit: number
  onShowMore(): void
}

export function RelatedTab({ entries, summaries, limit, onShowMore }: RelatedTabProps) {
  if (entries.length === 0) {
    return <EmptyState title={REFERENCES_TEXT.relatedEmptyTitle} description={REFERENCES_TEXT.relatedEmptyDescription} />
  }
  const list = entries.map((e) => e.path)
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1" data-references-list="related">
        {entries.map((entry) => (
          <li key={entry.path} data-related={entry.path}>
            <EntryHeader path={entry.path} summary={summaries[entry.path]} list={list} />
          </li>
        ))}
      </ul>
      {entries.length >= limit && (
        <button
          type="button"
          onClick={onShowMore}
          className="self-start rounded-md px-2 py-1 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
        >
          {REFERENCES_TEXT.showMore}
        </button>
      )}
    </div>
  )
}
