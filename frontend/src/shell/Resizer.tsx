/**
 * A drag handle: `x` resizes widths (a vertical bar), `y` resizes heights (a horizontal bar). It
 * reports the distance dragged since the press while dragging, and once more on release, so the
 * caller previews live and writes the layout only on pointer up.
 */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/utils'

export interface ResizerProps {
  direction: 'x' | 'y'
  label: string
  /** Distance in px from where the drag started (right/down positive). */
  onDrag(delta: number): void
  /** The drag ended (pointer up) after moving `delta` px. */
  onEnd(delta: number): void
  /** A double click on the handle (the side panel's goes back to its default width). */
  onDoubleClick?(): void
  className?: string
}

export function Resizer({ direction, label, onDrag, onEnd, onDoubleClick, className }: ResizerProps) {
  const start = useRef<{ pos: number; id: number } | null>(null)
  const posOf = (e: ReactPointerEvent) => (direction === 'x' ? e.clientX : e.clientY)

  const finish = (e: ReactPointerEvent) => {
    const s = start.current
    if (!s) return
    start.current = null
    try {
      e.currentTarget.releasePointerCapture?.(s.id)
    } catch {
      /* capture already gone */
    }
    onEnd(posOf(e) - s.pos)
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={direction === 'x' ? 'vertical' : 'horizontal'}
      data-direction={direction}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        start.current = { pos: posOf(e), id: e.pointerId }
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId)
        } catch {
          /* not capturable (tests) */
        }
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (s) onDrag(posOf(e) - s.pos)
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={onDoubleClick}
      className={cn(
        'shrink-0 touch-none select-none bg-transparent transition-colors hover:bg-line',
        direction === 'x' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
        className,
      )}
    />
  )
}
