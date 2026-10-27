/**
 * Block handles (Task 12), one overlay per editor: hovering any block (top
 * level or inside a container) shows a drag handle (`ph-dots-six-vertical`)
 * and a `+` (`ph-plus`) at its left, with Object's tooltips
 * (`RenderBlock.dragHandleTooltip`, `.plusHandleTooltip`, the `<b>` drawn bold).
 *
 * `+` inserts an empty paragraph below (Shift-click: above) and opens the `/`
 * menu in it. Clicking the drag handle selects the block and opens the block
 * menu; dragging it moves the block (ProseMirror's drag of a node selection).
 * While two or more blocks are selected a pill shows "{count} blocks"
 * (`EditorPanel.selectionStats.blocks`).
 */
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/Icon'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { blockSelectionRange, insertBlock, selectBlocks } from '../extensions/blockSelection'
import { openSlashMenu } from '../extensions/slashMenu'
import { BLOCK_PARENTS, leafBlockAt } from '../nodes/blockOptions'
import { BlockMenu } from './BlockMenu'
import { startBlockDrag } from './dragMove'
import './handles.css'

export const HANDLE_TEXT = {
  drag: '<b>Drag</b> to move block around\n\n<b>Click</b> to show block options', // RenderBlock.dragHandleTooltip
  plus: '<b>Click</b> to insert block below\n\n<b>Shift-click</b> to insert block above', // RenderBlock.plusHandleTooltip
  /** EditorPanel.selectionStats.blocks: "{count} block | {count} blocks" */
  blocks: (count: number) => `${count} ${count === 1 ? 'block' : 'blocks'}`,
}

/** Object's tooltip markup (`<b>…</b>`, blank lines) as React nodes. */
export function richText(s: string): ReactNode {
  return s.split(/(<b>.*?<\/b>)/).map((part, i) => {
    const bold = /^<b>(.*)<\/b>$/.exec(part)
    return bold ? <b key={i}>{bold[1]}</b> : <Fragment key={i}>{part}</Fragment>
  })
}

/** The block a DOM node inside the editor belongs to (deepest block whose parent is a block parent). */
export function blockAtDOM(editor: Editor, target: Node): { node: PMNode; pos: number } | null {
  const { view } = editor
  if (!view.dom.contains(target) || target === view.dom) return null
  let pos: number
  try {
    pos = view.posAtDOM(target, 0)
  } catch {
    return null
  }
  if (pos < 0 || pos > view.state.doc.content.size) return null
  const $pos = view.state.doc.resolve(pos)
  const leaf = leafBlockAt($pos)
  if (leaf) return leaf
  const after = $pos.nodeAfter
  if (after && BLOCK_PARENTS.has($pos.parent.type.name)) return { node: after, pos }
  return null
}

type Hover = { pos: number; rect: DOMRect }

function rectOf(editor: Editor, pos: number): DOMRect | null {
  const dom = editor.view.nodeDOM(pos)
  return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null
}

const HANDLE_WIDTH = 40

export function BlockHandles({ editor }: { editor: Editor }) {
  const [hover, setHover] = useState<Hover | null>(null)
  const [menu, setMenu] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [selected, setSelected] = useState(0)
  const [editorRect, setEditorRect] = useState<DOMRect | null>(null)
  const overHandles = useRef(false)
  const menuOpen = menu !== null

  // Follow the pointer over the editor's blocks.
  useEffect(() => {
    const dom = editor.view.dom
    const onOver = (e: MouseEvent) => {
      if (menuOpen) return
      const block = blockAtDOM(editor, e.target as Node)
      if (!block) return
      const rect = rectOf(editor, block.pos)
      if (rect) setHover((h) => (h && h.pos === block.pos && h.rect.top === rect.top ? h : { pos: block.pos, rect }))
    }
    const onLeave = () => {
      window.setTimeout(() => {
        if (!overHandles.current && !menuOpen) setHover(null)
      }, 120)
    }
    dom.addEventListener('mouseover', onOver)
    dom.addEventListener('mouseleave', onLeave)
    return () => {
      dom.removeEventListener('mouseover', onOver)
      dom.removeEventListener('mouseleave', onLeave)
    }
  }, [editor, menuOpen])

  // A change to the document or a scroll moves blocks: drop the handles; track the selection count.
  useEffect(() => {
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged && !menuOpen) setHover(null)
      const range = blockSelectionRange(editor.state)
      const count = range ? range.blocks.length : 0
      setSelected(count)
      setEditorRect(count >= 2 ? editor.view.dom.getBoundingClientRect() : null)
    }
    const onScroll = () => {
      if (!menuOpen) setHover(null)
    }
    editor.on('transaction', onTransaction)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      editor.off('transaction', onTransaction)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [editor, menuOpen])

  const onPlus = useCallback(
    (e: React.MouseEvent) => {
      if (!hover) return
      e.preventDefault()
      selectBlocks(editor, hover.pos)
      insertBlock(editor, e.shiftKey ? 'above' : 'below')
      openSlashMenu(editor)
      setHover(null)
    },
    [editor, hover],
  )

  const onDragHandleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!hover) return
      e.preventDefault()
      selectBlocks(editor, hover.pos)
      const r = e.currentTarget.getBoundingClientRect()
      setMenu({ left: r.left, top: r.top, width: r.width, height: r.height })
    },
    [editor, hover],
  )

  const handles =
    hover &&
    createPortal(
      <TooltipProvider delayDuration={300}>
        <div
          className="block-handles"
          data-block-handles=""
          data-pos={hover.pos}
          style={{ left: Math.max(0, hover.rect.left - HANDLE_WIDTH - 4), top: hover.rect.top }}
          onMouseEnter={() => {
            overHandles.current = true
          }}
          onMouseLeave={() => {
            overHandles.current = false
            if (!menuOpen) setHover(null)
          }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="block-handle" aria-label="+" onMouseDown={(e) => e.preventDefault()} onClick={onPlus}>
                <Icon name="ph-plus" size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="block-handle-tooltip">
              {richText(HANDLE_TEXT.plus)}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="block-handle"
                aria-label="⋮⋮"
                draggable
                data-drag-handle=""
                onMouseDown={(e) => e.stopPropagation()}
                onDragStart={(e) => startBlockDrag(editor, hover.pos, e.nativeEvent)}
                onClick={onDragHandleClick}
              >
                <Icon name="ph-dots-six-vertical" size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="block-handle-tooltip">
              {richText(HANDLE_TEXT.drag)}
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>,
      document.body,
    )

  return (
    <>
      {handles}
      <BlockMenu
        editor={editor}
        open={menuOpen}
        anchor={menu}
        onOpenChange={(open) => {
          if (!open) {
            setMenu(null)
            setHover(null)
          }
        }}
      />
      {selected >= 2 &&
        createPortal(
          <div
            className="block-selection-pill"
            role="status"
            style={{
              left: editorRect ? editorRect.left + editorRect.width / 2 : '50%',
              bottom: 24,
            }}
          >
            {HANDLE_TEXT.blocks(selected)}
          </div>,
          document.body,
        )}
    </>
  )
}
