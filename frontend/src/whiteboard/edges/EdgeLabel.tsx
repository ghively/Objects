/**
 * A connector's label box at the path midpoint (the `[data-whiteboard-edge-label]`
 * rules in `whiteboard.css`). While editing it is a one-line input over the label's Markdown
 * (our choice: Task 10's `TextBlockEditor` belongs to another lane). Enter, Escape or blur
 * commits once; so does an unmount that comes first (the edge left the viewport mid-edit).
 */
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'

export interface EdgeLabelProps {
  edgeId: string
  x: number
  y: number
  /** The label's Markdown (or the deprecated plain label). */
  text: string
  editing: boolean
  selected: boolean
  /** Double-click on the label (start editing). */
  onStartEdit(e: MouseEvent): void
  /** The edited text (called once per edit). */
  onCommit(text: string): void
}

export function EdgeLabel({ edgeId, x, y, text, editing, selected, onStartEdit, onCommit }: EdgeLabelProps) {
  const style = {
    position: 'absolute' as const,
    transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
    pointerEvents: 'all' as const,
  }
  if (!editing && text === '') return null
  return (
    <div
      className="nodrag nopan"
      style={style}
      data-whiteboard-edge-label={edgeId}
      data-whiteboard-edge-selected={selected ? 'true' : 'false'}
      data-whiteboard-active={editing ? '' : undefined}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (!editing) onStartEdit(e)
      }}
    >
      {editing ? <LabelInput initial={text} onCommit={onCommit} /> : text}
    </div>
  )
}

function LabelInput({ initial, onCommit }: { initial: string; onCommit(text: string): void }) {
  const [draft, setDraft] = useState(initial)
  const done = useRef(false)
  const ref = useRef<HTMLInputElement>(null)
  const latest = useRef({ draft, onCommit })
  latest.current = { draft, onCommit }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
  }, [])
  const commit = () => {
    if (done.current) return
    done.current = true
    latest.current.onCommit(latest.current.draft)
  }
  // Unmounted before Enter, Escape or blur: commit the draft. Deferred a microtask so StrictMode's
  // synchronous mount-unmount-mount rehearsal doesn't end the edit.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      queueMicrotask(() => {
        if (!mounted.current) commit()
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault()
      commit()
    }
  }
  return (
    <input
      ref={ref}
      data-whiteboard-edge-label-input=""
      className="bg-transparent outline-none"
      style={{ font: 'inherit', color: 'inherit', border: 'none', padding: 0, width: `${Math.max(draft.length, 1) + 1}ch` }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={commit}
      onPointerDown={(e) => e.stopPropagation()}
    />
  )
}
