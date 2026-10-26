import type { CellProps } from './types'

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** A basic media field (`mimeType`, `fileSize`, `url`…): read-only text. */
export function SystemFieldCell({ value }: CellProps<unknown>) {
  return <p className="truncate py-0.5 text-[15px] text-fg-muted">{show(value)}</p>
}

/** Collections: display-only until M3. */
export function CollectionsCell(_props: CellProps<unknown>) {
  return <p className="py-0.5 text-[15px] text-fg-muted">—</p>
}

/** Backlinks: a count until M5 (`value` is the count, or the list of linking objects). */
export function BacklinksCell({ value }: CellProps<unknown>) {
  const count = typeof value === 'number' ? value : Array.isArray(value) ? value.length : 0
  return <p className="py-0.5 text-[15px] text-fg-muted">{count}</p>
}
