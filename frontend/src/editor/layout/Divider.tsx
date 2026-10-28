/**
 * The draggable divider between two columns of a columns block, and the
 * width arithmetic behind it (`widths=40,60`: integers summing to 100, one per
 * column, each at least 10).
 *
 * While dragging, the divider only previews (`onPreview`); the widths are
 * written once, on pointer up (`onCommit`), so a drag is one edit and one
 * changed annotation line.
 */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { Option } from '../annotations'

export const MIN_COLUMN_WIDTH = 10

/** A columns block has 1 to 6 columns (`column{1,6}`). */
export const MAX_COLUMNS = 6

/** Even widths for `n` columns: integers summing to 100, the remainder on the first columns. */
export function evenWidths(n: number): number[] {
  const count = Math.max(1, Math.floor(n))
  const base = Math.floor(100 / count)
  const extra = 100 - base * count
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0))
}

/** The `widths` option when it is valid for `count` columns, else null (even columns). */
export function parseWidths(options: Option[] | null | undefined, count: number): number[] | null {
  const raw = (options ?? []).find((o) => o.key === 'widths')?.value
  if (typeof raw !== 'string' || !/^\d+(?:,\d+)*$/.test(raw)) return null
  const widths = raw.split(',').map(Number)
  if (widths.length !== count) return null
  if (widths.some((w) => w <= 0)) return null
  if (widths.reduce((a, b) => a + b, 0) !== 100) return null
  return widths
}

/**
 * Move the divider after column `index` by `delta` percentage points: the two
 * columns beside it trade width, each stays at least `MIN_COLUMN_WIDTH`, every
 * value is an integer and the sum stays 100.
 */
export function dragWidths(widths: readonly number[], index: number, delta: number): number[] {
  const out = [...widths]
  if (index < 0 || index >= widths.length - 1) return out
  const pair = widths[index] + widths[index + 1]
  const left = Math.min(pair - MIN_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(widths[index] + delta)))
  out[index] = left
  out[index + 1] = pair - left
  return out
}

export type DividerProps = {
  /** The divider sits after column `index` (0-based). */
  index: number
  /** The widths the drag starts from. */
  widths: readonly number[]
  /** The space the columns share (the grid's width minus the gaps), in pixels. */
  trackWidth: () => number
  /** CSS `left` for the divider. */
  left: string
  onPreview: (widths: number[] | null) => void
  onCommit: (widths: number[]) => void
}

export function Divider({ index, widths, trackWidth, left, onPreview, onCommit }: DividerProps) {
  const drag = useRef<{ x: number; width: number; last: number[] } | null>(null)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const width = trackWidth()
    if (!(width > 0)) return
    drag.current = { x: e.clientX, width, last: [...widths] }
    const move = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      d.last = dragWidths(widths, index, ((ev.clientX - d.x) / d.width) * 100)
      onPreview(d.last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const d = drag.current
      drag.current = null
      onPreview(null)
      if (d && d.last.some((w, i) => w !== widths[i])) onCommit(d.last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div
      className="columns-divider"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={widths[index]}
      contentEditable={false}
      style={{ left }}
      onPointerDown={onPointerDown}
    />
  )
}
