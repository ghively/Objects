/**
 * The floating inspector (M8), top right over the canvas:
 * - "Outline": the headings in the board's text blocks, in reading order; a click zooms to the
 *   block. Empty: "This page has no headings".
 * - "Frames": the frames in reading order; a click zooms to the frame; dragging a row (or
 *   Alt+ArrowUp/Down on it, our choice) reorders them and writes the board's `readingOrder`.
 *   Empty: "This whiteboard has no frames".
 * - "Stats": counts of nodes by kind, connectors, words and ink strokes (our choice of stats).
 * - "Pin" / "Unpin": a pinned inspector opens with the board (kept per viewer in localStorage).
 * The toggle button and its placement are our choice.
 */
import { useMemo, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { WhiteboardData } from '@/api/whiteboardTypes'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { boardOutline, boardStats, frameLabel, move, orderedFrames, type BoardStats } from '../readingOrder'
import { WB } from '../strings'

export type InspectorTab = 'outline' | 'frames' | 'stats'

const PIN_KEY = 'object.whiteboard.inspectorPinned'

/** Whether this viewer pinned the inspector open (a per-viewer convenience). */
export function loadInspectorPinned(): boolean {
  try {
    return localStorage.getItem(PIN_KEY) === '1'
  } catch {
    return false
  }
}

export function saveInspectorPinned(pinned: boolean): void {
  try {
    if (pinned) localStorage.setItem(PIN_KEY, '1')
    else localStorage.removeItem(PIN_KEY)
  } catch {
    /* storage blocked: the pin lasts for this visit */
  }
}

export interface FloatingInspectorProps {
  board: WhiteboardData
  strokes?: readonly unknown[]
  /** Reordering frames writes the board; off on a locked or read-only board. */
  editable: boolean
  pinned: boolean
  onPin(pinned: boolean): void
  /** Zoom the canvas to a node (a heading's block or a frame). */
  onZoomTo(nodeId: string): void
  /** The frames in their new reading order. */
  onReorderFrames(frameIds: string[]): void
  initialTab?: InspectorTab
}

const STAT_ROWS: { key: keyof BoardStats; label: string }[] = [
  { key: 'text', label: WB.statText.text },
  { key: 'objects', label: WB.statObjects.text },
  { key: 'media', label: WB.statMedia.text },
  { key: 'weblinks', label: WB.statWeblinks.text },
  { key: 'shapes', label: WB.statShapes.text },
  { key: 'frames', label: WB.statFrames.text },
  { key: 'connectors', label: WB.statConnectors.text },
  { key: 'words', label: WB.statWords.text },
  { key: 'strokes', label: WB.statStrokes.text },
]

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'outline', label: WB.inspectorOutline.text },
  { id: 'frames', label: WB.inspectorFrames.text },
  { id: 'stats', label: WB.inspectorStats.text },
]

export function FloatingInspector({
  board,
  strokes = [],
  editable,
  pinned,
  onPin,
  onZoomTo,
  onReorderFrames,
  initialTab = 'outline',
}: FloatingInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>(initialTab)
  const outline = useMemo(() => boardOutline(board), [board])
  const frames = useMemo(() => orderedFrames(board), [board])
  const stats = useMemo(() => boardStats(board, strokes), [board, strokes])
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const minLevel = outline.reduce((m, h) => Math.min(m, h.level), 6)

  const reorder = (from: number, to: number) => {
    if (!editable || from === to) return
    onReorderFrames(move(frames.map((f) => f.id), from, to))
  }

  const onDrop = (e: DragEvent, to: number) => {
    e.preventDefault()
    const raw = e.dataTransfer?.getData('application/x-object-frame-index')
    const from = dragFrom ?? (raw ? Number(raw) : NaN)
    setDragFrom(null)
    setDragOver(null)
    if (Number.isInteger(from)) reorder(from, to)
  }

  const onRowKey = (e: KeyboardEvent, i: number) => {
    if (!e.altKey) return
    if (e.key === 'ArrowUp' && i > 0) {
      e.preventDefault()
      reorder(i, i - 1)
    } else if (e.key === 'ArrowDown' && i < frames.length - 1) {
      e.preventDefault()
      reorder(i, i + 1)
    }
  }

  return (
    <div
      role="complementary"
      aria-label={WB.inspector.text}
      data-testid="whiteboard-inspector"
      className="flex max-h-[60vh] w-[260px] flex-col rounded-xl border border-line bg-raised text-[13px] text-fg shadow-lg"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1 border-b border-line p-1">
        <div role="tablist" className="flex flex-1 gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={cn(
                'rounded-md px-2 py-1 text-fg-muted hover:bg-hover hover:text-fg',
                tab === t.id && 'bg-hover text-fg',
              )}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={pinned ? WB.inspectorUnpin.text : WB.inspectorPin.text}
          title={pinned ? WB.inspectorUnpin.text : WB.inspectorPin.text}
          aria-pressed={pinned}
          className="flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
          onClick={() => onPin(!pinned)}
        >
          <Icon name={pinned ? 'ph-push-pin-slash' : 'ph-push-pin'} size={14} />
        </button>
      </div>
      <div role="tabpanel" className="overflow-y-auto p-1">
        {tab === 'outline' &&
          (outline.length === 0 ? (
            <p className="px-2 py-3 text-fg-muted">{WB.inspectorEmptyOutline.text}</p>
          ) : (
            <ul data-testid="inspector-outline">
              {outline.map((h, i) => (
                <li key={`${h.nodeId}-${i}`}>
                  <button
                    type="button"
                    data-level={h.level}
                    className="w-full truncate rounded-md py-1 pr-2 text-left hover:bg-hover"
                    style={{ paddingLeft: 8 + (h.level - minLevel) * 12 }}
                    onClick={() => onZoomTo(h.nodeId)}
                  >
                    {h.text}
                  </button>
                </li>
              ))}
            </ul>
          ))}
        {tab === 'frames' &&
          (frames.length === 0 ? (
            <p className="px-2 py-3 text-fg-muted">{WB.inspectorEmptyFrames.text}</p>
          ) : (
            <ol data-testid="inspector-frames">
              {frames.map((f, i) => (
                <li
                  key={f.id}
                  data-frame-id={f.id}
                  draggable={editable}
                  onDragStart={(e) => {
                    setDragFrom(i)
                    e.dataTransfer?.setData('application/x-object-frame-index', String(i))
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(e) => {
                    if (!editable) return
                    e.preventDefault()
                    setDragOver(i)
                  }}
                  onDragLeave={() => setDragOver((o) => (o === i ? null : o))}
                  onDragEnd={() => {
                    setDragFrom(null)
                    setDragOver(null)
                  }}
                  onDrop={(e) => onDrop(e, i)}
                  className={cn('rounded-md', dragOver === i && dragFrom !== i && 'ring-1 ring-line')}
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-hover"
                    onClick={() => onZoomTo(f.id)}
                    onKeyDown={(e) => onRowKey(e, i)}
                  >
                    <span className="w-5 shrink-0 text-right text-fg-muted tabular-nums">{i + 1}</span>
                    <Icon name="ph-frame-corners" size={14} />
                    <span className="truncate">{frameLabel(f)}</span>
                  </button>
                </li>
              ))}
            </ol>
          ))}
        {tab === 'stats' && (
          <dl data-testid="inspector-stats" className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-2 py-1">
            {STAT_ROWS.map((r) => (
              <div key={r.key} className="contents" data-stat={r.key}>
                <dt className="text-fg-muted">{r.label}</dt>
                <dd className="text-right tabular-nums">{stats[r.key]}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  )
}
