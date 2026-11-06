// M22 Task 1 stub: a `floorItems` value as plain text, never edited here. Task 11 fills it in
// (rows "place | what" with a collect checkbox; "{collected}/{N} collected" in a table).
import type { FloorItemValue } from '@/api/types'
import type { CellProps } from './types'

export function FloorItemsCell({ value }: CellProps<FloorItemValue[] | null>) {
  const items = Array.isArray(value) ? value : []
  if (items.length === 0) return <p className="truncate py-0.5 text-[15px] text-fg-muted">—</p>
  return (
    <ul className="py-0.5 text-[15px] text-fg">
      {items.map((f) => (
        <li key={f.id} className="truncate">
          {[f.place, f.what].filter(Boolean).join(' | ')}
        </li>
      ))}
    </ul>
  )
}
