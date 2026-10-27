/**
 * `objectFrame`: a dashed 3 px border (`whiteboard.css`), transparent unless it has a
 * `fillColor`, always behind content (its `z`, from the projection). When it has a `title` the
 * title bar shows above it; double-click on the title edits it (Enter or blur saves, Escape
 * cancels; an emptied title is removed, like "Remove frame title").
 */
import { memo, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import type { WhiteboardNodeProps } from '../canvasTypes'
import { borderStyle, fillStyle } from '../colors'
import { useBoardActions } from '../store'
import { WB } from '../strings'
import { NodeChrome, useNodeEditable } from './NodeChrome'

/** Height of the title bar above the frame, and its gap (our choice: the embed caption's values). */
const TITLE_HEIGHT = 'var(--whiteboard-embed-caption-height, 30px)'
const TITLE_GAP = 'var(--whiteboard-embed-caption-gap, 6px)'

function FrameNodeImpl({ id, data, selected }: WhiteboardNodeProps) {
  const node = data.node
  const actions = useBoardActions()
  const editable = useNodeEditable(node)
  const [draft, setDraft] = useState<string | null>(null)
  const title = typeof node.title === 'string' ? node.title : undefined

  const startEdit = (e: ReactMouseEvent) => {
    if (!editable) return
    e.stopPropagation()
    setDraft(title ?? '')
  }

  const commit = () => {
    if (draft === null) return
    const next = draft.trim()
    setDraft(null)
    if (next === (title ?? '').trim()) return
    if (next === '') actions.removeFrameTitle(id)
    else actions.updateNode(id, { title: next })
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') commit()
    else if (e.key === 'Escape') setDraft(null)
  }

  return (
    <NodeChrome node={node} selected={!!selected}>
      {(title !== undefined || draft !== null) && (
        <div
          className="absolute left-0 flex max-w-full items-end"
          style={{ height: TITLE_HEIGHT, top: `calc(-1 * (${TITLE_HEIGHT} + ${TITLE_GAP}))` }}
          data-testid="whiteboard-frame-title"
          onDoubleClick={startEdit}
        >
          {draft !== null ? (
            <input
              autoFocus
              className="nodrag nopan w-64 rounded-md bg-transparent px-1 text-[15px] font-medium text-fg outline-none"
              value={draft}
              aria-label={WB.toolFrame.text}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={onKeyDown}
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="truncate px-1 text-[15px] font-medium text-fg-muted">{title}</span>
          )}
        </div>
      )}
      <div
        className="whiteboard-shape-surface box-border h-full w-full"
        style={{ background: 'transparent', ...fillStyle(node.fillColor), ...borderStyle(node.borderColor) }}
        data-testid="whiteboard-frame-node"
      />
    </NodeChrome>
  )
}

export const FrameNode = memo(FrameNodeImpl)
