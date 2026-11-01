/**
 * The math block's node view (Object's `MathBlock`): the formula rendered
 * with KaTeX in display mode, one row per blank-line-separated part
 * (`renderDisplayMath`); clicking it opens an editing panel with the TeX
 * source and a live preview, "Close" (`blocks.MathBlock.closeEditor`) and the
 * hint "↵ to insert above/below" (`blocks.MathBlock.insertNewBlock`).
 *
 * In the panel, Enter inserts a new paragraph (above when the caret is at the
 * very start of the source, else below) and closes; Shift+Enter is a line
 * break; Escape closes and selects the block. Every change writes the node's
 * `text` attribute, so the file's `$$` block changes only when the TeX does.
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { renderDisplayMath, useMathReady } from './renderMath'

export function MathBlockView({ node, editor, getPos, updateAttributes, selected }: NodeViewProps) {
  const text = String(node.attrs.text ?? '')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const ready = useMathReady()

  // Follow outside changes (undo, an external reload) while the panel is closed.
  useEffect(() => {
    if (!editing) setDraft(text)
  }, [text, editing])

  useEffect(() => {
    if (editing) areaRef.current?.focus()
  }, [editing])

  const shown = editing ? draft : text
  // `ready`: rendered again, for real, once KaTeX has loaded.
  const html = useMemo(() => (shown.trim() ? renderDisplayMath(shown) : ''), [shown, ready])

  const open = () => {
    if (!editor.isEditable) return
    setDraft(text)
    setEditing(true)
  }

  const close = (select = false) => {
    setEditing(false)
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (select && pos != null) editor.chain().setNodeSelection(pos).focus().run()
  }

  const change = (value: string) => {
    setDraft(value)
    if (value !== text) updateAttributes({ text: value })
  }

  const insertParagraph = (above: boolean) => {
    const pos = typeof getPos === 'function' ? getPos() : undefined
    setEditing(false)
    if (pos == null) return
    const current = editor.state.doc.nodeAt(pos)
    const at = above ? pos : pos + (current?.nodeSize ?? node.nodeSize)
    editor
      .chain()
      .insertContentAt(at, { type: 'paragraph' })
      .setTextSelection(at + 1)
      .focus()
      .run()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      const el = e.currentTarget
      insertParagraph(el.selectionStart === 0 && el.selectionEnd === 0 && draft.length > 0)
    }
  }

  return (
    <NodeViewWrapper
      className={`math-block${selected ? ' is-selected' : ''}${editing ? ' is-editing' : ''}`}
      data-math-block=""
      data-text={text}
    >
      <div
        className="math-block-render"
        contentEditable={false}
        data-testid="math-block-render"
        onClick={open}
      >
        {html ? (
          <div className="math-block-katex" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="math-block-empty">Math</div>
        )}
      </div>
      {editing && (
        <div className="math-block-editor" contentEditable={false}>
          <textarea
            ref={areaRef}
            className="math-block-input"
            aria-label="Math"
            spellCheck={false}
            value={draft}
            rows={Math.max(2, draft.split('\n').length)}
            onChange={(e) => change(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="math-block-editor-footer">
            <span className="math-block-hint">
              <kbd>↵</kbd> to insert above/below
            </span>
            <button type="button" className="math-block-close" onClick={() => close(true)}>
              Close
            </button>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  )
}
