import type { PropertyDef } from '@/api/types'

/**
 * What every property cell takes: the definition, the current API value, and `onChange`, which
 * the cell calls with the next value when the user commits an edit (never on mount, never with
 * an unchanged value). A read-only cell shows the value and never calls `onChange`.
 *
 * A caller that writes asynchronously may return a promise resolving to `false` when the write
 * failed (the table does), so a cell that skips repeated saves of one value offers it again.
 */
export interface CellProps<T> {
  def: PropertyDef
  value: T
  readOnly?: boolean
  /** `table`: a compact one-line rendering for a table cell (truncated, smaller pills); default `panel`. */
  density?: 'panel' | 'table'
  /** In a table (wrapped or not): an empty value shows no placeholder. */
  inTable?: boolean
  onChange(next: T): void | Promise<boolean | void>
}

/** The shared look of a cell's text: matches the M1 panel rows. */
export const CELL_TEXT = 'w-full bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-muted'
