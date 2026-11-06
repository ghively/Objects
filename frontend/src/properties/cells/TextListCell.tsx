// M22 Task 1 stub: a `textList` value as plain text, never edited here. Task 11 fills it in
// (one line per item in the panel; the items joined with " · " in a table).
import type { CellProps } from './types'

export function TextListCell({ value }: CellProps<string[] | null>) {
  const items = Array.isArray(value) ? value : []
  return <p className="truncate py-0.5 text-[15px] text-fg">{items.length ? items.join(' · ') : '—'}</p>
}
