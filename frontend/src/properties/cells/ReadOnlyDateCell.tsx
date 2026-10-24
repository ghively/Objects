import type { DateValue } from '@/api/types'
import { formatDate } from '../format'
import type { CellProps } from './types'

/** Created at and Last updated: the timestamp, never editable. */
export function ReadOnlyDateCell({ value }: CellProps<string | DateValue | null>) {
  const v: DateValue | null =
    typeof value === 'string' ? { start: value, resolution: /T/.test(value) ? 'time' : 'day' } : value
  const text = formatDate(v)
  return <p className="text-[15px] text-fg-muted">{text || '—'}</p>
}
