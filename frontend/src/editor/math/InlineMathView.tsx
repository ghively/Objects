/**
 * The inline formula's node view: KaTeX inline rendering of `$…$`. Clicking it
 * opens a small input to edit the TeX; Enter, Escape or leaving the input
 * closes it, and a formula left empty is removed. A new, empty formula (just
 * inserted) opens its input straight away.
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { renderMath, useMathReady } from './renderMath'

export function InlineMathView({ node, editor, getPos, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const text = String(node.attrs.text ?? '')
  const [editing, setEditing] = useState(() => text === '' && editor.isEditable)
  const [draft, setDraft] = useState(text)
  const inputRef = useRef<HTMLInputElement>(null)
  const closed = useRef(false)
  const ready = useMathReady()

  useEffect(() => {
    if (!editing) setDraft(text)
  }, [text, editing])

  useEffect(() => {
    if (editing) {
      closed.current = false
      inputRef.current?.focus()
    }
  }, [editing])

  const shown = editing ? draft : text
  // `ready`: rendered again, for real, once KaTeX has loaded.
  const html = useMemo(() => (shown.trim() ? renderMath(shown, { display: false }) : ''), [shown, ready])

  const open = () => {
    if (!editor.isEditable) return
    setDraft(text)
    setEditing(true)
  }

  const close = (refocus: boolean) => {
    if (closed.current) return
    closed.current = true
    setEditing(false)
    if (!draft.trim()) {
      deleteNode()
      if (refocus) editor.commands.focus()
      return
    }
    if (draft !== text) updateAttributes({ text: draft })
    if (refocus) {
      const pos = typeof getPos === 'function' ? getPos() : undefined
      if (pos != null) editor.chain().setTextSelection(pos + node.nodeSize).focus().run()
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' && !e.nativeEvent.isComposing) || e.key === 'Escape') {
      e.preventDefault()
      close(true)
    }
  }

  return (
    <NodeViewWrapper
      as="span"
      className={`inline-math${selected ? ' is-selected' : ''}`}
      data-inline-math=""
      data-text={text}
    >
      <span className="inline-math-render" contentEditable={false} data-testid="inline-math-render" onClick={open}>
        {html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <span className="inline-math-empty">$</span>}
      </span>
      {editing && (
        <span className="inline-math-editor" contentEditable={false}>
          <input
            ref={inputRef}
            className="inline-math-input"
            aria-label="Math"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => close(false)}
          />
        </span>
      )}
    </NodeViewWrapper>
  )
}
