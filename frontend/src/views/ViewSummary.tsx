// "Show details": a one-line summary of the view's filters, sorts and grouping.
import type { Filter, FilterGroup, ViewState } from '@/api/types'
import { FILTER_OPTIONS } from './filter'
import type { PropChoice } from './properties'

function filters(group: FilterGroup): Filter[] {
  return group.elements.flatMap((e) => (e.type === 'filter' ? [e] : filters(e)))
}

export function viewSummaryParts(state: ViewState, choices: PropChoice[]): string[] {
  const name = (key: string) => choices.find((c) => c.key === key)?.name ?? key
  const parts: string[] = []
  const fs = filters(state.filterGroup)
  if (fs.length) {
    const text = fs
      .map((f) => {
        const kind = choices.find((c) => c.key === f.propertyId)?.kind
        const label = (kind ? FILTER_OPTIONS[kind] : undefined)?.find((o) => o.key === f.option)?.label ?? f.option
        return `${name(f.propertyId)} ${label}`
      })
      .join(', ')
    parts.push(`Filtered by ${text}`)
  }
  if (state.sorts.length) parts.push(`Sorted by ${state.sorts.map((s) => name(s.propertyId)).join(', ')}`)
  const g = state.groupBy?.groups?.[0]
  if (g) parts.push(`Grouped by ${name(g.propertyId)}`)
  return parts
}

export function ViewSummary({
  state,
  choices,
  pausedHint,
}: {
  state: ViewState
  choices: PropChoice[]
  pausedHint?: string
}) {
  const parts = viewSummaryParts(state, choices)
  if (parts.length === 0 && !pausedHint) return null
  return (
    <div data-testid="view-summary" className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-fg-muted">
      {parts.map((p) => (
        <span key={p}>{p}</span>
      ))}
      {pausedHint && <span>{pausedHint}</span>}
    </div>
  )
}
