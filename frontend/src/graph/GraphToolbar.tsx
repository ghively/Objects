// The graph toolbar: "Search for a note in the graph" (Enter focuses the best visible match),
// "Fit graph to view", "Export view as PNG", and the "Customize" popover passed in by the page.
import { useState, type ReactNode } from 'react'
import { Icon } from '@/components/Icon'

export const TOOLBAR_TEXT = {
  search: 'Search for a note in the graph',
  fit: 'Fit graph to view',
  exportPng: 'Export view as PNG',
}

export interface GraphToolbarProps {
  /** Enter in the search field. */
  onSearch(query: string): void
  onFit(): void
  /** "Export view as PNG"; the button shows only when given. */
  onExport?(): void
  /** The `GraphCustomization` popover. */
  customize?: ReactNode
  /** A compact layout for the side panel. */
  compact?: boolean
}

export function GraphToolbar({ onSearch, onFit, onExport, customize, compact }: GraphToolbarProps) {
  const [query, setQuery] = useState('')
  return (
    <div role="toolbar" aria-label="Graph" className="flex flex-wrap items-center gap-2">
      <label className={compact ? 'relative min-w-0 flex-1' : 'relative w-72 max-w-full'}>
        <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-fg-muted">
          <Icon name="ph-magnifying-glass" size={14} />
        </span>
        <input
          type="search"
          value={query}
          placeholder={TOOLBAR_TEXT.search}
          aria-label={TOOLBAR_TEXT.search}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSearch(query)
            }
          }}
          className="h-8 w-full rounded-lg border border-line bg-raised pr-2 pl-7 text-[14px] outline-none placeholder:text-fg-muted focus:border-fg-muted"
        />
      </label>
      <button
        type="button"
        onClick={onFit}
        title={TOOLBAR_TEXT.fit}
        aria-label={TOOLBAR_TEXT.fit}
        className="flex size-8 items-center justify-center rounded-lg border border-line bg-raised hover:bg-hover"
      >
        <Icon name="ph-arrows-in-simple" size={14} />
      </button>
      {onExport && (
        // The icon is our choice.
        <button
          type="button"
          onClick={onExport}
          title={TOOLBAR_TEXT.exportPng}
          aria-label={TOOLBAR_TEXT.exportPng}
          className="flex size-8 items-center justify-center rounded-lg border border-line bg-raised hover:bg-hover"
        >
          <Icon name="ph-download-simple" size={14} />
        </button>
      )}
      {customize}
    </div>
  )
}
