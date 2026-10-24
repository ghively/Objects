import { marked } from 'marked'
import { useEffect, useMemo, useRef, useState } from 'react'
import { placeholderFor } from '../format'
import { CELL_TEXT, type CellProps } from './types'

/** Escapes raw HTML so only Markdown formatting renders. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Inline Markdown as HTML (`marked.parseInline`), with raw HTML shown as text. */
export function renderInline(md: string): string {
  return marked.parseInline(escapeHtml(md), { async: false }) as string
}

/**
 * A single paragraph of inline Markdown (`textBlock`). Shows the rendered text; a click edits the
 * source in a textarea, which commits on blur (Esc blurs). Line breaks are not part of a
 * paragraph, so Enter commits too.
 */
export function TextBlockCell({ def, value, readOnly, onChange }: CellProps<string | null>) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!editing) setText(value ?? '')
  }, [value, editing])
  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])
  const html = useMemo(() => (value ? renderInline(value) : ''), [value])

  if (!editing) {
    return (
      <div
        role={readOnly ? undefined : 'button'}
        tabIndex={readOnly ? undefined : 0}
        aria-label={readOnly ? undefined : `Edit ${def.name}`}
        onClick={() => !readOnly && setEditing(true)}
        onKeyDown={(e) => {
          if (!readOnly && e.key === 'Enter') setEditing(true)
        }}
        className="min-h-[1.5em] text-[15px] break-words text-fg"
      >
        {value ? (
          <span
            className="[&_a]:underline [&_code]:rounded [&_code]:bg-hover [&_code]:px-1"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <span className="text-fg-muted">{placeholderFor(def)}</span>
        )}
      </div>
    )
  }

  const commit = () => {
    setEditing(false)
    const next = text.replace(/\r?\n/g, ' ')
    const out = next.trim() === '' ? null : next
    if (out !== (value || null)) onChange(out)
  }

  return (
    <textarea
      ref={ref}
      aria-label={def.name}
      value={text}
      rows={Math.max(1, Math.ceil(text.length / 40))}
      placeholder={placeholderFor(def)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      className={`${CELL_TEXT} resize-none`}
    />
  )
}
