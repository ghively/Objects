import type { Row, TypeDef } from '@/api/types'
import type { RowExtras } from '../DataView'
import { InlineToken } from '../cards/InlineToken'
import { MIN_ROW_HEIGHT } from '../model'

export interface ListLayoutProps {
  rows: Row[]
  typesById: Record<string, TypeDef>
  /** The view spans several types: rows show a type chip. */
  multiType: boolean
  onOpen(row: Row, e: React.MouseEvent): void
  /** Per-row slots (a task's checkbox and dates), rendered beside the row's button, never inside it. */
  rowExtras?(row: Row): RowExtras
}

/** Rows of `InlineToken` (icon and title, a type chip when the view spans types), 40 px minimum. */
export function ListLayout({ rows, typesById, multiType, onOpen, rowExtras }: ListLayoutProps) {
  return (
    <ul role="list" className="flex flex-col">
      {rows.map((row) => {
        const extras = rowExtras?.(row)
        const slotted = extras?.leading != null || extras?.trailing != null
        const button = (
          <button
            type="button"
            onClick={(e) => onOpen(row, e)}
            className={slotted ? 'flex min-w-0 flex-1 items-center rounded-md px-2 text-left hover:bg-hover' : 'flex w-full min-w-0 items-center rounded-md px-2 text-left hover:bg-hover'}
            style={{ minHeight: MIN_ROW_HEIGHT }}
          >
            <InlineToken row={row} type={typesById[row.summary.type]} showType={multiType} />
          </button>
        )
        return (
          <li key={row.summary.path} data-path={row.summary.path} style={{ minHeight: MIN_ROW_HEIGHT }} className={slotted ? 'flex items-center' : 'flex'}>
            {extras?.leading != null && (
              <span data-slot="leading" className="flex shrink-0 items-center pl-2">
                {extras.leading}
              </span>
            )}
            {button}
            {extras?.trailing != null && (
              <span data-slot="trailing" className="flex shrink-0 items-center gap-2 pr-2">
                {extras.trailing}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
