/**
 * `objectBlock`: a text block, or an embedded object (delegated to `EntityNode`), a media file
 * (`MediaNode`) or a web link (`WeblinkNode`) (M8).
 *
 * A text node with no `width`/`height` hugs its content (the model: "While they are absent the
 * node sizes itself to its content — growing in width up to the auto maximum, then wrapping and
 * growing in height. Resizing pins both."): 420 to 480 wide, 60 to 420 tall. Double-click edits
 * the text with `TextBlockEditor`; blur or Escape writes it with one `setBlock` (one undo step).
 */
import { memo, type MouseEvent as ReactMouseEvent } from 'react'
import type { WhiteboardBlock, WhiteboardTextBlock } from '@/api/whiteboardTypes'
import type { WhiteboardNodeProps } from '../canvasTypes'
import { borderStyle, fillStyle } from '../colors'
import { useBoardActions, useBoardState } from '../store'
import { EntityNode } from './EntityNode'
import { MediaNode } from './MediaNode'
import { WeblinkNode } from './WeblinkNode'
import { blockFrameStyle, isAutoSized, NodeChrome, useNodeEditable } from './NodeChrome'

export { blockFrameStyle, isAutoSized }
import { MarkdownView, TextBlockEditor } from './TextBlockEditor'

/** Commits edited Markdown: one `setBlock` when it changed (keeps `align` and unknown keys). */
export function commitText(
  actions: { setBlock(ownerId: string, block: WhiteboardBlock | null): void; endEdit(): void },
  ownerId: string,
  block: WhiteboardBlock | undefined,
  markdown: string,
): void {
  if (block?.type === 'text') {
    if (markdown !== block.markdown) actions.setBlock(ownerId, { ...block, markdown })
  } else if (!block && markdown !== '') {
    actions.setBlock(ownerId, { type: 'text', markdown })
  }
  actions.endEdit()
}

function TextNode({ id, data, selected }: WhiteboardNodeProps) {
  const node = data.node
  const block = data.block as WhiteboardTextBlock | undefined
  const actions = useBoardActions()
  const editing = useBoardState((s) => s.editingId === id)
  const editable = useNodeEditable(node)
  const auto = isAutoSized(node)

  const onDoubleClick = (e: ReactMouseEvent) => {
    if (!editable) return
    e.stopPropagation()
    actions.select([id])
    actions.beginEdit(id)
  }

  return (
    <NodeChrome node={node} selected={!!selected} editing={editing}>
      <div
        className="whiteboard-node-frame relative box-border overflow-hidden"
        style={{
          background: 'var(--color-bg-base)',
          ...blockFrameStyle(node),
          ...fillStyle(node.fillColor),
          ...borderStyle(node.borderColor),
          ...(editing ? { overflow: 'auto' } : {}),
        }}
        data-auto-size={auto ? '' : undefined}
        data-testid="whiteboard-text-node"
        onDoubleClick={onDoubleClick}
      >
        <div className="whiteboard-node-surface box-border text-[15px] leading-[1.5] text-fg">
          {editing ? (
            <TextBlockEditor
              markdown={block?.markdown ?? ''}
              align={block?.align}
              onCommit={(md) => commitText(actions, id, block, md)}
            />
          ) : (
            <MarkdownView markdown={block?.markdown ?? ''} align={block?.align} />
          )}
        </div>
      </div>
    </NodeChrome>
  )
}

function BlockNodeImpl(props: WhiteboardNodeProps) {
  const kind = props.data.block?.type
  if (kind === 'entity') return <EntityNode {...props} />
  if (kind === 'media') return <MediaNode {...props} />
  if (kind === 'weblink') return <WeblinkNode {...props} />
  return <TextNode {...props} />
}

export const BlockNode = memo(BlockNodeImpl)
