import type { Row, TypeDef } from '@/api/types'
import { InlineToken } from '../cards/InlineToken'
import { MIN_ROW_HEIGHT } from '../model'

export interface ListLayoutProps {
  rows: Row[]
  typesById: Record<string, TypeDef>
  /** The view spans several types: rows show a type chip. */
  multiType: boolean
  onOpen(row: Row, e: React.MouseEvent): void
}

/** Rows of `InlineToken` (icon and title, a type chip when the view spans types), 40 px minimum. */
export function ListLayout({ rows, typesById, multiType, onOpen }: ListLayoutProps) {
  return (
    <ul role="list" className="flex flex-col">
      {rows.map((row) => (
        <li key={row.summary.path} data-path={row.summary.path} style={{ minHeight: MIN_ROW_HEIGHT }} className="flex">
          <button
            type="button"
            onClick={(e) => onOpen(row, e)}
            className="flex w-full min-w-0 items-center rounded-md px-2 text-left hover:bg-hover"
            style={{ minHeight: MIN_ROW_HEIGHT }}
          >
            <InlineToken row={row} type={typesById[row.summary.type]} showType={multiType} />
          </button>
        </li>
      ))}
    </ul>
  )
}
