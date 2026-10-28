import type { Editor as TiptapEditor } from '@tiptap/core'
import { Marked, type TokenizerAndRendererExtension } from 'marked'
import { useEffect, useMemo, useRef, useState } from 'react'
import { StringEditor } from '@/editor/StringEditor'
import { WIKILINK_RE } from '@/editor/extensions/wikilink'
import { useLinkPicker } from '@/links/LinkPicker'
import { presentWikilink } from '@/links/wikilinkPresenter'
import { placeholderFor } from '../format'
import type { CellExtras } from '../cellFor'
import type { CellProps } from './types'

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

/** `[[Target]]` and `[[Target|label]]` as a link chip, which `presentWikilink` brings to life. */
const wikilinkExtension: TokenizerAndRendererExtension = {
  name: 'wikilink',
  level: 'inline',
  start: (src) => {
    const at = src.indexOf('[[')
    return at < 0 ? undefined : at
  },
  tokenizer(src) {
    const m = WIKILINK_RE.exec(src)
    if (!m) return undefined
    return { type: 'wikilink', raw: m[0], target: m[1], label: m[2] ?? null }
  },
  renderer(token) {
    const target = String(token.target)
    const label = token.label ? String(token.label) : null
    const data = `data-wikilink="" data-target="${escapeHtml(target)}"` + (label ? ` data-label="${escapeHtml(label)}"` : '')
    return `<span class="wikilink" ${data}>${escapeHtml(label || target)}</span>`
  },
}

// A private instance so the overrides do not leak into other users of the global `marked`.
const md = new Marked({
  async: false,
  extensions: [wikilinkExtension],
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

/** Inline Markdown as HTML (`marked.parseInline`): raw HTML shown as text, unsafe links dropped, wikilinks as chips. */
export function renderInline(source: string): string {
  return md.parseInline(source, { async: false }) as string
}

const onLink = (e: { target: EventTarget }) => e.target instanceof Element && e.target.closest('a, [data-wikilink]') !== null

/**
 * A single paragraph with formatting and links (`textBlock`, "Text"). Shows the rendered text,
 * with `[[links]]` as chips that open their object; a click edits it with the block editor in
 * one-paragraph mode (M9), so `[[` opens the link picker and the token menu formats a selection.
 * Enter and Escape end the edit, as does leaving the cell (but not opening the picker or the
 * token menu). The edit saves on its way out; an unchanged value is never rewritten, and an
 * empty one saves `null`.
 */
export function TextBlockCell({ def, value, readOnly, density, inTable, onChange, path }: CellProps<string | null> & Pick<CellExtras, 'path'>) {
  const [editing, setEditing] = useState(false)
  const html = useMemo(() => (value ? renderInline(value) : ''), [value])
  const textRef = useRef<HTMLSpanElement>(null)
  const editorRef = useRef<TiptapEditor | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // Link chips resolve, take their type's colour and open on click, as in the body.
  useEffect(() => {
    const host = textRef.current
    if (editing || !host) return
    const cleanups = [...host.querySelectorAll<HTMLElement>('[data-wikilink]')].map((chip) =>
      presentWikilink(chip, { target: chip.getAttribute('data-target') ?? '', label: chip.getAttribute('data-label') }),
    )
    return () => cleanups.forEach((c) => c())
  }, [html, editing])

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
            ref={textRef}
            className="[&_a]:underline [&_code]:rounded [&_code]:bg-hover [&_code]:px-1"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <span className="text-fg-muted">{placeholderFor(def, inTable ? 'table' : density)}</span>
        )}
      </div>
    )
  }

  const stop = () => setEditing(false)
  const onBlur = (event: FocusEvent) => {
    const to = event.relatedTarget
    // The `[[` picker and the token menu take focus while the edit goes on.
    if (editorRef.current && useLinkPicker.getState().editor === editorRef.current) return
    if (to instanceof Element && (boxRef.current?.contains(to) || to.closest('[data-tokens-menu]'))) return
    stop()
  }

  return (
    <div ref={boxRef} className="text-block-cell min-h-[1.5em] text-[15px] break-words text-fg">
      <StringEditor
        value={value ?? ''}
        path={path}
        singleParagraph
        autofocus
        ariaLabel={def.name}
        placeholder={placeholderFor(def, inTable ? 'table' : density)}
        editorRef={(e) => (editorRef.current = e)}
        onChange={(next) => {
          const out = next.trim() === '' ? null : next
          if (out !== (value || null)) onChange(out)
        }}
        onEnter={stop}
        onEscape={stop}
        onBlur={onBlur}
      />
    </div>
  )
}
