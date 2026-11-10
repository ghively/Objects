/**
 * M28: the computed other sides of relations pointing at this object ("Runs", "Documented in"),
 * shown as editable property rows after the type's own properties. Rows with the same key (Script,
 * Command and Runbook "Documented in") merge into one row; an edit writes the stored side of each
 * other object (`api.editCounterpart`), never this object's file.
 *
 * Task 1 stub: the props are the Contract's; Task 9 renders the rows.
 */
import type { ReactNode } from 'react'
import type { CounterpartRow, PropertyDef } from '@/api/types'

export const COUNTERPART_TEXT = {
  /** The picker's hint when the merged row's sources are several types. */
  mixed: 'Pick an object of {types}.',
}

export interface CounterpartRowsProps {
  /** `ObjectDetail.counterparts`: one per source type and key. */
  rows: CounterpartRow[]
  /** The type's virtual counterpart definitions (`TypeDef.counterparts`). */
  defs: PropertyDef[]
  /** Chips only, no picker or remove. */
  readOnly?: boolean
  /** Add or remove other objects on the row with `key`. */
  onEdit(key: string, add: string[], remove: string[]): Promise<void>
  onOpenObject?(path: string): void
}

export function CounterpartRows(props: CounterpartRowsProps): ReactNode {
  void props
  return null
}
