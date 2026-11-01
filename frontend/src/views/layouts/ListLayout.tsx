import { memo } from 'react'
import type { Row, TypeDef } from '@/api/types'
import type { RowExtras } from '../DataView'
import { InlineToken } from '../cards/InlineToken'
import { MIN_ROW_HEIGHT } from '../model'
import { cn } from '@/lib/utils'

export interface ListLayoutProps {
  rows: Row[]
  typesById: Record<string, TypeDef>
  /** The view spans several types: rows show a type chip. */
  multiType: boolean
  onOpen(row: Row, e: React.MouseEvent): void
  /** Per-row slots (a task's checkbox and dates), rendered beside the row's button, never inside it. */
  rowExtras?(row: Row): RowExtras
  /** M9: selected rows ("Select multiple") carry `data-selected` and the selection colour. */
  isSelected?(path: string): boolean
}

interface ListRowProps {
  row: Row
  type?: TypeDef
  multiType: boolean
  selected: boolean
  onOpen(row: Row, e: React.MouseEvent): void
  rowExtras?(row: Row): RowExtras
}

/** One list row; re-renders only when its row, type, selection or the callbacks change. */
const ListRow = memo(function ListRow({ row, type, multiType, selected, onOpen, rowExtras }: ListRowProps) {
  const extras = rowExtras?.(row)
  const slotted = extras?.leading != null || extras?.trailing != null
  return (
    <li
      data-path={row.summary.path}
      data-selected={selected || undefined}
      style={{ minHeight: MIN_ROW_HEIGHT }}
      className={cn(slotted ? 'flex items-center' : 'flex', selected && 'rounded-md bg-[var(--block-selection-bg)]')}
    >
      {extras?.leading != null && (
        <span data-slot="leading" className="flex shrink-0 items-center pl-2">
          {extras.leading}
        </span>
      )}
      <button
        type="button"
        onClick={(e) => onOpen(row, e)}
        className={slotted ? 'flex min-w-0 flex-1 items-center rounded-md px-2 text-left hover:bg-hover' : 'flex w-full min-w-0 items-center rounded-md px-2 text-left hover:bg-hover'}
        style={{ minHeight: MIN_ROW_HEIGHT }}
      >
        <InlineToken row={row} type={type} showType={multiType} />
      </button>
      {extras?.trailing != null && (
        <span data-slot="trailing" className="flex shrink-0 items-center gap-2 pr-2">
          {extras.trailing}
        </span>
      )}
    </li>
  )
})

/** Rows of `InlineToken` (icon and title, a type chip when the view spans types), 40 px minimum. */
export function ListLayout({ rows, typesById, multiType, onOpen, rowExtras, isSelected }: ListLayoutProps) {
  return (
    <ul role="list" className="flex flex-col">
      {rows.map((row) => (
        <ListRow
          key={row.summary.path}
          row={row}
          type={typesById[row.summary.type]}
          multiType={multiType}
          selected={isSelected?.(row.summary.path) ?? false}
          onOpen={onOpen}
          rowExtras={rowExtras}
        />
      ))}
    </ul>
  )
}
