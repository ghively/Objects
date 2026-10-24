import { Marked } from 'marked'
import { useEffect, useMemo, useRef, useState } from 'react'
import { placeholderFor } from '../format'
import { CELL_TEXT, type CellProps } from './types'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The href to render, or null when it is unsafe. Allows http, https and mailto, and relative
 * references (no scheme before the first `/`, `?` or `#`). Control characters and whitespace are
 * removed first, as browsers do, and a `&` before the path is refused so an entity-encoded `:`
 * cannot hide a scheme.
 */
export function safeHref(href: string): string | null {
  // eslint-disable-next-line no-control-regex
  const h = href.replace(/[\u0000- \u007f]/g, '')
  if (/^(https?|mailto):/i.test(h)) return h
  const head = h.split(/[/?#]/, 1)[0]
  return /[:&\\]/.test(head) ? null : h
}

// A private instance so the overrides do not leak into other users of the global `marked`.
const md = new Marked({
  async: false,
  renderer: {
    // Raw HTML shows as text; marked's own escaping still covers everything else (code spans too).
    html({ text }) {
      return escapeHtml(text)
    },
    link({ href, title, tokens }) {
      const inner = this.parser.parseInline(tokens)
      const safe = safeHref(href)
      if (safe === null) return inner
      const t = title ? ` title="${escapeHtml(title)}"` : ''
      return `<a href="${escapeHtml(safe)}"${t} target="_blank" rel="noopener noreferrer">${inner}</a>`
    },
    image({ text }) {
      return escapeHtml(text)
    },
  },
})

/** Inline Markdown as HTML (`marked.parseInline`): raw HTML shown as text, unsafe links dropped. */
export function renderInline(source: string): string {
  return md.parseInline(source, { async: false }) as string
}

const onLink = (e: { target: EventTarget }) => e.target instanceof Element && e.target.closest('a') !== null

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
        onClick={(e) => {
          // Following a link must not also open the editor.
          if (!readOnly && !onLink(e)) setEditing(true)
        }}
        onKeyDown={(e) => {
          if (!readOnly && e.key === 'Enter' && !onLink(e)) setEditing(true)
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
