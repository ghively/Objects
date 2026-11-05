import { placeholderFor } from '../format'
import type { CellProps } from './types'

/**
 * M12 `uniqueId`: the object's ID (`TASK-12`, or `12` without a prefix), never editable here: the
 * server writes it at create (or "Number existing objects"). Empty shows the muted placeholder.
 */
export function IdCell({ def, value, density, inTable }: CellProps<string | number | null>) {
  const text = value === null || value === undefined ? '' : String(value).trim()
  if (!text) return <span className="text-[15px] text-fg-muted">{placeholderFor(def, inTable ? 'table' : density)}</span>
  return (
    <span className={`block text-[15px] text-fg tabular-nums ${density === 'table' ? 'truncate' : 'break-words'}`} data-testid="id-cell">
      {text}
    </span>
  )
}
